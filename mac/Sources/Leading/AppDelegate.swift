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
        // Launched without a file (from the Dock or Launchpad): offer to open one.
        // Stage 5 replaces this with the welcome document on first launch.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            let spike = ProcessInfo.processInfo.environment["LEADING_SPIKE_UPDATE"] == "1"
            if NSDocumentController.shared.documents.isEmpty && !spike {
                NSDocumentController.shared.openDocument(nil)
            }
        }
    }

    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { false }

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
        _ = (target as? NSResponder)?.tryToPerform(sel, with: nil)
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
}
