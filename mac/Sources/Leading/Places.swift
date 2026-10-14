import AppKit
import LeadingCore

/// The app's one store of reading places (see `PlaceStore`).
enum Places {
    /// Nil while taking README pictures: those always open at the top.
    /// The self-test keeps its places in a temporary file, away from the reader's.
    static let shared: PlaceStore? = {
        if Snapshot.enabled { return nil }
        let folder = SelfTest.enabled
            ? FileManager.default.temporaryDirectory.appendingPathComponent("LeadingSelfTest", isDirectory: true)
            : (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))?
                .appendingPathComponent("Leading", isDirectory: true)
        guard let folder else { return nil }
        let store = PlaceStore(file: folder.appendingPathComponent("places.json"))
        // Write now and then while reading, so a crash loses at most a few seconds.
        Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in store.save() }
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in store.save() }
        return store
    }()
}
