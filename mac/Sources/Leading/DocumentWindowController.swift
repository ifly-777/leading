import AppKit
import Combine
import LeadingCore

/// One document's window: a warm reading page filling it, two quiet toolbar
/// buttons (outline, Aa), and the menu commands, which it forwards to the page.
final class DocumentWindowController: NSWindowController, NSWindowDelegate, NSToolbarDelegate, NSMenuItemValidation, ReaderWebViewHost, ReaderActions {
    /// The reading page; nil while the note is locked. Locking throws the page away,
    /// with its text, rendering and undo history, rather than trying to clear it.
    private var web: ReaderWebView?
    /// A heading a link asked for while the note was locked, for when it opens.
    private var pendingHeading: String?
    private let imageBase: String
    private var settingsWatch: AnyCancellable?
    // The window shows at once, in the page's paper colour. Waiting for text
    // before showing it would backfire: WebKit pauses rendering in a window
    // that is not on screen, so the page could not paint until it appeared.
    private var painted = false
    private var editing = false
    private var canUndo = false
    private var canGoBack = false
    private var canRedo = false
    private let aaPopover = NSPopover()
    /// The outline button stays pressed while the outline is showing.
    private var outlineButton: NSButton?
    /// View › Read Aloud: made on first use.
    private lazy var speaker: Speaker = {
        let s = Speaker()
        s.onWord = { [weak self] seg, loc, len in
            DispatchQueue.main.async { self?.web?.call("speechWord", ["seg": seg, "loc": loc, "len": len]) }
        }
        s.onEnd = { [weak self] in DispatchQueue.main.async { self?.web?.call("speechEnded") } }
        return s
    }()
    private var speakerMade = false
    /// The vault this window's note belongs to, held so its index stays live.
    private var vaultRoot: URL?
    private var vaultWatch: NSObjectProtocol?

    private var doc: MarkdownDocument? { document as? MarkdownDocument }
    /// The window's page, for the self-test only.
    var pageForTests: ReaderWebView { web! }

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
        imageBase = document.fileURL.map { SchemeHandler.shared.imageBase(for: $0) } ?? SchemeHandler.shared.untitledBase()
        super.init(window: window)
        shouldCascadeWindows = true
        window.delegate = self
        window.center()
        let toolbar = NSToolbar(identifier: "reader")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        aaPopover.behavior = .transient
        aaPopover.contentViewController = AaPanel.controller()

