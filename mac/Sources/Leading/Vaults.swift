import CoreServices
import Foundation
import LeadingCore

extension Notification.Name {
    /// A vault's index changed: notes were added, edited, moved or removed. `object` is the vault's root URL.
    static let vaultChanged = Notification.Name("LeadingVaultChanged")
}

/// The vaults of the notes that are open, each indexed in memory and kept
/// current by watching its folder. An index is built in the background the
/// first time a window holds its vault, and let go half a minute after the
/// last window holding it closes. Nothing is written to disk.
///
/// Until an index is ready, `index(for:)` is nil and callers search the disk
/// as before. A note whose vault would be the home folder or a disk's top
/// gets no index: watching and holding all of that is not worth it.
final class Vaults {
    static let shared = Vaults()

    private final class Held {
        let index: VaultIndex
        var count = 0
        var ready = false
        var stream: FSEventStreamRef?
        var letGo: DispatchWorkItem?
        init(_ index: VaultIndex) { self.index = index }
    }

    private let lock = NSLock()
    private var held: [String: Held] = [:]
    /// Builds and updates run here, one at a time.
    private let queue = DispatchQueue(label: "io.github.ifly-777.leading.vaults", qos: .utility)

    /// The vault a document belongs to, resolved; nil if it is too broad to keep.
    func root(for document: URL) -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.resolvingSymlinksInPath()
        let root = Paths.vaultRoot(for: document.deletingLastPathComponent()).standardizedFileURL.resolvingSymlinksInPath()
        let parts = root.pathComponents
        if root.path == home.path || parts.count <= 1 || (parts.count <= 3 && parts.dropFirst().first == "Volumes") { return nil }
        return root
    }

    /// The index for a document's vault, if it is built. Any thread.
    func index(for document: URL) -> VaultIndex? {
        guard let root = root(for: document) else { return nil }
        lock.lock(); defer { lock.unlock() }
        guard let h = held[root.path], h.ready else { return nil }
        return h.index
    }

    /// Whether a document's vault is being indexed and not ready yet. Any thread.
    func isIndexing(_ document: URL) -> Bool {
        guard let root = root(for: document) else { return false }
        lock.lock(); defer { lock.unlock() }
        return held[root.path].map { !$0.ready } ?? false
    }

    /// A window shows a note from this vault. Main thread.
    func hold(_ root: URL) {
        lock.lock()
        let h: Held
        var start = false
        if let existing = held[root.path] {
            h = existing
        } else {
            h = Held(VaultIndex(root: root))
            held[root.path] = h
            start = true
        }
        h.count += 1
        h.letGo?.cancel()
        h.letGo = nil
        lock.unlock()
        guard start else { return }
        // Watch first, so a change made while the vault is read is not missed: its
        // update waits on the queue behind the build, and reads the file again.
        h.stream = watch(root)
        queue.async {
            h.index.build()
            self.lock.lock(); h.ready = true; self.lock.unlock()
            DispatchQueue.main.async { NotificationCenter.default.post(name: .vaultChanged, object: root) }
        }
    }

    /// A window no longer shows a note from this vault. Main thread.
    func release(_ root: URL) {
        lock.lock(); defer { lock.unlock() }
        guard let h = held[root.path] else { return }
        h.count -= 1
        guard h.count <= 0 else { return }
        let work = DispatchWorkItem { [weak self] in self?.drop(root) }
        h.letGo = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: work)
    }

    private func drop(_ root: URL) {
        lock.lock()
        guard let h = held[root.path], h.count <= 0 else { lock.unlock(); return }
        held[root.path] = nil
        lock.unlock()
        if let s = h.stream {
            FSEventStreamStop(s)
            FSEventStreamInvalidate(s)
            FSEventStreamRelease(s)
        }
    }

    // MARK: Watching

    /// Changed paths come in batches, a fraction of a second apart.
    fileprivate func changed(_ root: URL, _ paths: [String]) {
        let urls = paths.map { URL(fileURLWithPath: $0) }
        queue.async {
            self.lock.lock()
            let h = self.held[root.path]
            self.lock.unlock()
            guard let h else { return }
            h.index.update(urls)
            DispatchQueue.main.async { NotificationCenter.default.post(name: .vaultChanged, object: root) }
        }
    }

    private func watch(_ root: URL) -> FSEventStreamRef? {
        let box = Unmanaged.passRetained(Watch(root: root, vaults: self))
        var context = FSEventStreamContext(version: 0, info: box.toOpaque(), retain: nil,
                                           release: { info in info.map { Unmanaged<Watch>.fromOpaque($0).release() } },
                                           copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, count, paths, _, _ in
            guard let info else { return }
            let watch = Unmanaged<Watch>.fromOpaque(info).takeUnretainedValue()
            let list = (Unmanaged<CFArray>.fromOpaque(paths).takeUnretainedValue() as NSArray) as? [String] ?? []
            watch.vaults?.changed(watch.root, Array(list.prefix(count)))
        }
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer)
        guard let stream = FSEventStreamCreate(nil, callback, &context, [root.path] as CFArray,
                                               FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3, flags) else {
            box.release()
            return nil
        }
        FSEventStreamSetDispatchQueue(stream, DispatchQueue.main)
        FSEventStreamStart(stream)
        return stream
    }

    private final class Watch {
        let root: URL
        weak var vaults: Vaults?
        init(root: URL, vaults: Vaults) { self.root = root; self.vaults = vaults }
    }
}
