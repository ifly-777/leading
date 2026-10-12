import AppKit
import Combine
import LeadingCore

/// One document's window: a warm reading page filling it, two quiet toolbar
/// buttons (outline, Aa), and the menu commands, which it forwards to the page.
final class DocumentWindowController: NSWindowController, NSWindowDelegate, NSToolbarDelegate, NSMenuItemValidation, ReaderWebViewHost, ReaderActions {
    private let web = WebViewPool.shared.take()
    private let imageBase: String
    private var settingsWatch: AnyCancellable?
    // The window shows at once, in the page's paper colour. Waiting for text
    // before showing it would backfire: WebKit pauses rendering in a window
    // that is not on screen, so the page could not paint until it appeared.
    private var painted = false
    private let aaPopover = NSPopover()

    private var doc: MarkdownDocument? { document as? MarkdownDocument }

    init(document: MarkdownDocument) {
        let size = DocumentWindowController.lastSize
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        // The page runs under a transparent title bar, so the paper fills the window.
        window.titlebarAppearsTransparent = true
        window.toolbarStyle = .unifiedCompact
        window.minSize = NSSize(width: 420, height: 320)
        window.tabbingMode = .automatic // follows System Settings › Desktop & Dock › "Prefer tabs when opening documents"
        // No zoom-in animation: the window appears at once, and WebKit does not
        // paint into a window until its opening animation has finished.
        window.animationBehavior = .none
        imageBase = document.fileURL.map { SchemeHandler.shared.imageBase(for: $0) } ?? ""
        super.init(window: window)
        shouldCascadeWindows = true
        window.delegate = self
        window.contentView = web
        window.center()
        let toolbar = NSToolbar(identifier: "reader")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        web.host = self
        aaPopover.behavior = .transient
        aaPopover.contentViewController = AaPanel.controller()

        applyAppearance(SettingsStore.shared.settings)
        sendSettings(SettingsStore.shared.settings)
        settingsWatch = SettingsStore.shared.$settings.dropFirst().sink { [weak self] s in
            self?.applyAppearance(s)
            self?.sendSettings(s)
        }
        // AppKit attaches `document` only after this initialiser returns, so pass it in directly.
        sendDocument(document, keepPlace: false)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    // MARK: Talking to the page

    func sendDocument(keepPlace: Bool) {
        if let doc { sendDocument(doc, keepPlace: keepPlace) }
    }

    private func sendDocument(_ doc: MarkdownDocument, keepPlace: Bool) {
        var args: [String: Any] = ["imageBase": imageBase, "plain": doc.showsPlainText, "keepPlace": keepPlace]
        // Small files travel inline with the call (quickest). Large ones are
        // fetched by the page instead: passing megabytes as a script argument
        // costs a quarter of a second, a fetch a few milliseconds.
        if doc.file.text.utf8.count < 200_000 {
            args["text"] = doc.file.text
        } else {
            args["textURL"] = SchemeHandler.shared.setText(doc.file.text, base: imageBase)
        }
        web.call("load", args)
    }

    private func sendSettings(_ s: ReaderSettings) {
        web.call("settings", ["settings": s.dictionary])
    }

    /// Match the window chrome to the chosen theme, so title bar, traffic lights
    /// and scroll bars agree with the page. "Auto" follows the system.
    private func applyAppearance(_ s: ReaderSettings) {
        switch s.theme {
        case "dark": window?.appearance = NSAppearance(named: .darkAqua)
        case "light", "sepia": window?.appearance = NSAppearance(named: .aqua)
        default: window?.appearance = nil
        }
        let paper: [String: NSColor] = [
            "light": NSColor(srgbRed: 0xFB / 255, green: 0xF8 / 255, blue: 0xF2 / 255, alpha: 1),
            "sepia": NSColor(srgbRed: 0xF4 / 255, green: 0xEA / 255, blue: 0xD5 / 255, alpha: 1),
            "dark": NSColor(srgbRed: 0x1E / 255, green: 0x1D / 255, blue: 0x1B / 255, alpha: 1),
        ]
        // Seen only for a moment while resizing; keep it the paper colour, not white.
        let isDark = window?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        window?.backgroundColor = paper[s.theme] ?? (isDark ? paper["dark"] : paper["light"])
    }

    func pageDidPaint(_ ms: Double) {
        guard !painted else { return }
        painted = true
        if let doc { OpenTiming.shared.painted(file: doc.fileURL, openedAt: doc.openedAt, pageMs: ms) }
        // Text is on screen; now is a good moment to warm the next page.
        DispatchQueue.main.async { WebViewPool.shared.prepare() }
    }

    func pageDidLoad(_ timings: [String: Any]) {
        OpenTiming.shared.loaded(file: doc?.fileURL, details: timings)
    }

    func pageChangedSettings(_ settings: [String: Any]) {
        SettingsStore.shared.update(fromPage: settings)
    }

    func pageOpenLink(_ href: String) {
        switch Paths.linkTarget(href, document: doc?.fileURL) {
        case .external(let url): NSWorkspace.shared.open(url)
        case .document(let url): NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
        case .otherFile(let url):
            if FileManager.default.fileExists(atPath: url.path) { NSWorkspace.shared.open(url) } else { NSSound.beep() }
        case .none: NSSound.beep()
        }
    }

    // MARK: Menu commands

    private func command(_ name: String) { web.call("command", ["name": name]) }

    @objc func leadingFind(_ sender: Any?) { command("find") }
    @objc func leadingFindNext(_ sender: Any?) { command("findNext") }
    @objc func leadingFindPrevious(_ sender: Any?) { command("findPrevious") }
    @objc func leadingToggleOutline(_ sender: Any?) { command("toggleOutline") }
    @objc func leadingBigger(_ sender: Any?) { command("bigger") }
    @objc func leadingSmaller(_ sender: Any?) { command("smaller") }
    @objc func leadingActualSize(_ sender: Any?) { command("actualSize") }
    @objc func leadingNarrower(_ sender: Any?) { command("narrower") }
    @objc func leadingWider(_ sender: Any?) { command("wider") }
    @objc func leadingCycleTheme(_ sender: Any?) { command("cycleTheme") }
    @objc func leadingTogglePlainText(_ sender: Any?) {
        guard let doc else { return }
        doc.showsPlainText.toggle()
        sendDocument(keepPlace: true)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(leadingToggleOutline(_:)):
            item.title = SettingsStore.shared.settings.outlineOpen ? "Hide Outline" : "Show Outline"
        case #selector(leadingTogglePlainText(_:)):
            item.state = doc?.showsPlainText == true ? .on : .off
        default: break
        }
        return true
    }

