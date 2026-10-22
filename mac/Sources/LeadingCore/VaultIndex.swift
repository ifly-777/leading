import Foundation

/// A note found by vault search, with the lines where the words are.
public struct SearchHit: Equatable, Sendable {
    public let url: URL
    public var name: String { url.deletingPathExtension().lastPathComponent }
    /// Matching lines as a reader would glance at them, at most a few
    public let lines: [SearchLine]
    /// How many times the words occur in this note (its name not counted)
    public let count: Int
    /// The words are in the note's name
    public let inName: Bool
}

public struct SearchLine: Equatable, Sendable {
    public let text: String
    /// Where the line starts in the note's text, in UTF-16 units, as the page counts
    public let offset: Int
}

public struct SearchResult: Equatable, Sendable {
    /// The best notes first, at most the limit asked for
    public let hits: [SearchHit]
    /// Every note that matched, and every occurrence, beyond the limit too
    public let notes: Int
    public let total: Int
}

/// What one vault holds, kept in memory so search, links to a note, and wikilinks
/// need not walk and read the vault each time. Nothing is written to disk.
///
/// Every file's path is indexed, so a wikilink to a picture or a PDF resolves.
/// Markdown notes are also read: their lines, cleaned as a reader would see
/// them and folded as Find folds them, and the links on each line. An
/// encrypted note is indexed by name only; its text is never read.
///
/// Thread-safe: build and update off the main thread, ask from anywhere.
public final class VaultIndex: @unchecked Sendable {
    /// The vault's folder, with symbolic links resolved
    public let root: URL
    private let rootPath: String
    private let limit: Int
    private let maxBytes: Int

    private struct Link {
        /// A wikilink's target as written, folded for comparison ("books/walden"), or nil for a Markdown link
        let wiki: String?
        /// A Markdown link's file, resolved when the note was read
        let file: String?
        let line: Int
    }

    private struct Entry {
        let url: URL
        /// The path below the root, folded ("books/walden.md")
        let rel: String
        let depth: Int
        let modified: Date?
        let size: Int
        /// The note's name, folded, for search
        let name: [UInt8]
        /// A Markdown file: found by search, by name at least
        var markdown = false
        /// Its text was read (not too big, not encrypted)
        var note = false
        /// Cleaned lines, the UTF-16 offset of each in the note's text, and the folded text of all of them joined by "\n"
        var lines: [String] = []
        var offsets: [Int] = []
        var folded: [UInt8] = []
        /// Where each line starts in `folded`
        var starts: [Int] = []
        var raw: [Int: String] = [:]
        var links: [Link] = []
    }

    /// The chunks a parallel build reads, each filled by one worker.
    private final class Parts: @unchecked Sendable {
        private var items: [[Entry]]
        private let lock = NSLock()
        init(count: Int) { items = Array(repeating: [], count: count) }
        var count: Int { items.count }
        var all: [[Entry]] { lock.lock(); defer { lock.unlock() }; return items }
        func set(_ i: Int, _ e: [Entry]) { lock.lock(); items[i] = e; lock.unlock() }
    }

    private let lock = NSLock()
    /// Keyed by `rel`
    private var entries: [String: Entry] = [:]
    /// Folded file name ("walden.md") to the `rel`s carrying it
    private var byName: [String: Set<String>] = [:]

    public init(root: URL, limit: Int = 50_000, maxBytes: Int = 4_000_000) {
        let resolved = root.standardizedFileURL.resolvingSymlinksInPath()
        self.root = resolved
        rootPath = resolved.path
        self.limit = limit
        self.maxBytes = maxBytes
    }

    /// How many files are indexed.
    public var count: Int { lock.lock(); defer { lock.unlock() }; return entries.count }

    /// Roughly how much text the index holds, in bytes: each line as shown, and folded.
    public var textBytes: Int {
        lock.lock(); defer { lock.unlock() }
        return entries.values.reduce(0) { sum, e in sum + e.folded.count + e.lines.reduce(0) { $0 + $1.utf8.count } }
    }

