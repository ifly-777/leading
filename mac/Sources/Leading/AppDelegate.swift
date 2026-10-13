import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        OpenTiming.shared.launchBegan()
        NSApp.mainMenu = MainMenu.build()
        // Load the reading page into a hidden web view now, so the first
        // document a user double-clicks goes into one that is already warm.
        WebViewPool.shared.prepare()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Updates.shared.startIfEnabled()
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

    @objc func showWelcome(_ sender: Any?) { FirstRun.openWelcome() }

    @objc func showWebsite(_ sender: Any?) {
        NSWorkspace.shared.open(URL(string: "https://github.com/ifly-777/leading")!)
    }

    // Document apps stay running with no windows, as on every Mac.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: Reading commands with no window on the usual route
    //
    // Menu commands normally reach the active document window through the
    // responder chain. When nothing is active (the app is in the background,
    // or a panel holds focus) they arrive here; send them to the front
    // document window instead of dropping them.

    private func forward(_ sel: Selector) {
        let target = (NSApp.mainWindow ?? NSApp.orderedWindows.first { $0.windowController is DocumentWindowController })?.windowController
        _ = target?.tryToPerform(sel, with: nil)
    }

    @objc func leadingFind(_ sender: Any?) { forward(#selector(ReaderActions.leadingFind(_:))) }
    @objc func leadingFindNext(_ sender: Any?) { forward(#selector(ReaderActions.leadingFindNext(_:))) }
    @objc func leadingFindPrevious(_ sender: Any?) { forward(#selector(ReaderActions.leadingFindPrevious(_:))) }
    @objc func leadingToggleOutline(_ sender: Any?) { forward(#selector(ReaderActions.leadingToggleOutline(_:))) }
    @objc func leadingBigger(_ sender: Any?) { forward(#selector(ReaderActions.leadingBigger(_:))) }
    @objc func leadingSmaller(_ sender: Any?) { forward(#selector(ReaderActions.leadingSmaller(_:))) }
    @objc func leadingActualSize(_ sender: Any?) { forward(#selector(ReaderActions.leadingActualSize(_:))) }
    @objc func leadingNarrower(_ sender: Any?) { forward(#selector(ReaderActions.leadingNarrower(_:))) }
    @objc func leadingWider(_ sender: Any?) { forward(#selector(ReaderActions.leadingWider(_:))) }
    @objc func leadingCycleTheme(_ sender: Any?) { forward(#selector(ReaderActions.leadingCycleTheme(_:))) }
    @objc func leadingTogglePlainText(_ sender: Any?) { forward(#selector(ReaderActions.leadingTogglePlainText(_:))) }
    @objc func leadingToggleEdit(_ sender: Any?) { forward(#selector(ReaderActions.leadingToggleEdit(_:))) }
    @objc func leadingFindReplace(_ sender: Any?) { forward(#selector(ReaderActions.leadingFindReplace(_:))) }

    // MARK: Settings (⌘,): the highlight colours

    private var settingsWindow: NSWindowController?

    @objc func showSettings(_ sender: Any?) {
        if settingsWindow == nil { settingsWindow = SettingsWindow.make() }
        settingsWindow?.showWindow(sender)
        settingsWindow?.window?.makeKeyAndOrderFront(sender)
    }
}
