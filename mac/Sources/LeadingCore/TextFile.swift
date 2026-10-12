import Foundation

/// A text file as Leading holds it: the text with "\n" line endings (which the
/// page works in), plus what is needed to write it back exactly as found.
public struct TextFile: Equatable {
    public enum LineEnding: String, Equatable { case lf = "\n", crlf = "\r\n", cr = "\r" }

    public var text: String
    public var encoding: String.Encoding
    public var lineEnding: LineEnding
    public var hasBOM: Bool

    public init(text: String, encoding: String.Encoding = .utf8, lineEnding: LineEnding = .lf, hasBOM: Bool = false) {
        self.text = text
        self.encoding = encoding
        self.lineEnding = lineEnding
        self.hasBOM = hasBOM
    }

    /// Decode bytes from disk. UTF-8 is by far the most common; a byte-order
    /// mark settles UTF-16; anything else that is not valid UTF-8 is read as
    /// Windows Latin-1, which accepts every byte, so a file always opens.
    public static func decode(_ data: Data) -> TextFile {
        var encoding: String.Encoding = .utf8
        var body = data
        var bom = false
        if data.starts(with: [0xEF, 0xBB, 0xBF]) {
            body = data.dropFirst(3); bom = true
        } else if data.starts(with: [0xFF, 0xFE]) {
            encoding = .utf16LittleEndian; body = data.dropFirst(2); bom = true
        } else if data.starts(with: [0xFE, 0xFF]) {
            encoding = .utf16BigEndian; body = data.dropFirst(2); bom = true
        }
        var raw = String(data: body, encoding: encoding)
        if raw == nil {
            encoding = .windowsCP1252
            raw = String(data: body, encoding: encoding) ?? String(decoding: body, as: UTF8.self)
        }
        let text = raw!
        // The first line ending found is the file's style; mixed files are rare.
        // Search the bytes, not the String: String search is character-aware and
        // takes a quarter of a second on a 5 MB file; a byte scan takes a millisecond.
        let ending: LineEnding
        if encoding == .utf8 || encoding == .windowsCP1252 {
            if let cr = body.firstIndex(of: 0x0D) {
                ending = body.index(after: cr) < body.endIndex && body[body.index(after: cr)] == 0x0A ? .crlf : .cr
            } else {
                ending = .lf
            }
        } else {
            ending = text.contains("\r\n") ? .crlf : (text.contains("\r") ? .cr : .lf)
        }
        let normalised = ending == .lf ? text : text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        return TextFile(text: normalised, encoding: encoding, lineEnding: ending, hasBOM: bom)
    }

    /// Bytes to write back: the original encoding, line endings and byte-order mark.
    public func encoded() -> Data? {
        let restored = lineEnding == .lf ? text : text.replacingOccurrences(of: "\n", with: lineEnding.rawValue)
        guard var data = restored.data(using: encoding) else { return nil }
        if hasBOM {
            switch encoding {
            case .utf8: data.insert(contentsOf: [0xEF, 0xBB, 0xBF], at: 0)
            case .utf16LittleEndian: data.insert(contentsOf: [0xFF, 0xFE], at: 0)
            case .utf16BigEndian: data.insert(contentsOf: [0xFE, 0xFF], at: 0)
            default: break
            }
        }
        return data
    }
}
