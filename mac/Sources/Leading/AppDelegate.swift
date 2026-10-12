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
}
