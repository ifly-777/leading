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

/// A vault of 10,000 notes: how long the index takes to build, how long a search takes,
/// and how much text the index holds. Printed for docs/decisions.md; the limits are
/// loose, since shared CI machines vary.
final class VaultIndexScaleTests: XCTestCase {
    func testTenThousandNotes() throws {
        let fm = FileManager.default
        let vault = fm.temporaryDirectory.appendingPathComponent("big-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: vault) }
        try fm.createDirectory(at: vault.appendingPathComponent(".obsidian"), withIntermediateDirectories: true)
        let words = "the quiet harbour lamp was lit again before the tide turned and the boats came home over grey water".split(separator: " ")
        for f in 0..<20 { try fm.createDirectory(at: vault.appendingPathComponent("Folder \(f)"), withIntermediateDirectories: true) }
        // About 2.5 KB each: a heading, twenty lines of prose, a few links.
        for i in 0..<10_000 {
            var text = "# Note \(i)\n\n"
            for l in 0..<20 {
                text += (0..<18).map { String(words[($0 * 7 + l * 3 + i) % words.count]) }.joined(separator: " ")
                text += l % 5 == 0 ? " See [[Note \((i + l) % 10_000)]].\n" : ".\n"
            }
            if i == 7_777 { text += "A single kumquat.\n" }
            try Data(text.utf8).write(to: vault.appendingPathComponent("Folder \(i % 20)/Note \(i).md"))
        }
        let index = VaultIndex(root: vault)
        var t = Date()
        index.build()
        let build = Date().timeIntervalSince(t)
        let memory = index.textBytes
        t = Date()
        let common = index.search("harbour lamp")
        let rare = index.search("kumquat")
        let search = Date().timeIntervalSince(t) / 2
        t = Date()
        let links = index.backlinks(to: vault.appendingPathComponent("Folder 3/Note 123.md"))
        let backlinks = Date().timeIntervalSince(t)
        print(String(format: "VAULT SCALE: 10,000 notes built in %.2f s, %ld MB of text held; a search takes %.0f ms; links to a note %.0f ms",
                     build, memory / 1_000_000, search * 1000, backlinks * 1000))
        XCTAssertEqual(rare.hits.map(\.name), ["Note 7777"])
        XCTAssertGreaterThan(common.notes, 1000)
        XCTAssertFalse(links.isEmpty)
        XCTAssertLessThan(build, 60)
        XCTAssertLessThan(search, 1)
    }
}
