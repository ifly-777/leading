import AppKit
import WebKit

/// What a reading page reports back to its window.
protocol ReaderWebViewHost: AnyObject {
    func pageDidPaint(_ ms: Double)
    func pageDidLoad(_ timings: [String: Any])
    func pageOpenLink(_ href: String)
    func pageChangedSettings(_ settings: [String: Any])
    func pageEdited(_ edits: [[String: Any]])
    func pageSettled(length: Int, hash: UInt32)
    func pageHistory(canUndo: Bool, canRedo: Bool)
    func pageMode(editing: Bool)
    func pageSavedPlace(s: Int, dy: Double)
    func pageOpenWiki(target: String, heading: String?)
    func pageCanGoBack(_ can: Bool)
    func pageSpeak(_ passages: [String], language: String?)
    func pageStopSpeaking()
    func pageWantsBacklinks()
    func pageSearchVault(_ query: String, id: Int)
    func pageOpenAt(_ href: String, query: String, s: Int)
    func pageWikiTargets(_ targets: [String])
    func pageSideTab(_ tab: String)
}

/// The web view showing one document. Holds calls until its page reports it is
/// ready, so a window can use it the moment it is created.
final class ReaderWebView: WKWebView, WKNavigationDelegate {
    weak var host: ReaderWebViewHost?
    private(set) var isReady = false
    private var queued: [(String, [String: Any])] = []
    private var overTable = false

