import XCTest
@testable import LeadingCore

final class MirrorTests: XCTestCase {
    func testFingerprintMatchesThePage() {
        // Same values as web/test/unit/editor-core.test.ts.
        XCTAssertEqual(TextMirror("").fingerprint, 0x811c9dc5)
        XCTAssertEqual(TextMirror("a").fingerprint, 0xe40c292c)
    }

    func testChangeSetsUseOriginalOffsets() {
        let m = TextMirror("Hello world")
        // Both offsets refer to the original text, as the page sends them.
        XCTAssertTrue(m.apply([.init(from: 0, to: 0, insert: "**"), .init(from: 5, to: 5, insert: "**")]))
        XCTAssertEqual(m.text, "**Hello** world")
    }

    func testOutOfRangeChangesAreRefused() {
        let m = TextMirror("abc")
        XCTAssertFalse(m.apply([.init(from: 2, to: 9, insert: "x")]))
        XCTAssertEqual(m.text, "abc")
    }

    /// Thousands of random change sets, including emoji and accents (surrogate
    /// pairs), applied to the mirror and to a plain model must agree.
    func testRandomEditSequencesStayInStep() {
        var rng = SystemRandomNumberGenerator()
        let alphabet = Array("ab cd\n*é—📖")
        for _ in 0..<200 {
            var model = Array("The quick brown fox 📖 café".utf16)
            let mirror = TextMirror(String(decoding: model, as: UTF16.self))
            for _ in 0..<50 {
                // A change set of 1–3 non-overlapping edits, in original offsets.
                var points = (0..<Int.random(in: 1...3, using: &rng) * 2).map { _ in Int.random(in: 0...model.count, using: &rng) }.sorted()
                // Never split a surrogate pair (the page never does either).
                points = points.map { p in p > 0 && p < model.count && UTF16.isTrailSurrogate(model[p]) ? p - 1 : p }
                var changes: [TextMirror.Change] = []
                var i = 0
                while i + 1 < points.count {
                    let insert = String((0..<Int.random(in: 0...3, using: &rng)).map { _ in alphabet.randomElement(using: &rng)! })
                    changes.append(.init(from: points[i], to: points[i + 1], insert: insert))
                    i += 2
                }
                // Overlapping edits are impossible from the page; drop any here.
                changes = changes.enumerated().filter { k, c in k == 0 || c.from >= changes[k - 1].to }.map(\.element)
                for c in changes.sorted(by: { $0.from > $1.from }) {
                    model.replaceSubrange(c.from..<c.to, with: Array(c.insert.utf16))
                }
                XCTAssertTrue(mirror.apply(changes))
            }
            XCTAssertEqual(mirror.text, String(decoding: model, as: UTF16.self))
        }
    }
}
