import ExpoModulesCore

// Live camera view that reads text from the video stream (see CardScannerView).
public class CardScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CardScanner")

    View(CardScannerView.self) {
      Events("onText")

      Prop("active") { (view: CardScannerView, active: Bool?) in
        view.active = active ?? true
      }

      Prop("torch") { (view: CardScannerView, torch: Bool?) in
        view.setTorch(torch ?? false)
      }
    }
  }
}
