import Foundation

/// Where the reader stopped in a file: the source offset (UTF-16) of the block
/// at the top of the window, and how many pixels into that block.
public struct Place: Codable, Equatable {
    public var s: Int
    public var dy: Double
    /// When it was recorded, so the oldest entries can be dropped.
    public var at: Date

    public init(s: Int, dy: Double, at: Date = Date()) {
        self.s = s
        self.dy = dy
        self.at = at
    }
}

/// The reader's place in every file they have read, kept in one small JSON
/// file in Application Support. The documents themselves are never touched:
/// an extended attribute would be lost to atomic saves and seen as a change
/// by sync tools.
public final class PlaceStore {
    public let file: URL
    /// The most files remembered; the least recently read go first.
    public let limit: Int
    private var places: [String: Place]?
    private var dirty = false

    public init(file: URL, limit: Int = 1000) {
        self.file = file
        self.limit = limit
    }

    /// Paths are compared after resolving `..` and symlinks, so two routes to one file agree.
    private static func key(_ url: URL) -> String { url.standardizedFileURL.resolvingSymlinksInPath().path }

    /// Read lazily: most launches open one or two files.
    private func loaded() -> [String: Place] {
        if let places { return places }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let read = (try? Data(contentsOf: file)).flatMap { try? decoder.decode([String: Place].self, from: $0) } ?? [:]
        places = read
        return read
    }

    public func place(for url: URL) -> Place? { loaded()[Self.key(url)] }

    public func set(_ place: Place, for url: URL) {
        var all = loaded()
        let k = Self.key(url)
        if all[k].map({ $0.s == place.s && $0.dy == place.dy }) == true { return }
        all[k] = place
        if all.count > limit {
            // Drop the oldest in one pass rather than one at a time.
            let keep = all.sorted { $0.value.at > $1.value.at }.prefix(limit)
            all = Dictionary(uniqueKeysWithValues: keep.map { ($0.key, $0.value) })
        }
        places = all
        dirty = true
    }

    /// The file was renamed or moved: its place goes with it.
    public func move(from old: URL, to new: URL) {
        var all = loaded()
        guard let p = all.removeValue(forKey: Self.key(old)) else { return }
        all[Self.key(new)] = p
        places = all
        dirty = true
    }

    public var hasUnsavedChanges: Bool { dirty }

    /// Write if anything changed. Failure only loses places, never text, so it is logged and forgotten.
    public func save() {
        guard dirty, let places else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try encoder.encode(places).write(to: file, options: .atomic)
            dirty = false
        } catch {
            NSLog("Leading: could not save reading places: \(error)")
        }
    }
}