    // MARK: Building

    /// Read the whole vault. Safe to call again; the index is replaced in one step.
    public func build() {
        let files = walk(root)
        // Read in parallel, in chunks: reading and folding is nearly all of the time.
        let chunk = 64
        let parts = Parts(count: (files.count + chunk - 1) / chunk)
        DispatchQueue.concurrentPerform(iterations: parts.count) { i in
            let found = files[(i * chunk)..<min(files.count, (i + 1) * chunk)].compactMap { self.read($0) }
            parts.set(i, found)
        }
        var fresh: [String: Entry] = [:]
        for part in parts.all { for e in part { fresh[e.rel] = e } }
        lock.lock()
        entries = fresh
        byName = [:]
        for rel in fresh.keys { byName[Self.base(rel), default: []].insert(rel) }
        lock.unlock()
    }

    /// Files or folders that changed, were added or went away. A folder is read again whole.
    public func update(_ urls: [URL]) {
        for url in urls {
            let u = Self.canonical(url)
            guard let rel = relative(u) else { continue }
            var isDir: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: u.path, isDirectory: &isDir)
            if exists && isDir.boolValue {
                let found = walk(u).compactMap { read($0) }
                lock.lock()
                let keep = Set(found.map(\.rel))
                for r in entries.keys where (rel.isEmpty || r.hasPrefix(rel + "/")) && !keep.contains(r) { removeLocked(r) }
                for e in found { insertLocked(e) }
                lock.unlock()
            } else if exists, indexable(u) {
                // Unchanged since it was read: an event about a file only looked at.
                let values = try? u.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                lock.lock()
                let old = entries[rel]
                lock.unlock()
                if let old, old.modified == values?.contentModificationDate, old.size == (values?.fileSize ?? 0) { continue }
                guard let e = read(u) else { continue }
                lock.lock()
                insertLocked(e)
                lock.unlock()
            } else {
                lock.lock()
                for r in entries.keys where r == rel || r.hasPrefix(rel + "/") { removeLocked(r) }
                lock.unlock()
            }
        }
    }

    private func insertLocked(_ e: Entry) {
        entries[e.rel] = e
        byName[Self.base(e.rel), default: []].insert(e.rel)
    }

    private func removeLocked(_ rel: String) {
        entries[rel] = nil
        byName[Self.base(rel)]?.remove(rel)
    }

    private static func base(_ rel: String) -> String {
        rel.split(separator: "/").last.map(String.init) ?? rel
    }

    /// A path with its symbolic links resolved, even when it no longer exists
    /// (resolving needs the file, so a gone file's folder is resolved instead).
    private static func canonical(_ url: URL) -> URL {
        let u = url.standardizedFileURL
        if FileManager.default.fileExists(atPath: u.path) || u.path == "/" { return u.resolvingSymlinksInPath() }
        return canonical(u.deletingLastPathComponent()).appendingPathComponent(u.lastPathComponent)
    }

    private static func norm(_ s: String) -> String { s.precomposedStringWithCanonicalMapping.lowercased() }

    private func relative(_ url: URL) -> String? {
        let p = url.path
        if p == rootPath { return "" }
        guard p.hasPrefix(rootPath + "/") else { return nil }
        return Self.norm(String(p.dropFirst(rootPath.count + 1)))
    }

    /// The files under a folder, as a wikilink search walks them: hidden files and package contents left out.
    private func walk(_ folder: URL) -> [URL] {
        guard let e = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey],
                                                     options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        var out: [URL] = []
        var seen = 0
        for case let url as URL in e {
            seen += 1
            if seen > limit { break }
            out.append(url)
        }
        return out
    }

    /// A file reported by the watcher is indexed only if the walk would have found it.
    private func indexable(_ url: URL) -> Bool {
        guard let rel = relative(url), !rel.isEmpty else { return false }
        var probe = root
        for part in url.path.dropFirst(rootPath.count + 1).split(separator: "/") {
            if part.hasPrefix(".") { return false }
            if probe != root, (try? probe.resourceValues(forKeys: [.isPackageKey]))?.isPackage == true { return false }
            probe.appendPathComponent(String(part))
        }
        return true
    }

    private static let wikilink = try! NSRegularExpression(pattern: #"!?\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]"#)
    private static let mdLink = try! NSRegularExpression(pattern: #"\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)"#)

    private func read(_ url: URL) -> Entry? {
        let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey])
        guard values?.isRegularFile == true, let rel = relative(url.standardizedFileURL), !rel.isEmpty else { return nil }
        let size = values?.fileSize ?? 0
        var cache: [UInt32: [UInt8]] = [:]
        var e = Entry(url: url.standardizedFileURL, rel: rel, depth: rel.split(separator: "/").count, modified: values?.contentModificationDate, size: size,
                      name: Fold.bytes(url.deletingPathExtension().lastPathComponent, cache: &cache))
        e.markdown = ["md", "markdown"].contains(url.pathExtension.lowercased())
        guard e.markdown, size <= maxBytes,
              let data = try? Data(contentsOf: url, options: .mappedIfSafe), !SealedText.isSealed(data) else { return e }
        e.note = true
        let text = TextFile.decode(data).text
        let folder = url.deletingLastPathComponent()
        var offset = 0
        // Lines are cut at "\n" bytes: splitting by Characters would find grapheme
        // clusters across the whole file, several times slower.
        for bytes in text.utf8.split(separator: 10, omittingEmptySubsequences: false) {
            let s = String(Substring(bytes))
            defer { offset += s.utf16.count + 1 }
            let marks = Backlinks.Marks(s)
            if marks.blank { continue }
            let shown = Backlinks.clean(s, keepComments: true, limit: nil, marks: marks)
            if shown.isEmpty { continue }
            let n = e.lines.count
            if marks.links {
                let ns = s as NSString
                let full = NSRange(location: 0, length: ns.length)
                var found = false
                for m in Self.wikilink.matches(in: s, range: full) {
                    var name = Self.norm(ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces))
                    if name.hasSuffix(".md") { name = String(name.dropLast(3)) }
                    if !name.isEmpty { e.links.append(Link(wiki: name, file: nil, line: n)); found = true }
                }
                for m in Self.mdLink.matches(in: s, range: full) {
                    if case .document(let target) = Paths.linkTarget(ns.substring(with: m.range(at: 1)), document: folder.appendingPathComponent("_.md")) {
                        e.links.append(Link(wiki: nil, file: target.standardizedFileURL.path, line: n)); found = true
                    }
                }
                if found { e.raw[n] = s }
            }
            e.starts.append(e.folded.count)
            e.folded.append(contentsOf: Fold.bytes(shown, cache: &cache))
            e.folded.append(10)
            e.lines.append(shown)
            e.offsets.append(offset)
        }
        return e
    }

    // MARK: Asking

    /// The file a wikilink names, as a click finds it: beside the linking note (or at
    /// the path given, relative to it), otherwise anywhere in the vault, nearest the top,
    /// ties going to the path that sorts first. Nil if the vault has no such file.
    public func resolve(_ name: String, from document: URL) -> URL? {
        if let beside = Paths.besideTarget(name, document: document) { return beside }
        let trimmed = Self.norm(name.trimmingCharacters(in: .whitespaces))
        guard !trimmed.isEmpty, !trimmed.hasPrefix("/") else { return nil }
        lock.lock(); defer { lock.unlock() }
        return resolveLocked(trimmed)?.url
    }

    /// The vault-wide step of `resolve`, for a folded name ("folder/note" or "note").
    private func resolveLocked(_ name: String) -> Entry? {
        let candidates = Paths.wikiCandidates(name)
        var best: Entry?
        for c in candidates {
            for rel in byName[Self.base(c)] ?? [] where rel == c || rel.hasSuffix("/" + c) {
                guard let e = entries[rel] else { continue }
                if best == nil || e.depth < best!.depth || (e.depth == best!.depth && e.rel < best!.rel) { best = e }
            }
        }
        return best
    }

    /// The notes that link to `document`: a wikilink that resolves to it (so a
    /// `[[Name]]` shared by two notes counts only for the one it opens), or a
    /// Markdown link whose path leads to it. Nearest the vault's top first, then by name.
    public func backlinks(to document: URL) -> [Backlink] {
        let me = Self.canonical(document)
        let myBase = Self.norm(me.deletingPathExtension().lastPathComponent)
        lock.lock()
        // Links whose last part names this note, to be checked with the lock released (resolving may look at the disk).
        var maybe: [(Entry, [Link])] = []
        // Indexed paths are already resolved, being found under the resolved root.
        for e in entries.values where e.note && e.url.path != me.path {
            let ls = e.links.filter { l in
                if let f = l.file { return f == me.path }
                guard let w = l.wiki else { return false }
                let last = w.split(separator: "/").last.map(String.init) ?? w
                return last == myBase || last == myBase + ".markdown"
            }
            if !ls.isEmpty { maybe.append((e, ls)) }
        }
        lock.unlock()
        var found: [(Backlink, Int)] = []
        for (e, ls) in maybe {
            var lines: [Int] = []
            for l in ls where !lines.contains(l.line) {
                let hit = l.file != nil || resolve(l.wiki!, from: e.url)?.resolvingSymlinksInPath().path == me.path
                if hit { lines.append(l.line) }
            }
            if lines.isEmpty { continue }
            let kept = lines.prefix(3).filter { e.raw[$0] != nil }
            found.append((Backlink(url: e.url, lines: kept.map { Backlinks.clean(e.raw[$0]!) }, offsets: kept.map { e.offsets[$0] }), e.depth))
        }
        return found.sorted { $0.1 != $1.1 ? $0.1 < $1.1 : $0.0.name.localizedStandardCompare($1.0.name) == .orderedAscending }.map(\.0)
    }

    /// Notes holding `query`, folded as Find folds it. A note whose name holds the
    /// words comes first; then the most occurrences; then nearest the top; then by path.
    public func search(_ query: String, limit: Int = 100, linesPerNote: Int = 3) -> SearchResult {
        let q = Fold.bytes(query.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !q.isEmpty else { return SearchResult(hits: [], notes: 0, total: 0) }
        lock.lock()
        let notes = entries.values.filter(\.markdown)
        lock.unlock()
        var scored: [(hit: SearchHit, depth: Int, rel: String)] = []
        var total = 0
        for e in notes {
            let at = Fold.find(q, in: e.folded)
            let inName = !Fold.find(q, in: e.name).isEmpty
            if at.isEmpty && !inName { continue }
            total += at.count
            var lines: [SearchLine] = []
            var last = -1
            for i in at {
                // The line holding byte i: the last start at or before it.
                var lo = 0, hi = e.starts.count - 1
                while lo < hi { let mid = (lo + hi + 1) / 2; if e.starts[mid] <= i { lo = mid } else { hi = mid - 1 } }
                if lo == last { continue }
                last = lo
                lines.append(SearchLine(text: e.lines[lo], offset: e.offsets[lo]))
                if lines.count == linesPerNote { break }
            }
            scored.append((SearchHit(url: e.url, lines: lines, count: at.count, inName: inName), e.depth, e.rel))
        }
        scored.sort { a, b in
            if a.hit.inName != b.hit.inName { return a.hit.inName }
            if a.hit.count != b.hit.count { return a.hit.count > b.hit.count }
            if a.depth != b.depth { return a.depth < b.depth }
            // The folded path: cheap to compare, and by name within a folder.
            return a.rel < b.rel
        }
        return SearchResult(hits: scored.prefix(limit).map(\.hit), notes: scored.count, total: total)
    }
}