    // MARK: Toolbar: outline and Aa, nothing else

    private static let outlineID = NSToolbarItem.Identifier("outline")
    private static let aaID = NSToolbarItem.Identifier("aa")

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [.flexibleSpace, Self.outlineID, Self.aaID] }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { toolbarDefaultItemIdentifiers(toolbar) }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: id)
        item.isBordered = true
        item.target = self
        if id == Self.outlineID {
            item.image = NSImage(systemSymbolName: "list.bullet.indent", accessibilityDescription: "Outline")
            item.label = "Outline"
            item.toolTip = "Show or hide the outline (⌥⌘O)"
            item.action = #selector(leadingToggleOutline(_:))
        } else {
            item.image = NSImage(systemSymbolName: "textformat.size", accessibilityDescription: "Reading settings")
            item.label = "Aa"
            item.toolTip = "Font, size, spacing and theme"
            item.action = #selector(showAaPanel(_:))
        }
        return item
    }

    @objc private func showAaPanel(_ sender: NSToolbarItem) {
        if aaPopover.isShown { aaPopover.close(); return }
        aaPopover.show(relativeTo: sender)
    }

    // MARK: Window size: new windows open at the size the reader last chose

    private static var lastSize: NSSize {
        let s = NSSizeFromString(UserDefaults.standard.string(forKey: "windowSize") ?? "")
        return s.width >= 420 ? s : NSSize(width: 920, height: 900)
    }

    func windowWillClose(_ notification: Notification) {
        SchemeHandler.shared.forget(base: imageBase)
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        if let size = window?.frame.size { UserDefaults.standard.set(NSStringFromSize(size), forKey: "windowSize") }
    }
}
