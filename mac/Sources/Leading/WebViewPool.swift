import AppKit

/// Keeps one reading page loaded and waiting, so opening a document never
/// waits for WebKit to start a page process and load scripts and fonts.
final class WebViewPool {
    static let shared = WebViewPool()
    private var spare: ReaderWebView?

    func prepare() {
        if spare == nil { spare = ReaderWebView() }
    }

    /// A warm web view for a new window. The next spare is made once this
    /// window has painted (see DocumentWindowController), because creating a web
    /// view costs the main thread 50–80 ms, which would otherwise delay that
    /// first paint. A fallback makes it anyway if no paint is reported.
    func take() -> ReaderWebView {
        let view = spare ?? ReaderWebView()
        spare = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.prepare() }
        return view
    }
}
