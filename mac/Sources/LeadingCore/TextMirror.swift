import Foundation

/// Swift's copy of the text being edited. The editor in the page sends each
/// change as (from, to, insert) in UTF-16 offsets of the text before that
/// change set; the mirror applies them so that saving never has to wait for
/// the page. A fingerprint, computed identically in the page (web/src/core/
/// hash.ts), lets the app confirm the two copies agree.
public final class TextMirror {
    public private(set) var storage: NSMutableString

    public init(_ text: String) { storage = NSMutableString(string: text) }

    public var text: String { storage as String }
    public var utf16Count: Int { storage.length }

    public struct Change: Equatable {
        public let from: Int, to: Int, insert: String
        public init(from: Int, to: Int, insert: String) { self.from = from; self.to = to; self.insert = insert }
    }

    /// Apply one change set. Offsets refer to the text before any of them,
    /// so they are applied from the end backwards. Returns false (and changes
    /// nothing) if any change falls outside the text: the caller then resyncs.
    @discardableResult
    public func apply(_ changes: [Change]) -> Bool {
        let n = storage.length
        guard changes.allSatisfy({ 0 <= $0.from && $0.from <= $0.to && $0.to <= n }) else { return false }
        for c in changes.sorted(by: { $0.from > $1.from }) {
            storage.replaceCharacters(in: NSRange(location: c.from, length: c.to - c.from), with: c.insert)
        }
        return true
    }

    public func replaceAll(_ text: String) { storage = NSMutableString(string: text) }

    /// FNV-1a over UTF-16 code units; must match fingerprint() in hash.ts.
    public var fingerprint: UInt32 {
        var h: UInt32 = 0x811c9dc5
        let len = storage.length
        let buffer = UnsafeMutablePointer<unichar>.allocate(capacity: max(1, len))
        defer { buffer.deallocate() }
        storage.getCharacters(buffer, range: NSRange(location: 0, length: len))
        for i in 0..<len {
            h ^= UInt32(buffer[i])
            h = h &* 0x01000193
        }
        return h
    }
}
