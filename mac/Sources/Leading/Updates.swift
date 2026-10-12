import AppKit
import Sparkle

/// Software updates through Sparkle, with EdDSA-signed releases.
///
/// Off unless the reader agrees (Stage 5 asks once on first launch): checking
/// for updates is the only network request Leading ever makes. Sparkle is
/// started only when checks are enabled, so with them off it does nothing.
final class Updates: NSObject, SPUUpdaterDelegate {
    static let shared = Updates()
    private var updater: SPUUpdater?
    private var userDriver: SPUStandardUserDriver?
    private let env = ProcessInfo.processInfo.environment

    /// For the update spike (scripts/spike-sparkle.sh): check a local feed at
    /// launch, download silently and install at once, with no dialogs.
    private var spike: Bool { env["LEADING_SPIKE_UPDATE"] == "1" }

    private func note(_ s: String) { if spike { NSLog("Leading spike: %@", s) } }

    func startIfEnabled() {
        let enabled = UserDefaults.standard.bool(forKey: "SUEnableAutomaticChecks")
        guard enabled || spike else { return }
        let bundle = Bundle.main
        let driver = SPUStandardUserDriver(hostBundle: bundle, delegate: nil)
        let u = SPUUpdater(hostBundle: bundle, applicationBundle: bundle, userDriver: driver, delegate: self)
        userDriver = driver
        updater = u
        do {
            try u.start()
        } catch {
            // Report configuration problems (bad key, bad feed) instead of failing silently.
            NSLog("Leading: updates could not start: %@", String(describing: error))
            return
        }
        if spike {
            // Silent download and install need automatic checking on as well.
            u.automaticallyChecksForUpdates = true
            u.automaticallyDownloadsUpdates = true
            note("checking \(env["LEADING_FEED_URL"] ?? "?")")
            u.checkForUpdatesInBackground()
        }
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
