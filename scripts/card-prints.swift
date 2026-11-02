// Builds the image fingerprints the live scanner compares camera frames against.
// Runs on the macOS build machine (GitHub Actions), because Apple Vision only exists on Apple systems:
//
//   swiftc -O scripts/card-prints.swift -o card-prints && ./card-prints <output dir> [minutes]
//
// Output: <dir>/prints.json ({ dim, revision, ids }) and <dir>/prints.bin (one int8 vector per id,
// L2-normalised × 127). Incremental: cards already in the output dir are kept and only new cards are
// downloaded. Works in batches and saves after each one, so a timeout loses nothing and the next build
// continues where this one stopped.

import Foundation
import ImageIO
import Vision

setvbuf(stdout, nil, _IOLBF, 0) // show progress in the build log right away

let args = CommandLine.arguments
guard args.count >= 2 else { print("usage: card-prints <dir> [minutes]"); exit(1) }
let outDir = URL(fileURLWithPath: args[1], isDirectory: true)
let budget = (args.count >= 3 ? Double(args[2]) ?? 25 : 25) * 60
let started = Date()
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

struct Meta: Codable { var dim: Int; var revision: Int; var ids: [String] }
let metaURL = outDir.appendingPathComponent("prints.json")
let binURL = outDir.appendingPathComponent("prints.bin")

// ---- What we already have ----
var known: [String: [Int8]] = [:]
var dim = 0
if let m = try? JSONDecoder().decode(Meta.self, from: Data(contentsOf: metaURL)),
   m.revision == 2, let bin = try? Data(contentsOf: binURL), bin.count == m.ids.count * m.dim {
  dim = m.dim
  let bytes = [UInt8](bin)
  for (i, id) in m.ids.enumerated() { known[id] = bytes[i * dim ..< (i + 1) * dim].map { Int8(bitPattern: $0) } }
}
print("kept \(known.count) fingerprints")

func save() throws {
  let ids = known.keys.sorted()
  var bin = Data(capacity: ids.count * dim)
  for id in ids { bin.append(contentsOf: known[id]!.map { UInt8(bitPattern: $0) }) }
  try bin.write(to: binURL, options: .atomic)
  try JSONEncoder().encode(Meta(dim: dim, revision: 2, ids: ids)).write(to: metaURL, options: .atomic)
}

// ---- Networking without async: a semaphore per request ----
let session: URLSession = {
  let c = URLSessionConfiguration.default
  c.httpMaximumConnectionsPerHost = 32
  c.timeoutIntervalForRequest = 20
  c.timeoutIntervalForResource = 40
  return URLSession(configuration: c)
}()

func fetch(_ url: URL) -> Data? {
  let done = DispatchSemaphore(value: 0)
  var result: Data?
  session.dataTask(with: url) { data, resp, _ in
    if (resp as? HTTPURLResponse)?.statusCode == 200 { result = data }
    done.signal()
  }.resume()
  done.wait()
  return result
}

// ---- All cards with a picture (English picture preferred, German otherwise) ----
var images: [String: String] = [:]
for lang in ["de", "en"] {
  guard let data = fetch(URL(string: "https://api.tcgdex.net/v2/\(lang)/cards")!),
        let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
    print("could not load the \(lang) card list"); exit(1)
  }
  for c in list { if let id = c["id"] as? String, let img = c["image"] as? String { images[id] = img } }
}
let todo = images.keys.filter { known[$0] == nil }.sorted()
print("\(images.count) cards with pictures, \(todo.count) new")

// ---- Fingerprint one picture ----
func fingerprint(_ data: Data) -> [Float]? {
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

// ---- Batches: download 200 pictures in parallel, fingerprint them in parallel, save ----
let lock = NSLock()
var done = 0
var failed = 0
for start in stride(from: 0, to: todo.count, by: 200) {
  if Date().timeIntervalSince(started) > budget { print("time budget used up, continuing next build"); break }
  let batch = Array(todo[start ..< min(start + 200, todo.count)])
  // All downloads of the batch at once (network-bound) …
  var pictures = [Data?](repeating: nil, count: batch.count)
  let group = DispatchGroup()
  for (i, id) in batch.enumerated() {
    guard let base = images[id], let url = URL(string: base + "/low.jpg") else { continue }
    group.enter()
    session.dataTask(with: url) { data, resp, _ in
      if (resp as? HTTPURLResponse)?.statusCode == 200 { lock.lock(); pictures[i] = data; lock.unlock() }
      group.leave()
    }.resume()
  }
  group.wait()
  // … then the fingerprints on all CPU cores.
  var vectors = [[Float]?](repeating: nil, count: batch.count)
  DispatchQueue.concurrentPerform(iterations: batch.count) { i in
    guard let data = pictures[i] else { return }
    let v = fingerprint(data)
    lock.lock(); vectors[i] = v; lock.unlock()
  }
  for (i, v) in vectors.enumerated() {
    guard let v else { failed += 1; continue }
    if dim == 0 { dim = v.count }
    if v.count == dim { known[batch[i]] = quantize(v) }
  }
  done += batch.count
  try save()
  print("\(done)/\(todo.count) done, \(failed) failed, \(Int(Date().timeIntervalSince(started)))s")
}

try save()
print("wrote \(known.count) fingerprints (\(dim) values each) in \(Int(Date().timeIntervalSince(started)))s")
