import AppKit
import Sparkle

/// Software updates through Sparkle, with EdDSA-signed releases.
///
/// Automatic checks are off unless the reader agrees (asked once, on first
/// launch, and in Settings): checking for updates is the only network request
/// Leading ever makes. Sparkle is started only when it is needed, either
/// because checks are on or because the reader chose Check for Updates.
final class Updates: NSObject, ObservableObject, SPUUpdaterDelegate, NSMenuItemValidation {
    static let shared = Updates()
    private var updater: SPUUpdater?
    private var userDriver: SPUStandardUserDriver?
    private let env = ProcessInfo.processInfo.environment

    /// For the update spike (scripts/spike-sparkle.sh): check a local feed at
    /// launch, download silently and install at once, with no dialogs.
    private var spike: Bool { env["LEADING_SPIKE_UPDATE"] == "1" }

    private func note(_ s: String) { if spike { NSLog("Leading spike: %@", s) } }

    /// Leading's own record of the reader's answer. Deliberately not Sparkle's
    /// SUEnableAutomaticChecks, which Sparkle writes itself: only the reader's
    /// explicit yes may turn checks on, and Sparkle's setting is made to follow.
    static let optInKey = "updateChecksOptedIn"

    @Published private(set) var optedIn = UserDefaults.standard.bool(forKey: Updates.optInKey)

    func setOptedIn(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: Updates.optInKey)
        optedIn = on
        if on { start()?.automaticallyChecksForUpdates = true }
        else { updater?.automaticallyChecksForUpdates = false }
    }

    func startIfEnabled() {
        guard optedIn || spike else { return }
        _ = start()
    }

    /// Leading › Check for Updates…: an explicit request, so it works whether
    /// or not automatic checks are on, and shows Sparkle's own progress window.
    @objc func checkForUpdates(_ sender: Any?) {
        start()?.checkForUpdates()
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        menuItem.action == #selector(checkForUpdates(_:)) ? (updater?.canCheckForUpdates ?? true) : true
    }

    /// Makes and starts Sparkle once. Its automatic checks always follow the
    /// reader's answer, whatever an earlier run left in its preferences.
    private func start() -> SPUUpdater? {
        if let updater { return updater }
        let bundle = Bundle.main
        let driver = SPUStandardUserDriver(hostBundle: bundle, delegate: nil)
        let u = SPUUpdater(hostBundle: bundle, applicationBundle: bundle, userDriver: driver, delegate: self)
        u.automaticallyChecksForUpdates = optedIn || spike
        do {
            try u.start()
        } catch {
            // Report configuration problems (bad key, bad feed) instead of failing silently.
            NSLog("Leading: updates could not start: %@", String(describing: error))
            return nil
        }
        userDriver = driver
        updater = u
        if spike {
            // Silent download and install need automatic checking on as well.
            u.automaticallyDownloadsUpdates = true
            note("checking \(env["LEADING_FEED_URL"] ?? "?")")
            u.checkForUpdatesInBackground()
        }
        return u
    }

    func feedURLString(for updater: SPUUpdater) -> String? { env["LEADING_FEED_URL"] }

    func updater(_ updater: SPUUpdater, didFinishLoading appcast: SUAppcast) { note("feed loaded, \(appcast.items.count) item(s)") }
    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) { note("found \(item.displayVersionString)") }
    func updaterDidNotFindUpdate(_ updater: SPUUpdater) { note("no update found") }
    func updater(_ updater: SPUUpdater, willDownloadUpdate item: SUAppcastItem, with request: NSMutableURLRequest) { note("downloading \(item.displayVersionString)") }
    func updater(_ updater: SPUUpdater, didExtractUpdate item: SUAppcastItem) { note("extracted and verified \(item.displayVersionString)") }
    func updater(_ updater: SPUUpdater, didDownloadUpdate item: SUAppcastItem) { note("downloaded \(item.displayVersionString)") }
    func updater(_ updater: SPUUpdater, failedToDownloadUpdate item: SUAppcastItem, error: Error) { note("download failed: \(error)") }
    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) { note("aborted: \(error)") }

    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock: @escaping () -> Void) -> Bool {
        guard spike else { return false }
        note("update \(item.displayVersionString) verified; installing now")
        immediateInstallationBlock()
        return true
    }
}
