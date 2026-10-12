import Foundation

/// Reading settings, global to every window. Mirrors `Settings` in
/// web/src/core/settings.ts field for field (the page receives it as JSON).
public struct ReaderSettings: Codable, Equatable {
    public var font = "literata"
    public var customFont = ""
    public var monoFont = "sfmono"
    public var size: Double = 19
    public var lineHeight: Double = 1.5
    public var measure = "medium"
    public var theme = "system"
    public var letterSpacing: Double = 0
    public var wordSpacing: Double = 0
    public var paragraphStyle = "space"
    public var paragraphSpacing: Double = 0.8
    public var align = "left"
    public var highlightStyle = "marker"
    public var zebra = false
    public var outlineOpen = false

    public init() {}

    /// Decode leniently: unknown keys are ignored and missing ones keep their
    /// defaults, so settings survive app updates in both directions.
    public init(from decoder: Decoder) throws {
        self.init()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func take<T: Decodable>(_ key: CodingKeys, _ into: inout T) { if let v = try? c.decode(T.self, forKey: key) { into = v } }
        take(.font, &font); take(.customFont, &customFont); take(.monoFont, &monoFont)
        take(.size, &size); take(.lineHeight, &lineHeight); take(.measure, &measure); take(.theme, &theme)
        take(.letterSpacing, &letterSpacing); take(.wordSpacing, &wordSpacing)
        take(.paragraphStyle, &paragraphStyle); take(.paragraphSpacing, &paragraphSpacing)
        take(.align, &align); take(.highlightStyle, &highlightStyle); take(.zebra, &zebra); take(.outlineOpen, &outlineOpen)
        clamp()
    }

    /// Keep values inside the ranges the page supports.
    public mutating func clamp() {
        size = min(28, max(14, size.rounded()))
        lineHeight = min(2.0, max(1.2, lineHeight))
        letterSpacing = min(0.12, max(-0.02, letterSpacing))
        wordSpacing = min(0.16, max(0, wordSpacing))
        paragraphSpacing = min(2, max(0, paragraphSpacing))
    }

    /// As a JSON-compatible dictionary, for passing to the page.
    public var dictionary: [String: Any] {
        let data = (try? JSONEncoder().encode(self)) ?? Data("{}".utf8)
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}
