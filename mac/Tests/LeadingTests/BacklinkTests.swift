import XCTest
@testable import LeadingCore

final class BacklinkTests: XCTestCase {
    private var vault: URL!

    /// A vault where several notes link to Books/Walden.md, in the ways notes do, and one only mentions it.
    override func setUpWithError() throws {
        vault = FileManager.default.temporaryDirectory.appendingPathComponent("links-\(UUID().uuidString)", isDirectory: true)
        let fm = FileManager.default
        for dir in [".obsidian", "Daily", "Books", "Deep/Er"] {
            try fm.createDirectory(at: vault.appendingPathComponent(dir), withIntermediateDirectories: true)
        }
        let files = [
            "Books/Walden.md": "# Walden\n\nSee [[Walden#Economy]] in itself.",
            "Daily/Today.md": "- Reading [[walden|Thoreau]] again\n- Unrelated line",
            "Daily/Embeds.md": "![[Walden#^quote]]",
            "Deep/Er/Path.md": "By path: [[Books/Walden]] and a [link](../../Books/Walden.md).",
            "Daily/Mention.md": "Walden is mentioned, not linked. [[Walden Pond]] is another note.",
            "Daily/Other.md": "[text](Walden.md) points beside this note, where there is none.",
        ]
        for (name, text) in files { try Data(text.utf8).write(to: vault.appendingPathComponent(name)) }
    }

    override func tearDown() { try? FileManager.default.removeItem(at: vault) }

    func testEveryKindOfLinkIsFoundAndNothingElse() {
        let found = Backlinks.find(to: vault.appendingPathComponent("Books/Walden.md"), home: vault.deletingLastPathComponent())
        // Shallowest first, then by name; the note itself and mere mentions are left out.
        XCTAssertEqual(found.map(\.name), ["Embeds", "Today", "Path"])
        XCTAssertEqual(found.first { $0.name == "Today" }?.lines, ["Reading Thoreau again"])
        XCTAssertEqual(found.first { $0.name == "Path" }?.lines, ["By path: Books/Walden and a link."])
        XCTAssertEqual(found.first { $0.name == "Embeds" }?.lines, ["Walden › quote"])
    }

    func testCleaningALineForAGlance() {
        XCTAssertEqual(Backlinks.clean("> - [ ] **Read** [[A|this]] %%aside%% now"), "Read this  now")
        XCTAssertEqual(Backlinks.clean("## [[A#Part]]"), "A › Part")
    }
}
