import Foundation
import LeadingCore
import UniformTypeIdentifiers
import WebKit

/// Serves everything the reading page loads, at a private leading:// address:
///   leading://app/…           the page, its scripts, styles and fonts (from the app bundle)
///   leading://doc/<id>/…      images beside a document, and nothing but images
///   leading://app/__doc/<id>  the document's own text. Fetching it is far faster than
///                             passing 5 MB as a script argument; it lives under the page's
///                             own address because WebKit treats custom-scheme origins as
///                             opaque, so a cross-origin fetch could never be allowed.
/// No request ever leaves the Mac; the page's Content-Security-Policy forbids it too.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    static let shared = SchemeHandler()
    static let scheme = "leading"

    private let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
    private var folders: [String: URL] = [:]
    private var texts: [String: Data] = [:]
    private var stopped = Set<ObjectIdentifier>()

    /// Register a document's folder; returns the URL prefix its images (and text) load from.
    func imageBase(for document: URL) -> String {
        let id = UUID().uuidString.lowercased()
        folders[id] = document.deletingLastPathComponent()
        return "\(Self.scheme)://doc/\(id)/"
    }

    /// An address for a new, unsaved document: unique, but with no folder yet
    /// (it has no neighbours whose images it could show).
    func untitledBase() -> String {
        "\(Self.scheme)://doc/\(UUID().uuidString.lowercased())/"
    }

    /// The document was saved for the first time, renamed or moved: its images now come from here.
    func setFolder(base: String, document: URL) {
        guard let id = base.split(separator: "/").last.map(String.init) else { return }
        folders[id] = document.deletingLastPathComponent()
    }

    /// Hold a document's current text for its page to fetch; returns the URL to fetch it from.
    func setText(_ text: String, base: String) -> String {
        let id = base.split(separator: "/").last.map(String.init) ?? ""
        texts[id] = Data(text.utf8)
        return "\(Self.scheme)://app/__doc/\(id)"
    }

    func forget(base: String) {
        guard let id = base.split(separator: "/").last.map(String.init) else { return }
        folders[id] = nil
        texts[id] = nil
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        // The document text is served straight from memory.
        if let url = task.request.url, url.host() == "app", url.pathComponents.count == 3, url.pathComponents[1] == "__doc",
           let data = texts[url.pathComponents[2]] {
            let headers = ["Content-Type": "text/plain; charset=utf-8", "Content-Length": String(data.count), "Cache-Control": "no-store"]
            task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
            task.didReceive(data)
            task.didFinish()
            return
        }
        guard let url = task.request.url, let file = resolve(url) else {
            return fail(task, 404)
        }
        let key = ObjectIdentifier(task)
        // Read off the main thread: a large image should never stall the page.
        DispatchQueue.global(qos: .userInitiated).async {
            let data = try? Data(contentsOf: file, options: .mappedIfSafe)
            DispatchQueue.main.async {
                if self.stopped.remove(key) != nil { return } // the page no longer wants it
                guard let data else { return self.fail(task, 404) }
                let headers = ["Content-Type": Self.mimeType(file), "Content-Length": String(data.count), "Cache-Control": "no-store"]
                task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
                task.didReceive(data)
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func resolve(_ url: URL) -> URL? {
        let path = url.path(percentEncoded: true)
        switch url.host() {
        case "app":
            let rel = path == "/" || path.isEmpty ? "app.html" : String(path.dropFirst()).removingPercentEncoding ?? ""
            let file = webRoot.appendingPathComponent(rel).standardizedFileURL
            // Never serve anything outside the bundle's web folder.
            return file.path.hasPrefix(webRoot.standardizedFileURL.path) ? file : nil
        case "doc":
            let parts = path.split(separator: "/", maxSplits: 1).map(String.init)
            guard parts.count == 2, let folder = folders[parts[0]] else { return nil }
            return Paths.imageFile(requestPath: parts[1], documentFolder: folder)
        default:
            return nil
        }
    }

    private func fail(_ task: WKURLSchemeTask, _ code: Int) {
        task.didFailWithError(NSError(domain: NSURLErrorDomain, code: code == 404 ? NSURLErrorFileDoesNotExist : NSURLErrorUnknown))
    }

    private static func mimeType(_ file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "ttf": return "font/ttf"
        case "svg": return "image/svg+xml"
        default: return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
