import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    func applicationWillFinishLaunching(_ notification: Notification) {
        OpenTiming.shared.launchBegan()
        NSApp.mainMenu = MainMenu.build()
        // Load the reading page into a hidden web view now, so the first
        // document a user double-clicks goes into one that is already warm.
        WebViewPool.shared.prepare()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Updates.shared.startIfEnabled()
        LockWatcher.shared.start()
        // The first-launch questions wait until the first window has appeared,
        // so they sit over the welcome document (or the file being opened).
        if FirstRun.isFirst { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { FirstRun.ask() } }
    }

    // Launched without a file (from the Dock or Launchpad), or the Dock icon
    // clicked with no windows open: a blank page, ready to write in. Closing
    // it with text in it brings macOS's own "keep this new document?" question;
    // quitting keeps it for next time. The very first launch shows the
    // welcome document instead.
    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool {
        if FirstRun.isFirst {
            FirstRun.openWelcome()
            return false
        }
        return ProcessInfo.processInfo.environment["LEADING_SPIKE_UPDATE"] != "1"
    }

    // MARK: Help

    @objc func showGuide(_ sender: Any?) { FirstRun.openGuide() }

    @objc func showWelcome(_ sender: Any?) { FirstRun.openWelcome() }

    @objc func showWebsite(_ sender: Any?) {
        NSWorkspace.shared.open(URL(string: "https://github.com/ifly-777/leading")!)
    }

    /// The Dock icon's menu: a new note, from anywhere.
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        let new = NSMenuItem(title: "New Note", action: #selector(NSDocumentController.newDocument(_:)), keyEquivalent: "")
        new.target = NSDocumentController.shared
        menu.addItem(new)
        return menu
    }

    // Document apps stay running with no windows, as on every Mac.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: Reading commands with no window on the usual route
    //
    // Menu commands normally reach the active document window through the
    // responder chain. When nothing is active (the app is in the background,
    // or a panel such as Settings or Aa holds focus) they arrive here; every
    // reading command goes on to the front document window, rather than a
    // list of some of them going grey.

    private var frontReader: DocumentWindowController? {
        (NSApp.mainWindow?.windowController as? DocumentWindowController)
            ?? NSApp.orderedWindows.lazy.compactMap { $0.windowController as? DocumentWindowController }.first
    }

    /// A reading command: one of Leading's own, which a document window answers.
    private func isReading(_ sel: Selector?) -> Bool {
        guard let sel else { return false }
        return NSStringFromSelector(sel).hasPrefix("leading") && DocumentWindowController.instancesRespond(to: sel)
    }

    override func responds(to aSelector: Selector!) -> Bool {
        if super.responds(to: aSelector) { return true }
        return isReading(aSelector) && frontReader != nil
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if isReading(aSelector), let reader = frontReader { return reader }
        return super.forwardingTarget(for: aSelector)
    }

    /// Ticks, titles and greying come from the window the command goes to.
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        guard isReading(item.action), !super.responds(to: item.action) else { return true }
        return frontReader?.validateMenuItem(item) ?? false
    }

    // Locking needs no window at all: ⌃⌘L works with Leading in front and nothing open.
    @objc func leadingLock(_ sender: Any?) { LockWatcher.lockAll() }

    // MARK: Settings (⌘,): the highlight colours

    private var settingsWindow: NSWindowController?

    @objc func showSettings(_ sender: Any?) {
        if settingsWindow == nil { settingsWindow = SettingsWindow.make() }
        settingsWindow?.showWindow(sender)
        settingsWindow?.window?.makeKeyAndOrderFront(sender)
    }
}
