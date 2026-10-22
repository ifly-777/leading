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
    /// heading, block or alias after it, embeds included) that resolves to it as
    /// a click would, or with a Markdown link whose path leads to it. The vault is
    /// found as a wikilink finds it (Paths.vaultRoot). Nearest the vault's top
    /// first, then by name. This reads the vault once, for a single question;
    /// the app keeps a live VaultIndex instead.
    public static func find(to document: URL, home: URL = FileManager.default.homeDirectoryForCurrentUser, limit: Int = 50_000, maxBytes: Int = 4_000_000) -> [Backlink] {
        let me = document.standardizedFileURL.resolvingSymlinksInPath()
        let index = VaultIndex(root: Paths.vaultRoot(for: me.deletingLastPathComponent(), home: home), limit: limit, maxBytes: maxBytes)
        index.build()
        return index.backlinks(to: me)
    }

    private static func rx(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression { try! NSRegularExpression(pattern: p, options: o) }
    private static let marks = rx(#"^(?:>\s*)*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+)?"#)
    private static let alias = rx(#"!?\[\[([^\[\]|]+)\|([^\[\]]+)\]\]"#)
    private static let section = rx(#"!?\[\[([^\[\]#]+)#\^?([^\[\]]+)\]\]"#)
    private static let wiki = rx(#"!?\[\[([^\[\]]+)\]\]"#)
    private static let mdLink = rx(#"\[([^\]]*)\]\([^)]*\)"#)
    private static let comment = rx(#"%%(.*?)%%"#)
    private static let emphasis = rx(#"\*\*|__|==|~~"#)
    private static let tag = rx(#"</?[A-Za-z][^<>]*>"#)

    private static func sub(_ r: NSRegularExpression, _ s: String, _ t: String) -> String {
        r.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length), withTemplate: t)
    }

    /// A line as a reader would glance at it: list and heading marks gone, links
    /// shown by their text, HTML tags dropped. Comments are left out, or with
    /// `keepComments` kept as words (search finds a note on a highlight). Cut to
    /// `limit` characters for the margin; nil keeps it whole.
    static func clean(_ line: String, keepComments: Bool = false, limit: Int? = 220) -> String {
        var s = line.trimmingCharacters(in: .whitespaces)
        // Each pattern runs only where its first character is present: most lines need none.
        if let f = s.first, ">-*+#0123456789".contains(f) { s = sub(marks, s, "") }
        if s.contains("[[") {
            // [[Note|alias]] reads as its alias; [[Note#Heading]] as the note and heading.
            s = sub(alias, s, "$2")
            s = sub(section, s, "$1 › $2")
            s = sub(wiki, s, "$1")
        }
        if s.contains("](") { s = sub(mdLink, s, "$1") }
        if s.contains("%%") { s = sub(comment, s, keepComments ? " $1 " : "") }
        if s.contains("<") { s = sub(tag, s, "") }
        if s.contains("**") || s.contains("__") || s.contains("==") || s.contains("~~") { s = sub(emphasis, s, "") }
        s = s.trimmingCharacters(in: .whitespaces)
        guard let limit, s.count > limit else { return s }
        return String(s.prefix(limit - 1)) + "…"
    }
}
