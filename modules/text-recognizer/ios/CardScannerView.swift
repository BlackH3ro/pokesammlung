import AVFoundation
import ExpoModulesCore
import Vision

// Camera preview that runs Apple Vision text recognition on the live video frames – no photos, no network.
// Every recognized frame is sent to JS as `onText` ({ text, ms }); JS matches the text against the card index.
class CardScannerView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onText = EventDispatcher()
  var active = true

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "pokesammlung.scanner.session")
  private let videoQueue = DispatchQueue(label: "pokesammlung.scanner.video")
  private let previewLayer: AVCaptureVideoPreviewLayer
  private var device: AVCaptureDevice?
  private var configured = false
  private var busy = false
  private var lastRun = Date.distantPast

  // Read at most this often; Vision "accurate" takes ~100–200 ms per frame on recent iPhones.
  private let minInterval: TimeInterval = 0.15

  required init(appContext: AppContext? = nil) {
    previewLayer = AVCaptureVideoPreviewLayer(session: session)
    super.init(appContext: appContext)
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    clipsToBounds = true
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    let visible = window != nil
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      if visible {
        self.configureIfNeeded()
        if !self.session.isRunning { self.session.startRunning() }
      } else if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  func setTorch(_ on: Bool) {
    sessionQueue.async { [weak self] in
      guard let device = self?.device, device.hasTorch else { return }
      try? device.lockForConfiguration()
      device.torchMode = on ? .on : .off
      device.unlockForConfiguration()
    }
  }

  private func configureIfNeeded() {
    guard !configured else { return }
    configured = true
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
          let input = try? AVCaptureDeviceInput(device: device) else { return }
    self.device = device

    session.beginConfiguration()
    session.sessionPreset = session.canSetSessionPreset(.hd1920x1080) ? .hd1920x1080 : .high
    if session.canAddInput(input) { session.addInput(input) }
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    output.setSampleBufferDelegate(self, queue: videoQueue)
    if session.canAddOutput(output) { session.addOutput(output) }
    session.commitConfiguration()

    try? device.lockForConfiguration()
    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
    if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
    if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
    device.videoZoomFactor = zoomForCard(device)
    device.unlockForConfiguration()
  }

  // Newer iPhones cannot focus closer than ~15–20 cm. Zoom in a little so a card fills the frame
  // at a distance the camera can still focus on (same idea as Apple's barcode sample).
  private func zoomForCard(_ device: AVCaptureDevice) -> CGFloat {
    let minFocusMm = Float(device.minimumFocusDistance)
    guard minFocusMm > 0 else { return 1 }
    let fovLong = device.activeFormat.videoFieldOfView * .pi / 180
    let fovShort = 2 * atan(tan(fovLong / 2) * 9 / 16) // portrait: the card's width spans the short side
    let cardFill: Float = 0.75
    let distanceMm = (63 / cardFill) / 2 / tan(fovShort / 2)
    guard distanceMm < minFocusMm else { return 1 }
    let zoom = CGFloat(minFocusMm / distanceMm)
    return min(max(zoom, 1), min(device.activeFormat.videoMaxZoomFactor, 3))
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard active, !busy, Date().timeIntervalSince(lastRun) >= minInterval,
          let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    busy = true
    lastRun = Date()
    let started = Date()

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // Card numbers and names are not dictionary words; correction would "fix" them.
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["de-DE", "en-US"]

    // The back camera delivers landscape frames; .right turns them upright for a phone held in portrait.
    let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .right, options: [:])
    try? handler.perform([request])
    let lines = (request.results ?? [])
      .sorted { $0.boundingBox.minY > $1.boundingBox.minY }
      .compactMap { $0.topCandidates(1).first?.string }
    let ms = Int(Date().timeIntervalSince(started) * 1000)
    busy = false

    DispatchQueue.main.async { [weak self] in
      self?.onText(["text": lines.joined(separator: "\n"), "ms": ms])
    }
  }
}