        applyAppearance(SettingsStore.shared.settings)
        settingsWatch = SettingsStore.shared.$settings.dropFirst().sink { [weak self] s in
            self?.applyAppearance(s)
            self?.outlineButton?.state = s.outlineOpen ? .on : .off
            self?.sendSettings(s)
        }
        // The page keeps a band of paper behind the title bar, and the tab bar when there
        // are tabs; it needs their height, which changes as tabs come and go.
        chromeWatch = window.observe(\.contentLayoutRect, options: [.initial, .new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.sendChrome() }
        }
        // A vault's index changed: the Links and Search tabs look again if they are showing.
        vaultWatch = NotificationCenter.default.addObserver(forName: .vaultChanged, object: nil, queue: .main) { [weak self] note in
            guard let self, let root = note.object as? URL, root == self.vaultRoot else { return }
            self.web?.call("vaultChanged")
        }
        holdVault(document.fileURL)
        // AppKit attaches `document` only after this initialiser returns, so pass it in directly.
        if document.isPasswordLocked {
            showLocked(document)
        } else {
            attachPage()
            // A new, unsaved document starts in edit mode: there is nothing to read yet.
            sendDocument(document, keepPlace: false, startEditing: document.fileURL == nil)
        }
    }

    /// Put a warm reading page in the window and bring it up to date.
    private func attachPage() {
        let page = WebViewPool.shared.take()
        page.host = self
        web = page
        window?.contentView = page
        lastChrome = -1
        sendSettings(SettingsStore.shared.settings)
        sendChrome()
    }

    // MARK: Locking

    private func showLocked(_ doc: MarkdownDocument) {
        let name = doc.fileURL?.deletingPathExtension().lastPathComponent ?? doc.displayName ?? "Note"
        window?.contentView = LockedView(name: name, unlock: { [weak doc] password, done in
            guard let doc else { return done(.wrong) }
            doc.unlock(password: password, done: done)
        }, restore: { [weak doc] password, done in
            guard let doc else { return done(false) }
            doc.restoreKeptCopy(password: password, done: done)
        })
    }

    func documentLocked() {
        guard let doc else { return }
        if speakerMade { speaker.stop() }
        if aaPopover.isShown { aaPopover.close() }
        if let page = web {
            page.host = nil
            page.stopLoading()
            web = nil
            // Drops the copy of a long note's text held for the page to fetch.
            SchemeHandler.shared.forget(base: imageBase)
        }
        editing = false; canUndo = false; canRedo = false; canGoBack = false
        showLocked(doc)
    }

    func documentUnlocked() {
        guard let doc, web == nil else { return }
        if let url = doc.fileURL { SchemeHandler.shared.setFolder(base: imageBase, document: url) }
        attachPage()
        sendDocument(doc, keepPlace: false)
        if let heading = pendingHeading { pendingHeading = nil; jumpToHeading(heading) }
        if let web { window?.makeFirstResponder(web) }
    }

    /// Keep the index of the vault the note is in, letting go of the one it was in before.
    private func holdVault(_ url: URL?) {
        let root = url.flatMap { Vaults.shared.root(for: $0) }
        guard root != vaultRoot else { return }
        if let old = vaultRoot { Vaults.shared.release(old) }
        vaultRoot = root
        if let root { Vaults.shared.hold(root) }
    }

    func documentMoved(to url: URL) {
        holdVault(url)
        SchemeHandler.shared.setFolder(base: imageBase, document: url)
        web?.call("setName", ["name": url.deletingPathExtension().lastPathComponent])
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    // MARK: Talking to the page

    /// Show the document's text. `fromDisk`: it came from the file (changed
    /// elsewhere, or a version restored), so the editor starts again from it.
    func sendDocument(keepPlace: Bool, fromDisk: Bool = false) {
        if let doc { sendDocument(doc, keepPlace: keepPlace, fromDisk: fromDisk) }
    }

    private func sendDocument(_ doc: MarkdownDocument, keepPlace: Bool, fromDisk: Bool = false, startEditing: Bool = false) {
        guard web != nil, !doc.isPasswordLocked else { return }
        var args: [String: Any] = ["imageBase": imageBase, "plain": doc.showsPlainText, "keepPlace": keepPlace, "fromDisk": fromDisk, "edit": startEditing, "noEdit": doc.isGuide]
        // For the link back that Copy as Quote adds: the note's name, as a wikilink names it.
        if let url = doc.fileURL { args["name"] = url.deletingPathExtension().lastPathComponent }
        // Opening afresh: go back to where the reader stopped last time.
        if !keepPlace, !fromDisk, !startEditing, !doc.showsPlainText, let url = doc.fileURL, let place = Places.shared?.place(for: url) {
            args["resume"] = ["s": place.s, "dy": place.dy]
        }
        let text = doc.text
        // Small files travel inline with the call (quickest). Large ones are
        // fetched by the page instead: passing megabytes as a script argument
        // costs a quarter of a second, a fetch a few milliseconds.
        if text.utf8.count < 200_000 {
            args["text"] = text
        } else {
            args["textURL"] = SchemeHandler.shared.setText(text, base: imageBase)
        }
        web?.call("load", args)
    }

    private func sendSettings(_ s: ReaderSettings) {
        web?.call("settings", ["settings": s.dictionary])
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
        if Snapshot.enabled, let window, let web { Snapshot.take(window: window, page: web, controller: self) }
        // The self-test waits until a second window is open, so it can check settings reach both.
        if SelfTest.enabled, let window {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                if NSApp.windows.filter({ $0.windowController is DocumentWindowController }).count >= 2 { if let web = self.web { SelfTest.run(in: window, page: web) } }
            }
        }
    }

    func pageDidLoad(_ timings: [String: Any]) {
        OpenTiming.shared.loaded(file: doc?.fileURL, details: timings)
    }

    func pageChangedSettings(_ settings: [String: Any]) {
        SettingsStore.shared.update(fromPage: settings)
    }

    // MARK: Editing

    func pageEdited(_ edits: [[String: Any]]) {
        guard let doc else { return }
        let changes = edits.compactMap { e -> TextMirror.Change? in
            guard let from = (e["from"] as? NSNumber)?.intValue, let to = (e["to"] as? NSNumber)?.intValue else { return nil }
            return TextMirror.Change(from: from, to: to, insert: e["insert"] as? String ?? "")
        }
        if changes.count != edits.count || !doc.applyEdits(changes) { resync() }
    }

    /// Typing paused: confirm Swift's copy matches the editor's, or take the editor's.
    func pageSettled(length: Int, hash: UInt32) {
        guard let doc else { return }
        if doc.mirror.utf16Count != length || doc.mirror.fingerprint != hash {
            NSLog("Leading: the saved copy of %@ disagreed with the editor; taking the editor's text", doc.displayName)
            resync()
        }
    }

    private func resync() {
        web?.fetchText { [weak self] text in
            if let text, let doc = self?.doc { doc.resync(text) }
        }
    }

    func pageHistory(canUndo: Bool, canRedo: Bool) {
        self.canUndo = canUndo
        self.canRedo = canRedo
    }

    func pageMode(editing: Bool) {
        self.editing = editing
    }

    func pageSavedPlace(s: Int, dy: Double) {
        guard let url = doc?.fileURL else { return }
        Places.shared?.set(Place(s: s, dy: dy), for: url)
    }

    func pageOpenLink(_ href: String) {
        switch Paths.linkTarget(href, document: doc?.fileURL) {
        case .external(let url): NSWorkspace.shared.open(url)
        case .document(let url): open(url, heading: Paths.fragment(href))
        case .otherFile(let url):
            if FileManager.default.fileExists(atPath: url.path) { NSWorkspace.shared.open(url) } else { NSSound.beep() }
        case .none: NSSound.beep()
        }
    }

    /// [[Note#Heading]]: find the note in the vault, off the main thread (a big vault takes a moment).
    func pageOpenWiki(target: String, heading: String?) {
        let from = doc?.fileURL
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            // From the vault's index when it is ready; otherwise by searching the disk.
            let found: URL?
            if let from, let index = Vaults.shared.index(for: from) {
                found = index.resolve(target, from: from)
            } else {
                found = Paths.wikiTarget(target, document: from)
            }
            DispatchQueue.main.async {
                guard let found else { NSSound.beep(); return }
                switch Paths.classifyFile(found) {
                case .document(let url): self?.open(url, heading: heading)
                default: NSWorkspace.shared.open(found)
                }
            }
        }
    }

    /// Open a document in Leading (or bring it forward), then go to the heading the link named.
    private func open(_ url: URL, heading: String?) {
        open(url) { wc in if let heading { wc.jumpToHeading(heading) } }
    }

    /// Open a document in Leading (or bring it forward), then hand its window to `then`.
    private func open(_ url: URL, then: @escaping (DocumentWindowController) -> Void) {
        if let mine = doc?.fileURL, mine.standardizedFileURL.resolvingSymlinksInPath() == url.standardizedFileURL.resolvingSymlinksInPath() {
            then(self)
            return
        }
        // A followed link opens as a new tab beside this note, whatever macOS's own
        // tab preference: reading on from a link is one train of thought, not a new task.
        // A note that is already open is brought forward where it is.
        NSDocumentController.shared.openDocument(withContentsOf: url, display: false) { [weak self] opened, alreadyOpen, error in
            guard let opened else {
                if let error { NSApp.presentError(error) } else { NSSound.beep() }
                return
            }
            if alreadyOpen || !opened.windowControllers.isEmpty {
                opened.showWindows()
            } else {
                opened.makeWindowControllers()
                if let tab = opened.windowControllers.first?.window, let here = self?.window {
                    here.addTabbedWindow(tab, ordered: .above)
                    tab.makeKeyAndOrderFront(nil)
                } else {
                    opened.showWindows()
                }
            }
            guard let wc = opened.windowControllers.first as? DocumentWindowController else { return }
            then(wc)
        }
    }

    /// The page waits for its document to finish loading before it jumps.
    func jumpToHeading(_ text: String) {
        guard let web else { pendingHeading = text; return }
        web.call("jumpToHeading", ["text": text])
    }

    func pageCanGoBack(_ can: Bool) { canGoBack = can }

    func pageSpeak(_ passages: [String], language: String?) {
        speakerMade = true
        speaker.speak(passages, language: language)
    }

    func pageStopSpeaking() { if speakerMade { speaker.stop() } }

    /// The margin's Links tab: notes in the vault that link here, found off the main thread.
    func pageWantsBacklinks() {
        guard let url = doc?.fileURL else {
            web?.call("backlinks", ["items": [[String: Any]](), "saved": false])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let found = Vaults.shared.index(for: url)?.backlinks(to: url) ?? Backlinks.find(to: url)
            let items: [[String: Any]] = found.map { ["name": $0.name, "href": $0.url.absoluteString, "lines": $0.lines] }
            DispatchQueue.main.async { self?.web?.call("backlinks", ["items": items, "saved": true]) }
        }
    }

    /// The margin's Search tab: notes in the vault holding the words, from its index.
    func pageSearchVault(_ query: String, id: Int) {
        func answer(_ state: String, _ result: SearchResult? = nil) {
            let items: [[String: Any]] = result?.hits.map { hit in
                ["name": hit.name, "href": hit.url.absoluteString, "count": hit.count,
                 "lines": hit.lines.map { ["text": $0.text, "s": $0.offset] }]
            } ?? []
            web?.call("searchResults", ["id": id, "items": items, "notes": result?.notes ?? 0, "total": result?.total ?? 0, "state": state])
        }
        guard let url = doc?.fileURL else { return answer("unsaved") }
        guard Vaults.shared.root(for: url) != nil else { return answer("broad") }
        // Not built yet: say so; the page asks again when the vault's index is ready.
        guard let index = Vaults.shared.index(for: url) else { return answer("indexing") }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = index.search(query)
            DispatchQueue.main.async { if self != nil { answer("ok", result) } }
        }
    }

    /// A search result: open its note (or go to it, if it is this one) with Find on the words, at the line.
    func pageOpenAt(_ href: String, query: String, s: Int) {
        guard let url = URL(string: href), url.isFileURL else { return }
        open(url) { wc in wc.findAt(query, s: s) }
    }

    /// The page waits for its document to finish loading before it finds.
    func findAt(_ query: String, s: Int) {
        web?.call("findAt", ["query": query, "s": s])
    }

    // MARK: Menu commands

    private func command(_ name: String) { web?.call("command", ["name": name]) }

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
    @objc func leadingToggleEdit(_ sender: Any?) {
        // The menu item is off for the guide; this also stops a direct send.
        guard doc?.isGuide != true else { return NSSound.beep() }
        command("toggleEdit")
    }
    @objc func leadingFindReplace(_ sender: Any?) { command("findReplace") }
    @objc func leadingUndo(_ sender: Any?) { command("undo") }
    @objc func leadingRedo(_ sender: Any?) { command("redo") }
    @objc func leadingBold(_ sender: Any?) { command("bold") }
    @objc func leadingItalic(_ sender: Any?) { command("italic") }
    @objc func leadingUnderline(_ sender: Any?) { command("underline") }
    @objc func leadingStrike(_ sender: Any?) { command("strike") }
    @objc func leadingCode(_ sender: Any?) { command("code") }
    @objc func leadingLink(_ sender: Any?) { command("link") }
    @objc func leadingBulletList(_ sender: Any?) { command("bulletList") }
    @objc func leadingNumberList(_ sender: Any?) { command("numberList") }
    @objc func leadingTable(_ sender: Any?) { command("table") }
    @objc func leadingToggleSmartTyping(_ sender: Any?) { SettingsStore.shared.settings.smartTyping.toggle() }
    @objc func leadingBack(_ sender: Any?) { command("back") }
    @objc func leadingShowHighlights(_ sender: Any?) { command("showHighlights") }
    @objc func leadingShowLinks(_ sender: Any?) { command("showLinks") }
    @objc func leadingSearchVault(_ sender: Any?) { command("searchVault") }
    @objc func leadingReadAloud(_ sender: Any?) {
        if speakerMade && speaker.isSpeaking { speaker.stop() } else { command("readAloud") }
    }
    @objc func leadingLookUp(_ sender: Any?) { web?.lookUpSelection() }
    @objc func leadingCopyHighlights(_ sender: Any?) { command("copyHighlights") }
    @objc func leadingCopyQuote(_ sender: Any?) { command("copyQuote") }
    @objc func leadingPageBreak(_ sender: Any?) { command("pageBreak") }

    // MARK: Print and Export as PDF

    @objc func leadingPrint(_ sender: Any?) { runPrint(to: nil) }

    @objc func leadingExportPDF(_ sender: Any?) {
        guard let window else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = (doc?.fileURL?.deletingPathExtension().lastPathComponent ?? doc?.displayName ?? "Untitled") + ".pdf"
        panel.beginSheetModal(for: window) { [weak self] r in
            guard r == .OK, let url = panel.url else { return }
            // The panel is still closing; print once it has gone, or the next sheet cannot attach.
            DispatchQueue.main.async { self?.runPrint(to: url) }
        }
    }

    /// Print through WebKit, so the text is split into real pages. With `url`, the
    /// pages go into a PDF there instead of to a printer. The page first readies
    /// itself for paper (light theme, every diagram and image) and is put back after.
    func runPrint(to url: URL?, done: (() -> Void)? = nil) {
        guard let window, let web else { return }
        // The print sheet hangs from this window: if it is a tab behind another, bring it forward.
        window.makeKeyAndOrderFront(nil)
        web.callAsyncJavaScript("return window.leading.preparePrint()", arguments: [:], in: nil, in: .page) { [weak self] _ in
            guard let self else { return }
            let info = (self.doc?.printInfo ?? NSPrintInfo.shared).copy() as! NSPrintInfo
            info.horizontalPagination = .fit
            info.verticalPagination = .automatic
            info.isHorizontallyCentered = false
            info.isVerticallyCentered = false
            // Margins for reading in the hand: three quarters of an inch, a little more at the foot.
            info.topMargin = 54; info.bottomMargin = 60; info.leftMargin = 54; info.rightMargin = 54
            if let url {
                info.jobDisposition = .save
                info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = url
            }
            let op = web.printOperation(with: info)
            op.showsPrintPanel = url == nil
            op.showsProgressPanel = true
            op.jobTitle = self.doc?.displayName ?? "Leading"
            // WebKit prints blank pages unless its print view is given a size first.
            op.view?.frame = web.bounds
            self.printDone = done
            op.runModal(for: window, delegate: self, didRun: #selector(self.printOperationDidRun(_:success:contextInfo:)), contextInfo: nil)
        }
    }

    private var printDone: (() -> Void)?
    private var chromeWatch: NSKeyValueObservation?
    private var lastChrome: CGFloat = -1

    /// Tell the page how tall the bars over it are (title bar, plus tab bar when tabbed).
    private func sendChrome() {
        guard let window else { return }
        let top = window.frame.height - window.contentLayoutRect.maxY
        guard top > 0, abs(top - lastChrome) > 0.5 else { return }
        lastChrome = top
        web?.call("chrome", ["top": top])
    }

    @objc private func printOperationDidRun(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        web?.callAsyncJavaScript("return window.leading.afterPrint()", arguments: [:], in: nil, in: .page) { _ in }
        printDone?()
        printDone = nil
    }
    @objc func leadingToggleProgress(_ sender: Any?) { SettingsStore.shared.settings.progress.toggle() }
    @objc func leadingToggleFocus(_ sender: Any?) { SettingsStore.shared.settings.focus.toggle() }
    @objc func leadingTogglePaged(_ sender: Any?) { SettingsStore.shared.settings.paged.toggle() }
    @objc func leadingHighlight(_ sender: Any?) { command("highlight") }
    @objc func leadingHighlightYellow(_ sender: Any?) { command("highlightYellow") }
    @objc func leadingHighlightGreen(_ sender: Any?) { command("highlightGreen") }
    @objc func leadingHighlightBlue(_ sender: Any?) { command("highlightBlue") }
    @objc func leadingHighlightPink(_ sender: Any?) { command("highlightPink") }
    @objc func leadingHighlightOrange(_ sender: Any?) { command("highlightOrange") }
    @objc func leadingRemoveHighlight(_ sender: Any?) { command("removeHighlight") }
    // MARK: Encryption commands

    @objc func leadingLock(_ sender: Any?) { LockWatcher.lockAll() }

    @objc func leadingEncrypt(_ sender: Any?) {
        guard let doc, doc.canEncrypt, let window else { return }
        PasswordSheet.show(.encrypt, name: doc.displayName, on: window) { _, new, done in
            doc.encrypt(password: new, done: done)
        }
    }

    @objc func leadingChangePassword(_ sender: Any?) {
        guard let doc, doc.isEncrypted, !doc.isPasswordLocked, let window else { return }
        PasswordSheet.show(.change, name: doc.displayName, on: window) { current, new, done in
            doc.changePassword(current: current, new: new, done: done)
        }
    }

    @objc func leadingRemoveEncryption(_ sender: Any?) {
        guard let doc, doc.isEncrypted, !doc.isPasswordLocked, let window else { return }
        PasswordSheet.show(.remove, name: doc.displayName, on: window) { current, _, done in
            doc.removeEncryption(password: current, done: done)
        }
    }

    @objc func leadingTogglePlainText(_ sender: Any?) {
        guard let doc else { return }
        doc.showsPlainText.toggle()
        sendDocument(keepPlace: true)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        // Setting up encryption is for a saved note; the rest for an encrypted one, unlocked.
        case #selector(leadingEncrypt(_:)): return doc?.canEncrypt == true
        case #selector(leadingLock(_:)): return LockWatcher.anyUnlocked
        case #selector(leadingChangePassword(_:)), #selector(leadingRemoveEncryption(_:)):
            return doc?.isEncrypted == true && doc?.isPasswordLocked == false
        default: break
        }
        // A locked note has no page: nothing else here has anything to act on.
        if doc?.isPasswordLocked == true { return false }
        switch item.action {
        case #selector(leadingToggleOutline(_:)):
            item.title = SettingsStore.shared.settings.outlineOpen ? "Hide Outline" : "Show Outline"
        case #selector(leadingTogglePlainText(_:)):
            item.state = doc?.showsPlainText == true ? .on : .off
            return !editing
        case #selector(leadingToggleEdit(_:)):
            item.title = editing ? "Read" : "Edit Source"
            return doc?.isGuide != true
        case #selector(leadingUndo(_:)): return canUndo
        case #selector(leadingRedo(_:)): return canRedo
        // Formatting and Replace change the file, so they exist only while editing.
        case #selector(leadingBold(_:)), #selector(leadingItalic(_:)), #selector(leadingUnderline(_:)),
             #selector(leadingStrike(_:)), #selector(leadingCode(_:)), #selector(leadingLink(_:)),
             #selector(leadingBulletList(_:)), #selector(leadingNumberList(_:)), #selector(leadingTable(_:)), #selector(leadingPageBreak(_:)),
             #selector(leadingFindReplace(_:)):
            return editing
        // Highlights need the rendered Markdown (or its source); not plain text.
        case #selector(leadingHighlight(_:)):
            let last = SettingsStore.shared.settings.lastHighlight
            item.title = "Highlight (\(HighlightColors.names[last] ?? "Yellow"))"
            return doc?.showsPlainText != true || editing
        case #selector(leadingHighlightYellow(_:)), #selector(leadingHighlightGreen(_:)), #selector(leadingHighlightBlue(_:)),
             #selector(leadingHighlightPink(_:)), #selector(leadingHighlightOrange(_:)), #selector(leadingRemoveHighlight(_:)):
            return doc?.showsPlainText != true || editing
        case #selector(leadingToggleSmartTyping(_:)):
            item.state = SettingsStore.shared.settings.smartTyping ? .on : .off
        case #selector(leadingBack(_:)): return canGoBack
        // The list is of the rendered page: not for plain text, and read in reading mode.
        case #selector(leadingShowHighlights(_:)), #selector(leadingCopyHighlights(_:)), #selector(leadingShowLinks(_:)):
            return doc?.showsPlainText != true && !editing
        case #selector(leadingSearchVault(_:)): return !editing
        case #selector(leadingReadAloud(_:)):
            let speaking = speakerMade && speaker.isSpeaking
            item.title = speaking ? "Stop Reading Aloud" : "Read Aloud"
            return speaking || !editing
        case #selector(leadingToggleProgress(_:)):
            item.state = SettingsStore.shared.settings.progress ? .on : .off
        case #selector(leadingToggleFocus(_:)):
            item.state = SettingsStore.shared.settings.focus ? .on : .off
        case #selector(leadingTogglePaged(_:)):
            item.state = SettingsStore.shared.settings.paged ? .on : .off
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
            // A button that stays pressed, so the toolbar shows whether the outline is on.
            // (A plain toolbar item has no on state.)
            let image = NSImage(systemSymbolName: "list.bullet.indent", accessibilityDescription: "Outline")!
            let button = NSButton(image: image, target: self, action: #selector(leadingToggleOutline(_:)))
            button.bezelStyle = .toolbar
            button.setButtonType(.pushOnPushOff)
            button.state = SettingsStore.shared.settings.outlineOpen ? .on : .off
            outlineButton = button
            item.view = button
            item.label = "Outline"
            item.toolTip = "Show or hide the outline (⌥⌘O)"
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
        if let size = Snapshot.windowSize { return size }
        let s = NSSizeFromString(UserDefaults.standard.string(forKey: "windowSize") ?? "")
        return s.width >= 420 ? s : NSSize(width: 920, height: 900)
    }

    func windowWillClose(_ notification: Notification) {
        if speakerMade { speaker.stop() }
        SchemeHandler.shared.forget(base: imageBase)
        Places.shared?.save()
        holdVault(nil)
        if let vaultWatch { NotificationCenter.default.removeObserver(vaultWatch) }
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        if let size = window?.frame.size { UserDefaults.standard.set(NSStringFromSize(size), forKey: "windowSize") }
    }
}
