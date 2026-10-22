import Foundation

/// "Folding" text for search, as the page's Find folds it (web/src/core/fold.ts):
/// accents are dropped (café = cafe), case is ignored, and typography is undone,
/// so a typed it's, "word", -- or ... finds it’s, “word”, – or …, and the reverse.
/// Vault search folds with these same rules, so it finds what Find finds.
///
/// The result is UTF-8 bytes, which search scans directly. A line break stays
/// one line break, so a hit's line is counted from the folded text alone.
public enum Fold {
    private static let expand: [UInt32: String] = [
        0x2018: "'", 0x2019: "'", 0x201A: "'", 0x201B: "'", 0x02BC: "'", 0x2032: "'",
        0x201C: "\"", 0x201D: "\"", 0x201E: "\"", 0x201F: "\"", 0x2033: "\"", 0x00AB: "\"", 0x00BB: "\"",
        0x2013: "--", 0x2014: "---", 0x2212: "-", 0x2010: "-", 0x2011: "-",
        0x2026: "...",
        0x00A0: " ", 0x202F: " ", 0x2009: " ", 0x2007: " ", 0x200A: " ",
        0x00AD: "", // soft hyphen is invisible
    ]

    private static func combining(_ v: UInt32) -> Bool {
        (0x0300...0x036F).contains(v) || (0x1AB0...0x1AFF).contains(v) || (0x1DC0...0x1DFF).contains(v)
            || (0x20D0...0x20FF).contains(v) || (0xFE20...0xFE2F).contains(v)
    }

    /// One scalar folded, as bytes.
    private static func scalar(_ s: Unicode.Scalar) -> [UInt8] {
        if let e = expand[s.value] { return Array(e.utf8) }
        let decomposed = String(s).decomposedStringWithCompatibilityMapping
        var kept = String.UnicodeScalarView()
        for u in decomposed.unicodeScalars where !combining(u.value) { kept.append(u) }
        return Array(String(kept).lowercased().utf8)
    }

    /// Fold `text`. ASCII, by far the common case, is lowered byte by byte; other
    /// characters are folded once each and remembered in `cache`.
    public static func bytes(_ text: String, cache: inout [UInt32: [UInt8]]) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(text.utf8.count)
        for s in text.unicodeScalars {
            let v = s.value
            if v < 128 {
                out.append(v >= 65 && v <= 90 ? UInt8(v + 32) : UInt8(v))
            } else if let f = cache[v] {
                out.append(contentsOf: f)
            } else {
                let f = scalar(s)
                cache[v] = f
                out.append(contentsOf: f)
            }
        }
        return out
    }

    public static func bytes(_ text: String) -> [UInt8] {
        var cache: [UInt32: [UInt8]] = [:]
        return bytes(text, cache: &cache)
    }

    public static func string(_ text: String) -> String { String(decoding: bytes(text), as: UTF8.self) }

    /// Every start of `needle` in `hay`, in order, not overlapping.
    public static func find(_ needle: [UInt8], in hay: [UInt8]) -> [Int] {
        guard let first = needle.first, needle.count <= hay.count else { return [] }
        var out: [Int] = []
        let n = needle.count, last = hay.count - n
        hay.withUnsafeBufferPointer { h in
            needle.withUnsafeBufferPointer { q in
                var i = 0
                while i <= last {
                    if h[i] == first {
                        var k = 1
                        while k < n && h[i + k] == q[k] { k += 1 }
                        if k == n { out.append(i); i += n; continue }
                    }
                    i += 1
                }
            }
        }
        return out
    }
}
