import ExpoModulesCore
import Vision

public class TextRecognizerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TextRecognizer")

    // Reads the text of an image file on the device (Apple Vision), lines from top to bottom.
    // No network round trip, so a card is read in a fraction of a second.
    AsyncFunction("recognize") { (uri: String, promise: Promise) in
      let url = uri.hasPrefix("file://") ? URL(string: uri) : URL(fileURLWithPath: uri)
      guard let url = url else {
        promise.reject("ERR_TEXT_URI", "Ungültiger Bildpfad")
        return
      }
      let request = VNRecognizeTextRequest { req, error in
        if let error = error {
          promise.reject("ERR_TEXT", error.localizedDescription)
          return
        }
        let lines = (req.results as? [VNRecognizedTextObservation] ?? [])
          .sorted { $0.boundingBox.minY > $1.boundingBox.minY }
          .compactMap { $0.topCandidates(1).first?.string }
        promise.resolve(lines.joined(separator: "\n"))
      }
      request.recognitionLevel = .accurate
      // Card numbers and names are not dictionary words; correction would "fix" them.
      request.usesLanguageCorrection = false
      request.recognitionLanguages = ["de-DE", "en-US"]
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try VNImageRequestHandler(url: url, options: [:]).perform([request])
        } catch {
          promise.reject("ERR_TEXT", error.localizedDescription)
        }
      }
    }
  }
}
