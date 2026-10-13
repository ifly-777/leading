import XCTest
@testable import LeadingCore

final class TextFileTests: XCTestCase {
    func testUTF8RoundTripsByteForByte() {
        let data = Data("Café — “quotes”\nline two\n".utf8)
        let f = TextFile.decode(data)
        XCTAssertEqual(f.encoding, .utf8)
        XCTAssertEqual(f.lineEnding, .lf)
        XCTAssertEqual(f.encoded(), data)
    }

    func testCRLFIsNormalisedAndRestored() {
        let data = Data("one\r\ntwo\r\n".utf8)
        let f = TextFile.decode(data)
        XCTAssertEqual(f.text, "one\ntwo\n")
        XCTAssertEqual(f.lineEnding, .crlf)
        XCTAssertEqual(f.encoded(), data)
    }

    func testBOMIsKept() {
        let data = Data([0xEF, 0xBB, 0xBF] + Array("# Title\n".utf8))
        let f = TextFile.decode(data)
        XCTAssertEqual(f.text, "# Title\n")
        XCTAssertTrue(f.hasBOM)
        XCTAssertEqual(f.encoded(), data)
    }

    func testUTF16WithBOM() {
        var data = Data([0xFF, 0xFE])
        data.append("héllo\n".data(using: .utf16LittleEndian)!)
        let f = TextFile.decode(data)
        XCTAssertEqual(f.text, "héllo\n")
        XCTAssertEqual(f.encoded(), data)
    }

    func testInvalidUTF8FallsBackAndStillOpens() {
        let data = Data([0x63, 0x61, 0x66, 0xE9, 0x0A]) // "café" in Latin-1
        let f = TextFile.decode(data)
        XCTAssertEqual(f.text, "café\n")
        XCTAssertEqual(f.encoded(), data)
    }
}

final class PathTests: XCTestCase {
    let doc = URL(fileURLWithPath: "/Users/me/Vault/Notes/today.md")

    func testWebAndMailLinksGoOutside() {
        XCTAssertEqual(Paths.linkTarget("https://example.com/a", document: doc), .external(URL(string: "https://example.com/a")!))
        XCTAssertEqual(Paths.linkTarget("mailto:a@b.c", document: doc), .external(URL(string: "mailto:a@b.c")!))
    }

    func testScriptLinksAreNeverFollowed() {
        XCTAssertEqual(Paths.linkTarget("javascript:alert(1)", document: doc), .none)
        XCTAssertEqual(Paths.linkTarget("data:text/html,x", document: doc), .none)
    }

    func testRelativeMarkdownLinksOpenInLeading() {
        XCTAssertEqual(Paths.linkTarget("../Other%20Note.md#part", document: doc),
                       .document(URL(fileURLWithPath: "/Users/me/Vault/Other Note.md")))
        XCTAssertEqual(Paths.linkTarget("report.pdf", document: doc), .otherFile(URL(fileURLWithPath: "/Users/me/Vault/Notes/report.pdf")))
    }

    func testOnlyImagesAreServed() {
        let folder = doc.deletingLastPathComponent()
        XCTAssertEqual(Paths.imageFile(requestPath: "attachments/pic%201.png", documentFolder: folder),
                       URL(fileURLWithPath: "/Users/me/Vault/Notes/attachments/pic 1.png"))
        XCTAssertNil(Paths.imageFile(requestPath: "../../.ssh/id_rsa", documentFolder: folder))
        XCTAssertNil(Paths.imageFile(requestPath: "secrets.txt", documentFolder: folder))
    }
}

final class SettingsTests: XCTestCase {
    func testDefaultsMatchThePage() {
        let s = ReaderSettings()
        XCTAssertEqual(s.font, "literata"); XCTAssertEqual(s.size, 19); XCTAssertEqual(s.lineHeight, 1.5)
        XCTAssertEqual(s.measure, "medium"); XCTAssertEqual(s.theme, "system"); XCTAssertFalse(s.outlineOpen)
    }

    func testLenientDecodingKeepsDefaultsAndClamps() throws {
        let json = #"{"size": 40, "theme": "dark", "somethingNew": true}"#
        let s = try JSONDecoder().decode(ReaderSettings.self, from: Data(json.utf8))
        XCTAssertEqual(s.size, 28)
        XCTAssertEqual(s.theme, "dark")
        XCTAssertEqual(s.font, "literata")
    }

    func testHighlightSettingsRoundTripAndRejectUnknownColours() throws {
        var s = ReaderSettings()
        XCTAssertEqual(s.lastHighlight, "yellow")
        XCTAssertTrue(s.highlightColors.isDefault)
        s.lastHighlight = "green"
        s.highlightColors.dark["pink"] = "#AA3366"
        let back = try JSONDecoder().decode(ReaderSettings.self, from: JSONEncoder().encode(s))
        XCTAssertEqual(back, s)
        // The page receives the colours as plain JSON objects.
        let colors = s.dictionary["highlightColors"] as? [String: [String: String]]
        XCTAssertEqual(colors?["dark"]?["pink"], "#AA3366")
        // A colour name the app does not know falls back to yellow.
        let odd = try JSONDecoder().decode(ReaderSettings.self, from: Data(#"{"lastHighlight": "purple"}"#.utf8))
        XCTAssertEqual(odd.lastHighlight, "yellow")
    }
}
