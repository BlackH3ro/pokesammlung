// Builds the image fingerprints the live scanner compares camera frames against.
// Runs on the macOS build machine (GitHub Actions), because Apple Vision only exists on Apple systems:
//
//   swift scripts/card-prints.swift <output dir> [minutes]
//
// Output: <dir>/prints.json ({ dim, ids }) and <dir>/prints.bin (one int8 vector per id, L2-normalised × 127).
// Incremental: cards already in the output dir are kept, only new cards are downloaded. Stops after
// [minutes] (default 25) and writes what it has, so the next build continues where this one stopped.

import Foundation
import ImageIO
import Vision

let args = CommandLine.arguments
guard args.count >= 2 else { print("usage: card-prints.swift <dir> [minutes]"); exit(1) }
let outDir = URL(fileURLWithPath: args[1], isDirectory: true)
let budget = (args.count >= 3 ? Double(args[2]) ?? 25 : 25) * 60
let started = Date()
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

struct Meta: Codable { var dim: Int; var revision: Int; var ids: [String] }

// ---- What we already have ----
var known: [String: [Int8]] = [:]
let metaURL = outDir.appendingPathComponent("prints.json")
let binURL = outDir.appendingPathComponent("prints.bin")
var dim = 0
if let m = try? JSONDecoder().decode(Meta.self, from: Data(contentsOf: metaURL)),
   m.revision == 2, let bin = try? Data(contentsOf: binURL), bin.count == m.ids.count * m.dim {
  dim = m.dim
  let bytes = [Int8](unsafeUninitializedCapacity: bin.count) { buf, n in
    _ = bin.copyBytes(to: UnsafeMutableRawBufferPointer(buf)); n = bin.count
  }
  for (i, id) in m.ids.enumerated() { known[id] = Array(bytes[i * dim ..< (i + 1) * dim]) }
}
print("kept \(known.count) fingerprints")

// ---- All cards with a picture (English picture preferred, German otherwise) ----
func cards(_ lang: String) async throws -> [[String: Any]] {
  let (data, _) = try await URLSession.shared.data(from: URL(string: "https://api.tcgdex.net/v2/\(lang)/cards")!)
  return (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
}
var images: [String: String] = [:]
for lang in ["de", "en"] {
  for c in try await cards(lang) {
    if let id = c["id"] as? String, let img = c["image"] as? String { images[id] = img }
  }
}
let todo = images.keys.filter { known[$0] == nil }.sorted()
print("\(images.count) cards with pictures, \(todo.count) new")

// ---- Fingerprint one picture ----
func fingerprint(of data: Data) -> [Float]? {
  guard let src = CGImageSourceCreateWithData(data as CFData, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
  let req = VNGenerateImageFeaturePrintRequest()
  req.revision = VNGenerateImageFeaturePrintRequestRevision2
  req.imageCropAndScaleOption = .scaleFill
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  guard let obs = req.results?.first, obs.elementType == .float else { return nil }
  return obs.data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
}

func quantize(_ v: [Float]) -> [Int8] {
  let norm = max(sqrt(v.reduce(0) { $0 + $1 * $1 }), 1e-6)
  return v.map { Int8(max(-127, min(127, ($0 / norm * 127).rounded()))) }
}

// ---- Download + fingerprint, 24 at a time ----
let session: URLSession = {
  let c = URLSessionConfiguration.default
  c.httpMaximumConnectionsPerHost = 24
  c.timeoutIntervalForRequest = 30
  return URLSession(configuration: c)
}()

var done = 0
await withTaskGroup(of: (String, [Float]?).self) { group in
  var queue = todo[...]
  func next() -> Bool {
    guard Date().timeIntervalSince(started) < budget, let id = queue.popFirst(), let base = images[id] else { return false }
    group.addTask {
      guard let url = URL(string: base + "/low.jpg"),
            let result = try? await session.data(from: url),
            (result.1 as? HTTPURLResponse)?.statusCode == 200 else { return (id, nil) }
      return (id, fingerprint(of: result.0))
    }
    return true
  }
  for _ in 0 ..< 24 { _ = next() }
  for await (id, vector) in group {
    if let vector {
      if dim == 0 { dim = vector.count }
      if vector.count == dim { known[id] = quantize(vector) }
    }
    done += 1
    if done % 1000 == 0 { print("\(done)/\(todo.count)") }
    _ = next()
  }
}

// ---- Write ----
let ids = known.keys.sorted()
var bin = Data(capacity: ids.count * dim)
for id in ids { bin.append(contentsOf: known[id]!.map { UInt8(bitPattern: $0) }) }
try bin.write(to: binURL)
try JSONEncoder().encode(Meta(dim: dim, revision: 2, ids: ids)).write(to: metaURL)
print("wrote \(ids.count) fingerprints (\(dim) values each, \(bin.count / 1_000_000) MB) in \(Int(Date().timeIntervalSince(started)))s")
