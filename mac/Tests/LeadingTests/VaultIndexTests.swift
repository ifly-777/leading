import XCTest
@testable import LeadingCore

final class FoldTests: XCTestCase {
    /// The cases web/test/unit/fold.test.ts checks, so Find and vault search agree.
    private func finds(_ hay: String, _ q: String) -> Int { Fold.find(Fold.bytes(q), in: Fold.bytes(hay)).count }

    func testCaseAndAccents() {
        XCTAssertEqual(finds("Café CAFE cafe", "cafe"), 3)
        XCTAssertEqual(finds("Zürich", "zurich"), 1)
    }

    func testTypographyBothWays() {
        XCTAssertEqual(finds("it’s", "it's"), 1)
        XCTAssertEqual(finds("“word”", "\"word\""), 1)
        XCTAssertEqual(finds("10–20", "10--20"), 1)
        XCTAssertEqual(finds("a—b", "a---b"), 1)
        XCTAssertEqual(finds("wait…", "wait..."), 1)
        XCTAssertEqual(finds("it's", "it’s"), 1)
        XCTAssertEqual(finds("soft\u{AD}ware", "software"), 1)
    }

    func testAstralAndLineBreaks() {
        XCTAssertEqual(finds("a 📖 b 📖", "📖"), 2)
        XCTAssertEqual(Fold.bytes("A\nB").filter { $0 == 10 }.count, 1)
    }
}

final class VaultIndexTests: XCTestCase {
    private var vault: URL!

    private func write(_ files: [String: String]) throws {
        let fm = FileManager.default
        for (name, text) in files {
            let url = vault.appendingPathComponent(name)
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url)
        }
    }

    private func url(_ name: String) -> URL { vault.appendingPathComponent(name) }

    override func setUpWithError() throws {
        vault = FileManager.default.temporaryDirectory.appendingPathComponent("vault-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: vault.appendingPathComponent(".obsidian"), withIntermediateDirectories: true)
        try write([
            // Two notes called Walden. A [[Walden]] beside each opens that one.
            "Books/Walden.md": "# Walden\n\nThe book. It’s about the woods.",
            "Places/Walden.md": "# Walden Pond\n\nThe place.",
            "Books/Reading.md": "- Reading [[Walden]] again\n- A **café** visit",
            "Places/Visit.md": "We swam in [[Walden|the pond]].",
            // Nowhere beside: the shallowest Walden wins; tied depth goes to the path that sorts first.
            "Top.md": "Start with [[Walden]].",
            "Locked.md": SealedText.magic + "\nsecret woods",
            "pic.png": "",
        ])
    }

    override func tearDown() { try? FileManager.default.removeItem(at: vault) }

    private func built() -> VaultIndex {
        let index = VaultIndex(root: vault)
        index.build()
        return index
    }

    func testSharedNamesListOnlyTheNoteALinkOpens() {
        let index = built()
        let books = index.backlinks(to: url("Books/Walden.md")).map(\.name)
        let places = index.backlinks(to: url("Places/Walden.md")).map(\.name)
        XCTAssertEqual(books, ["Top", "Reading"])
        XCTAssertEqual(places, ["Visit"])
        // The list agrees with a click.
        XCTAssertEqual(index.resolve("Walden", from: url("Places/Visit.md"))?.lastPathComponent, "Walden.md")
        XCTAssertEqual(index.resolve("Walden", from: url("Top.md"))?.deletingLastPathComponent().lastPathComponent, "Books")
        XCTAssertEqual(index.resolve("Places/Walden", from: url("Top.md"))?.deletingLastPathComponent().lastPathComponent, "Places")
        XCTAssertEqual(index.resolve("pic.png", from: url("Books/Reading.md"))?.lastPathComponent, "pic.png")
        XCTAssertNil(index.resolve("Nowhere", from: url("Top.md")))
    }

    func testSearchFoldsAsFindDoesAndRanksNamesFirst() {
        let index = built()
        let r = index.search("walden")
        // Names first, then by count, depth and name.
        XCTAssertEqual(r.hits.prefix(2).map(\.name), ["Walden", "Walden"])
        XCTAssertTrue(r.hits.prefix(2).allSatisfy(\.inName))
        XCTAssertEqual(index.search("cafe").hits.first?.lines.first?.text, "A café visit")
        XCTAssertEqual(index.search("it's about").hits.map(\.name), ["Walden"])
        // The line's offset is where it starts in the note, as the page counts.
        XCTAssertEqual(index.search("cafe").hits.first?.lines.first?.offset, "- Reading [[Walden]] again\n".utf16.count)
        // An alias reads as its text.
        XCTAssertEqual(index.search("the pond").hits.map(\.name), ["Visit"])
    }

    func testEncryptedNotesAreFoundByNameOnly() {
        let index = built()
        XCTAssertTrue(index.search("secret").hits.isEmpty)
        XCTAssertEqual(index.search("locked").hits.map(\.name), ["Locked"])
    }

    func testUpdatesFollowTheDisk() throws {
        let index = built()
        try write(["Daily/New.md": "Fresh [[Walden]] and kumquats"])
        index.update([url("Daily")])
        XCTAssertEqual(index.search("kumquats").hits.map(\.name), ["New"])
        XCTAssertTrue(index.backlinks(to: url("Books/Walden.md")).map(\.name).contains("New"))

        // A note that goes changes where [[Walden]] leads.
        try FileManager.default.removeItem(at: url("Books/Walden.md"))
        index.update([url("Books/Walden.md")])
        XCTAssertEqual(index.resolve("Walden", from: url("Top.md"))?.deletingLastPathComponent().lastPathComponent, "Places")
        XCTAssertTrue(index.backlinks(to: url("Places/Walden.md")).map(\.name).contains("Top"))

        // An edited note is read again; a removed folder takes its notes with it.
        try write(["Top.md": "Nothing here now."])
        index.update([url("Top.md")])
        XCTAssertFalse(index.backlinks(to: url("Places/Walden.md")).map(\.name).contains("Top"))
        try FileManager.default.removeItem(at: url("Daily"))
        index.update([url("Daily")])
        XCTAssertTrue(index.search("kumquats").hits.isEmpty)
    }

    func testHiddenFoldersAreLeftOut() throws {
        try write([".trash/Old.md": "kumquats"])
        let index = built()
        index.update([url(".trash/Old.md")])
        XCTAssertTrue(index.search("kumquats").hits.isEmpty)
    }
}
