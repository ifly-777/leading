import Foundation

/// Where a link in a document should go.
public enum LinkTarget: Equatable {
    /// A web or mail link, for the default browser or mail app
    case external(URL)
    /// Another Markdown or text file, to open in Leading
    case document(URL)
    /// Any other local file, for the app that owns it
    case otherFile(URL)
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
            return .none // javascript:, data: and the rest: never followed
        }
        guard let base = document?.deletingLastPathComponent() else { return .none }
        // Relative path, possibly with a #fragment we cannot honour across files.
        let pathPart = trimmed.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        guard !pathPart.isEmpty, let decoded = pathPart.removingPercentEncoding else { return .none }
        let url = decoded.hasPrefix("/") ? URL(fileURLWithPath: decoded) : base.appendingPathComponent(decoded).standardizedFileURL
        return classifyFile(url)
    }

    private static func classifyFile(_ url: URL) -> LinkTarget {
        documentExtensions.contains(url.pathExtension.lowercased()) ? .document(url) : .otherFile(url)
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
