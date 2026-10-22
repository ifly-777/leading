import Foundation

/// Reading settings, global to every window. Mirrors `Settings` in
/// web/src/core/settings.ts field for field (the page receives it as JSON).
public struct ReaderSettings: Codable, Equatable {
    public var font = "literata"
    public var customFont = ""
    public var monoFont = "sfmono"
    public var size: Double = 19
    /// The text sizes allowed, in px; the page clamps to the same (RANGES.size in settings.ts)
    public static let sizeRange: ClosedRange<Double> = 14...28
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
    /// The deepest heading level the outline lists: 2, 3 or 4
    public var outlineDepth = 3
    /// A thin rule showing how far through the file, and minutes left (off by default)
    public var progress = false
    /// Dim everything but the paragraph being read (off by default)
    public var focus = false
    /// Page by page: Space and the arrow keys move a screen at a time (off by default)
    public var paged = false
    /// Curly quotes, dashes and ellipses as you type in edit mode (on by default)
    public var smartTyping = true
    /// The colour ⇧⌘H applies: the last one chosen
    public var lastHighlight = "yellow"
    /// The reader's own display colours ("#RRGGBB" per slot); light also serves sepia.
    /// Files always keep the standard colours; only how Leading shows them changes.
    public var highlightColors = HighlightColors()

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
        take(.align, &align); take(.highlightStyle, &highlightStyle); take(.zebra, &zebra); take(.outlineOpen, &outlineOpen); take(.outlineDepth, &outlineDepth); take(.smartTyping, &smartTyping)
        take(.progress, &progress); take(.focus, &focus); take(.paged, &paged)
        take(.lastHighlight, &lastHighlight); take(.highlightColors, &highlightColors)
        if !HighlightColors.slots.contains(lastHighlight) { lastHighlight = "yellow" }
        clamp()
    }

    /// Keep values inside the ranges the page supports.
    public mutating func clamp() {
        size = min(Self.sizeRange.upperBound, max(Self.sizeRange.lowerBound, size.rounded()))
        lineHeight = min(2.0, max(1.2, lineHeight))
        letterSpacing = min(0.12, max(-0.02, letterSpacing))
        wordSpacing = min(0.16, max(0, wordSpacing))
        paragraphSpacing = min(2, max(0, paragraphSpacing))
        outlineDepth = min(4, max(2, outlineDepth))
    }

    /// The reading settings back to Leading's own, keeping what is the reader's
    /// rather than the page's look: the margin's state, the last highlight colour,
    /// their own highlight colours, and smart punctuation.
    public func restoringDefaults() -> ReaderSettings {
        var d = ReaderSettings()
        d.outlineOpen = outlineOpen
        d.lastHighlight = lastHighlight
        d.highlightColors = highlightColors
        d.smartTyping = smartTyping
        return d
    }

    /// As a JSON-compatible dictionary, for passing to the page.
    public var dictionary: [String: Any] {
        let data = (try? JSONEncoder().encode(self)) ?? Data("{}".utf8)
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}

/// Display colours the reader has chosen for the five highlight slots.
public struct HighlightColors: Codable, Equatable {
    public static let slots = ["yellow", "green", "blue", "pink", "orange"]
    public static let names = ["yellow": "Yellow", "green": "Green", "blue": "Blue", "pink": "Pink", "orange": "Orange"]
    /// Leading's own tuned fills, as in web/src/core/settings.ts (TUNING).
    public static let defaultLight = ["yellow": "#FBE59B", "green": "#CFEBC3", "blue": "#CFE0F7", "pink": "#F7D0E2", "orange": "#F9D6AE"]
    public static let defaultDark = ["yellow": "#5B4C1C", "green": "#2D4A2E", "blue": "#263E5C", "pink": "#5A2E45", "orange": "#5E3E1F"]

    public var light: [String: String] = [:]
    public var dark: [String: String] = [:]

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        light = (try? c.decode([String: String].self, forKey: .light)) ?? [:]
        dark = (try? c.decode([String: String].self, forKey: .dark)) ?? [:]
    }

    public var isDefault: Bool { light.isEmpty && dark.isEmpty }
}
