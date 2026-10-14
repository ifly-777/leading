import AppKit
import LeadingCore
import Quartz
import WebKit
import os

private let log = Logger(subsystem: "io.github.ifly-777.leading.preview", category: "preview")

/// Space in Finder on a Markdown file: the file set as Leading sets it, by the
/// same page the app uses, read-only. The page and its fonts are in this
/// extension's bundle; the file's text is read here, since
/// Quick Look grants this process access to that one file and nothing else
/// (so pictures beside the file are not shown).
@objc(PreviewViewController)
final class PreviewViewController: NSViewController, QLPreviewingController, WKScriptMessageHandler {
    private var web: WKWebView!
    private var text = ""
    private var finish: ((Error?) -> Void)?

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(PageFiles(), forURLScheme: "leading")
        config.userContentController.add(WeakMessages(self), name: "leading")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 820, height: 900), configuration: config)
        web.autoresizingMask = [.width, .height]
        view = web
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        do {
            text = TextFile.decode(try Data(contentsOf: url)).text
        } catch {
            return handler(error)
        }
        finish = handler
        web.load(URLRequest(url: URL(string: "leading://app/app.html")!))
        // Never keep Quick Look waiting: show whatever is there after a moment.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.done() }
    }

    private func done() {
        finish?(nil)
        finish = nil
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        switch body["type"] as? String {
        case "ready":
            // No image folder: Quick Look grants access to the file alone.
            web.callAsyncJavaScript("return window.leading.load({ text, imageBase: null, preview: true })",
                                    arguments: ["text": text], in: nil, in: .page) { _ in }
        case "painted":
            done()
        default:
            break
        }
    }
}

/// The page's own files, from the app this extension lives in. Nothing else is served.
private final class PageFiles: NSObject, WKURLSchemeHandler {
    /// The page is kept in this extension's own bundle, the one place its sandbox may read;
    /// the app reaches the same files through a link (scripts/build-app.sh).
    private let root = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true).standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host() == "app" else { return fail(task) }
        let rel = String(url.path(percentEncoded: false).drop { $0 == "/" })
        let file = root.appendingPathComponent(rel.isEmpty ? "app.html" : rel).standardizedFileURL
        // Only the page's own files: never anything outside its folder.
        guard file.path.hasPrefix(root.path + "/") else { return fail(task) }
        let data: Data
        do { data = try Data(contentsOf: file) } catch {
            log.error("Cannot read the page file \(file.path, privacy: .public): \(error.localizedDescription, privacy: .public)")
            return fail(task)
        }
        let type: String
        switch file.pathExtension.lowercased() {
        case "html": type = "text/html; charset=utf-8"
        case "js", "mjs": type = "text/javascript; charset=utf-8"
        case "css": type = "text/css; charset=utf-8"
        case "ttf": type = "font/ttf"
        case "woff2": type = "font/woff2"
        case "woff": type = "font/woff"
        case "svg": type = "image/svg+xml"
        default: type = "application/octet-stream"
        }
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type, "Content-Length": String(data.count)])!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask) {
        task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
    }
}

/// WebKit holds its message handlers strongly; this breaks the cycle.
private final class WeakMessages: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}
