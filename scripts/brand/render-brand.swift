// Renders the app icon and splash PNGs from assets/brand/mark.svg (#207).
// macOS only: it uses AppKit's built-in SVG support, so it needs no extra dependency.
// Run it after editing the mark, from the repo root:
//   swift scripts/brand/render-brand.swift
// Colors come from docs/design-system.md: primary on background, and the dark values.
import AppKit

let template = try! String(contentsOfFile: "assets/brand/mark.svg", encoding: .utf8)

struct Output {
  let path: String
  let size: Int
  let markColor: String
  let background: String?  // nil = transparent
  let markScale: Double    // share of the canvas the 1024 mark artwork fills
}

let primary = "#3F6B4F", primaryDark = "#8DBB9C"
let background = "#FAF7F2", backgroundDark = "#1C1B19"

let outputs = [
  // Legacy and web icon, and the iOS light icon: mark on the light background.
  Output(path: "assets/images/icon.png", size: 1024, markColor: primary, background: background, markScale: 1.0),
  // iOS dark icon: the system draws its own dark backdrop behind transparency.
  Output(path: "assets/images/icon-ios-dark.png", size: 1024, markColor: primaryDark, background: nil, markScale: 1.0),
  // iOS tinted icon: a grayscale mark that iOS recolors.
  Output(path: "assets/images/icon-ios-tinted.png", size: 1024, markColor: "#FFFFFF", background: nil, markScale: 1.0),
  // Android adaptive icon: the launcher masks to the central 66%, so the mark is scaled down.
  Output(path: "assets/images/android-icon-foreground.png", size: 1024, markColor: primary, background: nil, markScale: 0.72),
  Output(path: "assets/images/android-icon-monochrome.png", size: 1024, markColor: "#FFFFFF", background: nil, markScale: 0.72),
  // Splash screen: transparent mark; the background color comes from app.config.ts.
  Output(path: "assets/images/splash-icon.png", size: 1024, markColor: primary, background: nil, markScale: 1.0),
  Output(path: "assets/images/splash-icon-dark.png", size: 1024, markColor: primaryDark, background: nil, markScale: 1.0),
]

for out in outputs {
  // Strip the XML comment, which holds the placeholder name, before filling in the color.
  var svg = template.replacingOccurrences(of: #"<!--[\s\S]*?-->"#, with: "", options: .regularExpression)
  svg = svg.replacingOccurrences(of: "MARK_COLOR", with: out.markColor)
  let offset = 512 * (1 - out.markScale)
  svg = svg.replacingOccurrences(
    of: "<g fill=",
    with: "<g transform=\"translate(\(offset) \(offset)) scale(\(out.markScale))\" fill=")
  if let bg = out.background {
    svg = svg.replacingOccurrences(
      of: "viewBox=\"0 0 1024 1024\">",
      with: "viewBox=\"0 0 1024 1024\"><rect width=\"1024\" height=\"1024\" fill=\"\(bg)\"/>")
  }
  guard let image = NSImage(data: svg.data(using: .utf8)!) else { fatalError("Can't read SVG for \(out.path)") }
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: out.size, pixelsHigh: out.size, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: out.size, height: out.size)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  image.draw(in: NSRect(x: 0, y: 0, width: out.size, height: out.size))
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out.path))
  print("wrote \(out.path)")
}
