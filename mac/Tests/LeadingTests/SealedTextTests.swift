import CryptoKit
import XCTest
@testable import LeadingCore

final class SealedTextTests: XCTestCase {
    // The lowest round count a file may carry, so the suite stays quick.
    private let rounds: UInt32 = 10_000
    private let salt = SealedText.newSalt()
    private lazy var key = SealedText.deriveKey(password: "correct horse", salt: salt, rounds: rounds)

    private func sealed(_ text: String) -> Data { SealedText.seal(text, key: key, salt: salt, rounds: rounds) }

    func testRoundTrip() throws {
        let text = "# Private\n\nCafé — “quotes” and an emoji 🔒\n"
        let r = try SealedText.open(sealed(text), password: "correct horse")
        XCTAssertEqual(r.text, text)
        XCTAssertEqual(r.rounds, rounds)
        XCTAssertEqual(r.salt, salt)
    }

    func testLargeText() throws {
        let text = String(repeating: "A line of prose, long enough to matter. ", count: 130_000)
        XCTAssertEqual(try SealedText.open(sealed(text), key: key), text)
    }

    func testWrongPassword() {
        XCTAssertThrowsError(try SealedText.open(sealed("secret"), password: "wrong")) {
            XCTAssertEqual($0 as? SealedText.Failure, .wrongPasswordOrDamaged)
        }
    }

    func testFileIsReadableTextWithANotice() {
        let s = String(decoding: sealed("secret"), as: UTF8.self)
        XCTAssertTrue(s.hasPrefix(SealedText.magic + "\n# Encrypted note"))
        XCTAssertFalse(s.contains("secret"))
    }

    func testTwoSealsDiffer() {
        XCTAssertNotEqual(sealed("same"), sealed("same"))
    }

    /// Change one byte of the decoded block at `index` and re-armour it.
    private func tampered(_ data: Data, at index: (Int) -> Int) -> Data {
        let lines = String(decoding: data, as: UTF8.self).components(separatedBy: "\n")
        let start = lines.firstIndex(of: SealedText.fence)! + 1
        let end = lines[start...].firstIndex(of: "```")!
        var blob = Data(base64Encoded: lines[start..<end].joined())!
        let i = index(blob.count)
        blob[i] ^= 0x01
        let rebuilt = lines[..<start] + [blob.base64EncodedString()] + lines[end...]
        return Data(rebuilt.joined(separator: "\n").utf8)
    }

    func testTamperingIsCaught() {
        let data = sealed("secret")
        // The salt (header), the middle of the ciphertext, and the tag.
        for at in [{ (_: Int) in 10 }, { (n: Int) in SealedText.headerSize + 12 + 2 }, { (n: Int) in n - 1 }] {
            XCTAssertThrowsError(try SealedText.open(tampered(data, at: at), key: key)) {
                XCTAssertEqual($0 as? SealedText.Failure, .wrongPasswordOrDamaged)
            }
        }
    }

    func testCRLFStillOpens() throws {
        let crlf = String(decoding: sealed("secret"), as: UTF8.self).replacingOccurrences(of: "\n", with: "\r\n")
        XCTAssertEqual(try SealedText.open(Data(crlf.utf8), key: key), "secret")
    }

    func testDetection() {
        XCTAssertTrue(SealedText.isSealed(sealed("x")))
        XCTAssertTrue(SealedText.isSealed(Data([0xEF, 0xBB, 0xBF]) + sealed("x")))
        XCTAssertFalse(SealedText.isSealed(Data("# Note\n".utf8)))
        XCTAssertFalse(SealedText.isSealed(Data("# Note\n\(SealedText.magic)\n".utf8)))
        XCTAssertThrowsError(try SealedText.open(Data("# Note\n".utf8), key: key)) {
            XCTAssertEqual($0 as? SealedText.Failure, .notSealed)
        }
    }

    func testDamagedBlockIsMalformed() {
        let cut = Data("\(SealedText.magic)\n\(SealedText.fence)\nAAAA\n```\n".utf8)
        XCTAssertThrowsError(try SealedText.parameters(cut)) {
            XCTAssertEqual($0 as? SealedText.Failure, .malformed)
        }
    }
}
