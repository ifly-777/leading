import Foundation

/// A note that links to another: its file, and the lines where it does.
public struct Backlink: Equatable {
    public let url: URL
    /// The note's name, as a wikilink would give it
    public var name: String { url.deletingPathExtension().lastPathComponent }
    /// Each line holding a link, trimmed for a glance (at most a few)
    public let lines: [String]
    /// Where each of those lines starts in the note's text, in UTF-16 units, as the page counts
    public var offsets: [Int] = []

    public init(url: URL, lines: [String], offsets: [Int] = []) {
        self.url = url
        self.lines = lines
        self.offsets = offsets
    }
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

    /// What a line holds, found in one pass over its bytes, so `clean` runs only
    /// the patterns a line needs: most need none. Indexing a vault does this for
    /// every line of every note.
    struct Marks {
        var blank = true, lead = false, wiki = false, md = false, comment = false, tag = false, emphasis = false, edges = false
        var links: Bool { wiki || md }

        init(_ s: String) {
            var prev: UInt8 = 0
            var first = true
            for b in s.utf8 {
                switch b {
                case 32, 9: break
                default:
                    if first { lead = b == 62 || b == 45 || b == 42 || b == 43 || b == 35 || (b >= 48 && b <= 57); first = false }
                    blank = false
                }
                switch (prev, b) {
                case (91, 91): wiki = true                                        // [[
                case (93, 40): md = true                                          // ](
                case (37, 37): comment = true                                     // %%
                case (42, 42), (95, 95), (61, 61), (126, 126): emphasis = true   // ** __ == ~~
                default: break
                }
                if b == 60 { tag = true }                                         // <
                // Anything beyond ASCII may be a space that trimming should take, as may an edge space or tab.
                if b >= 128 { edges = true }
                prev = b
            }
            if let f = s.utf8.first, f == 32 || f == 9 { edges = true }
            if let l = s.utf8.last, l == 32 || l == 9 { edges = true }
        }
    }

    /// A line as a reader would glance at it: list and heading marks gone, links
    /// shown by their text, HTML tags dropped. Comments are left out, or with
    /// `keepComments` kept as words (search finds a note on a highlight). Cut to
    /// `limit` characters for the margin; nil keeps it whole.
    static func clean(_ line: String, keepComments: Bool = false, limit: Int? = 220, marks: Marks? = nil) -> String {
        let m = marks ?? Marks(line)
        if m.blank { return "" }
        var s = m.edges ? line.trimmingCharacters(in: .whitespaces) : line
        // Each pattern runs only where the line holds what it looks for.
        if m.lead { s = sub(Self.marks, s, "") }
        if m.wiki {
            // [[Note|alias]] reads as its alias; [[Note#Heading]] as the note and heading.
            s = sub(alias, s, "$2")
            s = sub(section, s, "$1 › $2")
            s = sub(wiki, s, "$1")
        }
        if m.md { s = sub(mdLink, s, "$1") }
        if m.comment { s = sub(comment, s, keepComments ? " $1 " : "") }
        if m.tag { s = sub(tag, s, "") }
        if m.emphasis { s = sub(emphasis, s, "") }
        if m.lead || m.links || m.comment || m.tag || m.edges { s = s.trimmingCharacters(in: .whitespaces) }
        guard let limit, s.count > limit else { return s }
        return String(s.prefix(limit - 1)) + "…"
    }
}