    init() {
        let config = WKWebViewConfiguration()
        // Nothing written to disk: no caches, cookies or storage left behind.
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(SchemeHandler.shared, forURLScheme: SchemeHandler.scheme)
        config.suppressesIncrementalRendering = false
        let messages = MessageProxy()
        config.userContentController.add(messages, name: "leading")
        super.init(frame: .zero, configuration: config)
        messages.target = self
        navigationDelegate = self
        allowsMagnification = false
        allowsBackForwardNavigationGestures = false
        #if DEBUG
        isInspectable = true
        #endif
        load(URLRequest(url: URL(string: "\(SchemeHandler.scheme)://app/app.html")!))
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// Ask the page for its whole text (used to resync the mirror).
    func fetchText(_ done: @escaping (String?) -> Void) {
        callAsyncJavaScript("return window.leading.text()", arguments: [:], in: nil, in: .page) { r in
            done((try? r.get()) as? String)
        }
    }

    /// Edit › Look Up (⌃⌘D): the dictionary's panel for the selected words, at the
    /// selection, as in any Mac app. The page reports the words, their size and where they sit.
    func lookUpSelection() {
        guard isReady else { return }
        callAsyncJavaScript("return window.leading.lookUpTarget()", arguments: [:], in: nil, in: .page) { [weak self] r in
            guard let self, let t = (try? r.get()) as? [String: Any], let text = t["text"] as? String, !text.isEmpty,
                  let x = (t["x"] as? NSNumber)?.doubleValue, let y = (t["y"] as? NSNumber)?.doubleValue else {
                self?.call("notice", ["text": "Select a word to look it up."]); return
            }
            let size = (t["size"] as? NSNumber)?.doubleValue ?? 17
            let font = NSFont(name: t["font"] as? String ?? "", size: size) ?? NSFont.systemFont(ofSize: size)
            // The page measures from the top; AppKit's point is the text's baseline in view coordinates.
            let baseline = isFlipped ? y : bounds.height - y
            showDefinition(for: NSAttributedString(string: text, attributes: [.font: font]), at: NSPoint(x: x, y: baseline))
        }
    }

    /// Call `window.leading.<fn>(args)` in the page, now or once it is ready.
    /// Arguments travel as native values, so even a 5 MB document needs no escaping.
    func call(_ fn: String, _ args: [String: Any] = [:]) {
        guard isReady else { queued.append((fn, args)); return }
        let params = args.keys.sorted().joined(separator: ", ")
        let body = "return window.leading.\(fn)(\(args.isEmpty ? "" : "{\(params)}"))"
        callAsyncJavaScript(body, arguments: args, in: nil, in: .page) { result in
            if case .failure(let error) = result { NSLog("Leading: page call \(fn) failed: \(error)") }
        }
    }

    fileprivate func received(_ message: [String: Any]) {
        switch message["type"] as? String {
        case "ready":
            isReady = true
            let pending = queued
            queued = []
            for (fn, args) in pending { call(fn, args) }
        case "painted": host?.pageDidPaint(message["ms"] as? Double ?? 0)
        case "loaded": host?.pageDidLoad(message["timings"] as? [String: Any] ?? [:])
        case "openLink": if let href = message["href"] as? String { host?.pageOpenLink(href) }
        case "openWiki": if let t = message["target"] as? String { host?.pageOpenWiki(target: t, heading: message["heading"] as? String) }
        case "canGoBack": host?.pageCanGoBack(message["can"] as? Bool ?? false)
        case "settings": if let s = message["settings"] as? [String: Any] { host?.pageChangedSettings(s) }
        case "edit": host?.pageEdited(message["edits"] as? [[String: Any]] ?? [])
        case "settled":
            host?.pageSettled(length: (message["length"] as? NSNumber)?.intValue ?? -1, hash: (message["hash"] as? NSNumber)?.uint32Value ?? 0)
        case "history": host?.pageHistory(canUndo: message["undo"] as? Bool ?? false, canRedo: message["redo"] as? Bool ?? false)
        case "mode": host?.pageMode(editing: message["editing"] as? Bool ?? false)
        case "place":
            if let s = (message["s"] as? NSNumber)?.intValue { host?.pageSavedPlace(s: s, dy: (message["dy"] as? NSNumber)?.doubleValue ?? 0) }
        case "speak": host?.pageSpeak(message["passages"] as? [String] ?? [], language: message["lang"] as? String)
        case "stopSpeaking": host?.pageStopSpeaking()
        case "backlinks": host?.pageWantsBacklinks()
        case "vaultSearch":
            if let q = message["query"] as? String { host?.pageSearchVault(q, id: (message["id"] as? NSNumber)?.intValue ?? 0) }
        case "sideTab": host?.pageSideTab(message["tab"] as? String ?? "outline")
        case "wikiTargets": host?.pageWikiTargets(message["targets"] as? [String] ?? [])
        case "openAt":
            if let href = message["href"] as? String, let q = message["query"] as? String {
                host?.pageOpenAt(href, query: q, s: (message["s"] as? NSNumber)?.intValue ?? -1)
            }
        case "log": NSLog("Leading page: %@", message["text"] as? String ?? "")
        case "overTable": overTable = message["over"] as? Bool ?? false
        case "copy":
            if let text = message["text"] as? String {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
        default: break
        }
    }

    // MARK: Navigation: the page itself loads, nothing else ever does.

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        if url?.scheme == SchemeHandler.scheme && url?.host() == "app" && action.navigationType == .other {
            decisionHandler(.allow)
        } else {
            // Links are routed through the page script; this is a backstop.
            if let url, action.navigationType == .linkActivated { host?.pageOpenLink(url.absoluteString) }
            decisionHandler(.cancel)
        }
    }

    /// If WebKit's page process ever dies, reload and let the window resend its document.
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("Leading: page failed to load: \(error)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("Leading: page failed to start loading: \(error)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        isReady = false
        reload()
    }

    // MARK: Right-click menu: drop browser items, add Copy Table as CSV over a table.

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        let unwanted: Set<String> = [
            "WKMenuItemIdentifierReload", "WKMenuItemIdentifierGoBack", "WKMenuItemIdentifierGoForward",
            "WKMenuItemIdentifierOpenLinkInNewWindow", "WKMenuItemIdentifierDownloadLinkedFile",
            "WKMenuItemIdentifierOpenImageInNewWindow", "WKMenuItemIdentifierDownloadImage",
            "WKMenuItemIdentifierOpenFrameInNewWindow", "WKMenuItemIdentifierCopyImage",
        ]
        menu.items.removeAll { unwanted.contains($0.identifier?.rawValue ?? "") }
        if overTable {
            let csv = NSMenuItem(title: "Copy Table as CSV", action: #selector(copyTableAsCSV), keyEquivalent: "")
            csv.target = self
            menu.insertItem(csv, at: 0)
            if menu.items.count > 1 { menu.insertItem(.separator(), at: 1) }
        }
        super.willOpenMenu(menu, with: event)
    }

    @objc private func copyTableAsCSV() { call("copyTableAsCSV") }
}

/// Breaks the retain cycle WebKit would otherwise create between the
/// content controller and the view handling its messages.
private final class MessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: ReaderWebView?
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if let body = message.body as? [String: Any] { target?.received(body) }
    }
}
