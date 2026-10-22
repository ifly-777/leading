import Foundation

/// A note that links to another: its file, and the lines where it does.
public struct Backlink: Equatable {
    public let url: URL
    /// The note's name, as a wikilink would give it
    public var name: String { url.deletingPathExtension().lastPathComponent }
    /// Each line holding a link, trimmed for a glance (at most a few)
    public let lines: [String]
}

public enum Backlinks {
    /// The notes in a document's vault that link to it, with `[[Name]]` (any
    /// heading, block or alias after it, embeds included) or with a Markdown
    /// link whose path leads to it. The vault is found as a wikilink finds it
    /// (Paths.vaultRoot). Nearest the vault's top first, then by name. Files
    /// over `maxBytes` are skipped, and the walk stops after `limit` entries,
    /// so a huge folder cannot stall the margin.
    public static func find(to document: URL, home: URL = FileManager.default.homeDirectoryForCurrentUser, limit: Int = 50_000, maxBytes: Int = 4_000_000) -> [Backlink] {
        let fm = FileManager.default
        let me = document.standardizedFileURL.resolvingSymlinksInPath()
        let root = Paths.vaultRoot(for: me.deletingLastPathComponent(), home: home)
        let norm = { (s: String) in s.precomposedStringWithCanonicalMapping.lowercased() }
        let myName = norm(me.deletingPathExtension().lastPathComponent)
        // What a wikilink to this note may be written as: its name, or a tail of its path.
        let rel = me.path.hasPrefix(root.resolvingSymlinksInPath().path + "/") ? String(me.path.dropFirst(root.resolvingSymlinksInPath().path.count + 1)) : me.lastPathComponent
        let relNoExt = norm((rel as NSString).deletingPathExtension)
        guard let walk = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey], options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        var found: [(Backlink, Int)] = []
        var seen = 0
        for case let url as URL in walk {
            seen += 1
            if seen > limit { break }
            guard ["md", "markdown"].contains(url.pathExtension.lowercased()) else { continue }
            let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard values?.isRegularFile == true, (values?.fileSize ?? 0) <= maxBytes else { continue }
            let file = url.standardizedFileURL.resolvingSymlinksInPath()
            if file == me { continue }
            guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { continue }
            let text = TextFile.decode(data).text
            // Cheap test first: most notes never mention the name at all.
            guard norm(text).contains(myName) else { continue }
            let lines = linkingLines(text, from: file.deletingLastPathComponent(), to: me, names: [myName, relNoExt], norm: norm)
            if !lines.isEmpty { found.append((Backlink(url: file, lines: lines), file.pathComponents.count)) }
        }
        return found.sorted { $0.1 != $1.1 ? $0.1 < $1.1 : $0.0.name.localizedStandardCompare($1.0.name) == .orderedAscending }.map(\.0)
    }

    private static let wikilink = try! NSRegularExpression(pattern: #"!?\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]"#)
    private static let mdLink = try! NSRegularExpression(pattern: #"\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)"#)

    /// The lines of `text` that link to `target`, cleaned up for display; at most three.
    static func linkingLines(_ text: String, from folder: URL, to target: URL, names: [String], norm: (String) -> String) -> [String] {
        var out: [String] = []
        for line in text.split(omittingEmptySubsequences: true, whereSeparator: \.isNewline) {
            let s = String(line)
            guard s.contains("[[") || s.contains("](") else { continue }
            let ns = s as NSString
            let full = NSRange(location: 0, length: ns.length)
            var hit = false
            for m in wikilink.matches(in: s, range: full) {
                var name = norm(ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces))
                if name.hasSuffix(".md") { name = String(name.dropLast(3)) }
                // "Note", or "Folder/Note": the name, or the end of the note's path in the vault.
                if names.contains(name) || names.contains(where: { $0.hasSuffix("/" + name) }) { hit = true; break }
            }
            if !hit {
                for m in mdLink.matches(in: s, range: full) {
                    let href = ns.substring(with: m.range(at: 1))
                    if case .document(let url) = Paths.linkTarget(href, document: folder.appendingPathComponent("_.md")),
                       url.standardizedFileURL.resolvingSymlinksInPath() == target { hit = true; break }
                }
            }
            if hit {
                out.append(clean(s))
                if out.count == 3 { break }
            }
        }
        return out
    }

    /// A line as a reader would glance at it: list and heading marks gone, links shown by their text.
    static func clean(_ line: String) -> String {
        var s = line.trimmingCharacters(in: .whitespaces)
        s = s.replacingOccurrences(of: #"^(?:>\s*)*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+)?"#, with: "", options: .regularExpression)
        // [[Note|alias]] reads as its alias; [[Note#Heading]] as the note and heading.
        s = s.replacingOccurrences(of: #"!?\[\[([^\[\]|]+)\|([^\[\]]+)\]\]"#, with: "$2", options: .regularExpression)
        s = s.replacingOccurrences(of: #"!?\[\[([^\[\]#]+)#\^?([^\[\]]+)\]\]"#, with: "$1 › $2", options: .regularExpression)
        s = s.replacingOccurrences(of: #"!?\[\[([^\[\]]+)\]\]"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"%%.*?%%"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\*\*|__|==|~~"#, with: "", options: .regularExpression)
        s = s.trimmingCharacters(in: .whitespaces)
        return s.count > 220 ? String(s.prefix(219)) + "…" : s
    }
}
