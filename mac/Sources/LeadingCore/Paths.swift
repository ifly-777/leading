import Foundation

/// Where a link in a document should go.
public enum LinkTarget: Equatable {
    /// A web or mail link, for the default browser or mail app
    case external(URL)
    /// Another Markdown or text file, to open in Leading
    case document(URL)
    /// Any other local file, for the app that owns it
    case otherFile(URL)
    /// A link for another app (obsidian://, zotero://, x-devonthink-item://, tel:), handed
    /// to whichever app claims its scheme, if any does
    case otherApp(URL)
    /// Nothing sensible to do
    case none
}

public enum Paths {
    public static let documentExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "mkdn", "txt", "text"]
    public static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "heif", "avif", "tif", "tiff", "bmp"]

    /// Classify a link's href, relative to the document that contains it.
    public static func linkTarget(_ href: String, document: URL?) -> LinkTarget {
        let trimmed = href.trimmingCharacters(in: .whitespaces)
        if let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() {
            if ["http", "https", "mailto"].contains(scheme) { return .external(url) }
            if scheme == "file" { return classifyFile(url) }
            // Never followed: what would run code or load content in the page, and our own scheme.
            if ["javascript", "vbscript", "data", "blob", "about", "leading"].contains(scheme) { return .none }
            return .otherApp(url)
        }
        guard let base = document?.deletingLastPathComponent() else { return .none }
        // Relative path, possibly with a #fragment we cannot honour across files.
        let pathPart = trimmed.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        guard !pathPart.isEmpty, let decoded = pathPart.removingPercentEncoding else { return .none }
        let url = decoded.hasPrefix("/") ? URL(fileURLWithPath: decoded) : base.appendingPathComponent(decoded).standardizedFileURL
        return classifyFile(url)
    }

    /// The heading a link names after `#` (`other.md#Further reading`), if any.
    public static func fragment(_ href: String) -> String? {
        guard let i = href.firstIndex(of: "#") else { return nil }
        let f = String(href[href.index(after: i)...])
        let decoded = f.removingPercentEncoding ?? f
        return decoded.isEmpty ? nil : decoded
    }

    public static func classifyFile(_ url: URL) -> LinkTarget {
        documentExtensions.contains(url.pathExtension.lowercased()) ? .document(url) : .otherFile(url)
    }

    /// The file a wikilink names, found the way Obsidian finds it: next to the
    /// note; otherwise anywhere in its vault (the nearest folder above holding
    /// `.obsidian`, or the note's own folder and those below it if there is no
    /// vault), preferring the match nearest the vault's top. Names match without
    /// regard to case or Unicode composition. Nil if there is no such file.
    /// The search stops after `limit` entries, so a huge folder cannot stall a click.
    public static func wikiTarget(_ name: String, document: URL?, home: URL = FileManager.default.homeDirectoryForCurrentUser, limit: Int = 50_000) -> URL? {
        let fm = FileManager.default
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let folder = document?.deletingLastPathComponent(), !trimmed.isEmpty, !trimmed.hasPrefix("/") else { return nil }
        // 1. Beside the note (or at the path given, relative to it).
        if let beside = besideTarget(trimmed, document: document) { return beside }
        let norm = { (s: String) in s.precomposedStringWithCanonicalMapping.lowercased() }

        // 2. Anywhere in the vault.
        let root = vaultRoot(for: folder, home: home)
        let wanted = wikiCandidates(norm(trimmed))
        guard let walk = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return nil }
        var best: (url: URL, depth: Int)?
        var seen = 0
        for case let url as URL in walk {
            seen += 1
            if seen > limit { break }
            // The file's name, or a tail of its path ("Folder/Note" matches …/Folder/Note.md).
            // Matching the end of the full path sidesteps /var versus /private/var.
            let path = norm(url.path)
            guard wanted.contains(where: { path.hasSuffix("/" + $0) }) else { continue }
            let depth = url.pathComponents.count
            if best == nil || depth < best!.depth { best = (url.standardizedFileURL, depth) }
        }
        return best?.url
    }

    /// The file names a wikilink may mean: "Note" means Note.md (or .markdown);
    /// "v1.2 plan" is a note too, but "report.pdf" names its file.
    public static func wikiCandidates(_ name: String) -> [String] {
        let ext = (name as NSString).pathExtension
        let hasExtension = !ext.isEmpty && ext.count <= 8 && ext.allSatisfy { $0.isLetter || $0.isNumber }
        return hasExtension ? [name] : ["md", "markdown"].map { "\(name).\($0)" }
    }

    /// The first step of finding a wikilink's file: beside the note, or at the path
    /// given relative to it. Spelled as on disk. Nil if there is no such file there.
    public static func besideTarget(_ name: String, document: URL?) -> URL? {
        let fm = FileManager.default
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let folder = document?.deletingLastPathComponent(), !trimmed.isEmpty, !trimmed.hasPrefix("/") else { return nil }
        let norm = { (s: String) in s.precomposedStringWithCanonicalMapping.lowercased() }
        for c in wikiCandidates(trimmed) {
            let url = folder.appendingPathComponent(c).standardizedFileURL
            guard fm.fileExists(atPath: url.path) else { continue }
            // The disk ignores case, but the name must be spelled as on disk,
            // or an open "Linked.md" would open again as "linked.md".
            let dir = url.deletingLastPathComponent()
            let name = (try? fm.contentsOfDirectory(atPath: dir.path))?.first { norm($0) == norm(url.lastPathComponent) }
            return name.map { dir.appendingPathComponent($0) } ?? url
        }
        return nil
    }

    /// The vault a folder belongs to: the nearest folder above holding `.obsidian`
    /// (stopping at the home folder), or the folder itself if there is none.
    public static func vaultRoot(for folder: URL, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        var probe = folder.standardizedFileURL
        while probe.path.count > 1, probe.path != home.standardizedFileURL.path {
            if FileManager.default.fileExists(atPath: probe.appendingPathComponent(".obsidian").path) { return probe }
            probe = probe.deletingLastPathComponent()
        }
        return folder
    }

    /// The file for an image request, relative to the document's folder.
    /// Only image files are ever served, so a document cannot pull in anything else.
    public static func imageFile(requestPath: String, documentFolder: URL) -> URL? {
        guard let decoded = requestPath.removingPercentEncoding, !decoded.isEmpty else { return nil }
        let url = decoded.hasPrefix("/") && decoded.count > 1 && FileManager.default.fileExists(atPath: decoded)
            ? URL(fileURLWithPath: decoded)
            : documentFolder.appendingPathComponent(decoded).standardizedFileURL
        return imageExtensions.contains(url.pathExtension.lowercased()) ? url : nil
    }
}
