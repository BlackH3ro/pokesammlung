import Accelerate
import Foundation

// Image fingerprints of all cards (built by scripts/card-prints.swift during the GitHub build and bundled
// as CardPrints.bundle). Nearest-neighbour search is a single matrix × vector product.
final class CardPrints {
  static let shared: CardPrints? = CardPrints.load()

  let ids: [String]
  let dim: Int
  private let matrix: [Float] // ids.count × dim, rows L2-normalised

  private init(ids: [String], dim: Int, matrix: [Float]) {
    self.ids = ids
    self.dim = dim
    self.matrix = matrix
  }

  private struct Meta: Decodable { let dim: Int; let ids: [String] }

  private static func load() -> CardPrints? {
    let candidates = [Bundle.main, Bundle(for: CardPrints.self)]
    guard let bundle = candidates
      .compactMap({ $0.url(forResource: "CardPrints", withExtension: "bundle") })
      .compactMap({ Bundle(url: $0) })
      .first,
      let metaURL = bundle.url(forResource: "prints", withExtension: "json"),
      let binURL = bundle.url(forResource: "prints", withExtension: "bin"),
      let meta = try? JSONDecoder().decode(Meta.self, from: Data(contentsOf: metaURL)),
      let bin = try? Data(contentsOf: binURL, options: .mappedIfSafe),
      meta.dim > 0, bin.count == meta.ids.count * meta.dim
    else { return nil }
    var matrix = [Float](repeating: 0, count: bin.count)
    bin.withUnsafeBytes { raw in
      let src = raw.bindMemory(to: Int8.self)
      for i in 0 ..< src.count { matrix[i] = Float(src[i]) / 127 }
    }
    return CardPrints(ids: meta.ids, dim: meta.dim, matrix: matrix)
  }

  // Best matches for a fingerprint, highest cosine similarity first.
  func nearest(_ vector: [Float], count k: Int) -> [(id: String, score: Float)] {
    guard vector.count == dim else { return [] }
    var q = vector
    var norm: Float = 0
    vDSP_svesq(q, 1, &norm, vDSP_Length(dim))
    norm = max(sqrt(norm), 1e-6)
    vDSP_vsdiv(q, 1, &norm, &q, 1, vDSP_Length(dim))
    var scores = [Float](repeating: 0, count: ids.count)
    vDSP_mmul(matrix, 1, q, 1, &scores, 1, vDSP_Length(ids.count), 1, vDSP_Length(dim))
    var best: [(Int, Float)] = []
    for (i, s) in scores.enumerated() where best.count < k || s > best[best.count - 1].1 {
      best.append((i, s))
      best.sort { $0.1 > $1.1 }
      if best.count > k { best.removeLast() }
    }
    return best.map { (ids[$0.0], $0.1) }
  }
}
