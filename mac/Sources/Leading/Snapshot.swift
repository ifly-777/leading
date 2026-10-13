import AppKit
import LeadingCore
import WebKit

/// LEADING_SNAPSHOT=/path/shot.png: once the document has painted, draw the
/// whole window (page, title bar controls, rounded corners and shadow) into a
/// Retina PNG and quit. Used by scripts/screenshots.sh for the README.
///
/// The window is drawn by the app itself, so no screen-recording permission is
/// needed. Reading settings come from LEADING_SNAPSHOT_SETTINGS (JSON, over the
/// defaults) and are kept in memory only: the reader's own preferences are
/// neither read nor changed.
enum Snapshot {
    private static let env = ProcessInfo.processInfo.environment
    static var path: String? { env["LEADING_SNAPSHOT"] }
    static var enabled: Bool { path != nil }

    /// The settings for the picture, or nil when not taking one.
    static var settings: ReaderSettings? {
        guard enabled else { return nil }
        var base = ReaderSettings().dictionary
        if let json = env["LEADING_SNAPSHOT_SETTINGS"]?.data(using: .utf8),
           let extra = try? JSONSerialization.jsonObject(with: json) as? [String: Any] {
            base.merge(extra) { _, new in new }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: base) else { return ReaderSettings() }
        return (try? JSONDecoder().decode(ReaderSettings.self, from: data)) ?? ReaderSettings()
    }

    /// LEADING_SNAPSHOT_SIZE=1100x760 (points).
    static var windowSize: NSSize? {
        guard enabled, let s = env["LEADING_SNAPSHOT_SIZE"] else { return nil }
        let p = s.split(separator: "x").compactMap { Double($0) }
        return p.count == 2 ? NSSize(width: p[0], height: p[1]) : nil
    }

    private static var taken = false

    static func take(window: NSWindow, page: ReaderWebView, controller: DocumentWindowController) {
        guard let path, !taken else { return }
        taken = true
        // LEADING_SNAPSHOT_EDIT=1: show the source editor instead of the page.
        if env["LEADING_SNAPSHOT_EDIT"] == "1" { controller.leadingToggleEdit(nil) }
        // Let fonts, the outline and any mode change settle before drawing.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            capture(window: window, page: page) { png in
                if let png { try? png.write(to: URL(fileURLWithPath: path)) }
                else { FileHandle.standardError.write("Leading: snapshot failed\n".data(using: .utf8)!) }
                NSApp.terminate(nil)
            }
        }
    }

    private static func capture(window: NSWindow, page: ReaderWebView, done: @escaping (Data?) -> Void) {
        let scale: CGFloat = 2
        let size = window.frame.size
        let config = WKSnapshotConfiguration()
        // snapshotWidth is in points and multiplied by the display's scale; ask for 2× on any display.
        config.snapshotWidth = NSNumber(value: Double(page.bounds.width * scale / window.backingScaleFactor))
        page.takeSnapshot(with: config) { pageImage, _ in
            guard let pageImage else { return done(nil) }
            // Room around the window for its shadow, as macOS's own window screenshots have.
            let margin: CGFloat = 40
            let canvas = NSSize(width: size.width + 2 * margin, height: size.height + 2 * margin)
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(canvas.width * scale), pixelsHigh: Int(canvas.height * scale),
                                             bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return done(nil) }
            rep.size = canvas
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            NSGraphicsContext.current?.imageInterpolation = .high

            let frame = NSRect(x: margin, y: margin, width: size.width, height: size.height)
            // macOS 26 windows with a toolbar have generous corners.
            let outline = NSBezierPath(roundedRect: frame, xRadius: 16, yRadius: 16)
            let shadow = NSShadow()
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
            shadow.shadowBlurRadius = 28
            shadow.shadowOffset = NSSize(width: 0, height: -10)
            NSGraphicsContext.saveGraphicsState()
            shadow.set()
            (window.backgroundColor ?? .white).setFill()
            outline.fill()
            NSGraphicsContext.restoreGraphicsState()

            NSGraphicsContext.saveGraphicsState()
            outline.addClip()
            // The page fills the window, under the transparent title bar.
            let pageFrame = page.convert(page.bounds, to: nil)
            pageImage.draw(in: pageFrame.offsetBy(dx: margin, dy: margin))
            // Then the title bar's own controls (traffic lights, title, toolbar
            // buttons), each drawn by AppKit as it is on screen.
            if let frameView = window.contentView?.superview {
                for control in titlebarControls(in: frameView) {
                    let r = control.convert(control.bounds, to: nil)
                    guard let cache = control.bitmapImageRepForCachingDisplay(in: control.bounds) else { continue }
                    control.cacheDisplay(in: control.bounds, to: cache)
                    cache.draw(in: r.offsetBy(dx: margin, dy: margin), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
                }
            }
            // The fine edge macOS draws around every window.
            NSColor.black.withAlphaComponent(0.12).setStroke()
            outline.lineWidth = 1
            outline.stroke()
            NSGraphicsContext.restoreGraphicsState()
            NSGraphicsContext.restoreGraphicsState()
            done(rep.representation(using: .png, properties: [:]))
        }
    }

    /// Visible buttons and labels in the title bar, but not the page itself.
    private static func titlebarControls(in view: NSView) -> [NSView] {
        var found: [NSView] = []
        for sub in view.subviews where !sub.isHidden && sub.alphaValue > 0 {
            if sub is ReaderWebView { continue }
            if sub is NSButton || (sub is NSTextField && !(sub as! NSTextField).stringValue.isEmpty) { found.append(sub) }
            else { found += titlebarControls(in: sub) }
        }
        return found
    }
}
