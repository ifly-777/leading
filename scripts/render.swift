// Renders a local HTML page with WebKit, as the app does, to a PDF or a PNG.
// Used by make-dmg.sh for the install guide and the disk-image background, so
// both are made from HTML in the repository, set in the app's own fonts.
//
//   swift scripts/render.swift page.html out.pdf 595 842
//   swift scripts/render.swift page.html out.png 600 400 2    (2 = Retina)
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 5, let width = Double(args[3]), let height = Double(args[4]) else {
    FileHandle.standardError.write("usage: render.swift page.html out.(pdf|png) width height [scale]\n".data(using: .utf8)!)
    exit(2)
}
let page = URL(fileURLWithPath: args[1]).standardizedFileURL
let out = URL(fileURLWithPath: args[2])
let scale = args.count > 5 ? Double(args[5]) ?? 1 : 1
// Pages may use the repository's fonts, two folders up (mac/Resources/dmg → repository root).
let root = page.deletingLastPathComponent().appendingPathComponent("../../..").standardizedFileURL

final class Loader: NSObject, WKNavigationDelegate {
    var done: (() -> Void)?
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { done?() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
    private func fail(_ e: Error) { FileHandle.standardError.write("render: \(e)\n".data(using: .utf8)!); exit(1) }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let rect = NSRect(x: 0, y: 0, width: width, height: height)
let web = WKWebView(frame: rect)
// Always the light appearance: a PDF or picture should not depend on the Mac that made it.
web.appearance = NSAppearance(named: .aqua)
// An off-screen window, so WebKit lays out and paints at the requested size.
let window = NSWindow(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = web
let loader = Loader()
web.navigationDelegate = loader
loader.done = {
    // Web fonts finish loading after the page itself; wait for them.
    web.evaluateJavaScript("document.fonts.ready.then(() => true)") { _, _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            if out.pathExtension == "pdf" {
                let config = WKPDFConfiguration()
                config.rect = rect
                web.createPDF(configuration: config) { result in
                    switch result {
                    case .success(let data): try! data.write(to: out); exit(0)
                    case .failure(let e): FileHandle.standardError.write("render: \(e)\n".data(using: .utf8)!); exit(1)
                    }
                }
            } else {
                let config = WKSnapshotConfiguration()
                config.rect = rect
                // Ask for enough pixels on any display (snapshotWidth is in points, multiplied by the backing scale).
                config.snapshotWidth = NSNumber(value: width * scale / window.backingScaleFactor)
                web.takeSnapshot(with: config) { image, error in
                    guard let image else {
                        FileHandle.standardError.write("render: \(String(describing: error))\n".data(using: .utf8)!); exit(1)
                    }
                    // Redraw at exactly width × scale pixels: a snapshot's own pixel
                    // count depends on the display of the Mac that makes it.
                    let px = (Int(width * scale), Int(height * scale))
                    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px.0, pixelsHigh: px.1, bitsPerSample: 8, samplesPerPixel: 4,
                                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
                    NSGraphicsContext.saveGraphicsState()
                    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
                    NSGraphicsContext.current?.imageInterpolation = .high
                    image.draw(in: NSRect(x: 0, y: 0, width: px.0, height: px.1))
                    NSGraphicsContext.restoreGraphicsState()
                    // Say the picture's size in points, so Finder shows a 2× picture at the right size.
                    rep.size = NSSize(width: width, height: height)
                    try! rep.representation(using: .png, properties: [:])!.write(to: out)
                    exit(0)
                }
            }
        }
    }
}
web.loadFileURL(page, allowingReadAccessTo: root)
app.run()
