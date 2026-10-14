import XCTest
@testable import LeadingCore

final class PlaceStoreTests: XCTestCase {
    private var folder: URL!

    override func setUp() {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("places-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() { try? FileManager.default.removeItem(at: folder) }

    private var file: URL { folder.appendingPathComponent("places.json") }

    func testRoundTripsThroughTheFile() {
        let doc = URL(fileURLWithPath: "/Users/me/Notes/Walden.md")
        let a = PlaceStore(file: file)
        XCTAssertNil(a.place(for: doc))
        a.set(Place(s: 1234, dy: 56), for: doc)
        a.save()
        XCTAssertFalse(a.hasUnsavedChanges)
        let b = PlaceStore(file: file)
        XCTAssertEqual(b.place(for: doc)?.s, 1234)
        XCTAssertEqual(b.place(for: doc)?.dy, 56)
    }

    func testTwoRoutesToOneFileAgree() {
        let s = PlaceStore(file: file)
        s.set(Place(s: 9, dy: 0), for: URL(fileURLWithPath: "/Users/me/Notes/../Notes/a.md"))
        XCTAssertEqual(s.place(for: URL(fileURLWithPath: "/Users/me/Notes/a.md"))?.s, 9)
    }

    func testOldestAreDroppedPastTheLimit() {
        let s = PlaceStore(file: file, limit: 3)
        for i in 0..<5 {
            s.set(Place(s: i, dy: 0, at: Date(timeIntervalSince1970: Double(i))), for: URL(fileURLWithPath: "/n/\(i).md"))
        }
        XCTAssertNil(s.place(for: URL(fileURLWithPath: "/n/0.md")))
        XCTAssertNil(s.place(for: URL(fileURLWithPath: "/n/1.md")))
        XCTAssertEqual(s.place(for: URL(fileURLWithPath: "/n/4.md"))?.s, 4)
    }

    func testAMovedFileKeepsItsPlace() {
        let s = PlaceStore(file: file)
        let old = URL(fileURLWithPath: "/n/draft.md"), new = URL(fileURLWithPath: "/n/final.md")
        s.set(Place(s: 77, dy: 3), for: old)
        s.move(from: old, to: new)
        XCTAssertNil(s.place(for: old))
        XCTAssertEqual(s.place(for: new)?.s, 77)
    }

    func testAnUnreadableFileStartsEmpty() throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: file)
        XCTAssertNil(PlaceStore(file: file).place(for: URL(fileURLWithPath: "/n/a.md")))
    }
}
