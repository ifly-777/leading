import CommonCrypto
import CryptoKit
import Foundation
import Security

/// A note encrypted with a password, stored as plain-text armour inside the
/// same .md file: a notice anyone can read (so Obsidian shows a sentence, not
/// garbage) and a base64 block only the password opens. Staying text keeps the
/// file's name, wikilinks and sync working.
///
/// The block is a 21-byte header (version 1, PBKDF2 rounds as a big-endian
/// u32, a 16-byte salt) followed by AES-GCM's combined box (nonce, ciphertext,
/// tag). The header is authenticated with the text, so changing the salt or the
/// round count fails just as a changed ciphertext does.
public enum SealedText {
    public enum Failure: Error, Equatable {
        case notSealed
        case malformed
        /// GCM cannot tell a wrong password from a damaged file, and should not try.
        case wrongPasswordOrDamaged
    }

    /// The first line of every encrypted note. Detection looks only here, so a
    /// note that merely mentions the phrase lower down is never taken for one.
    public static let magic = "<!-- leading-encrypted v1 -->"
    /// OWASP's 2023 figure for PBKDF2-HMAC-SHA256: about 0.3 s on an M2.
    public static let defaultRounds: UInt32 = 600_000
    static let version: UInt8 = 1
    static let headerSize = 1 + 4 + 16
    static let fence = "```leading-encrypted"

    static let notice = """
    # Encrypted note

    This note is encrypted with Leading. Open it in Leading and enter its password to read it. Do not edit the block below: any change makes the note unreadable.
    """

    public static func isSealed(_ data: Data) -> Bool {
        var body = data[...]
        // A sync tool or editor may have added a byte-order mark; it changes nothing.
        if body.starts(with: [0xEF, 0xBB, 0xBF]) { body = body.dropFirst(3) }
        return body.starts(with: Data(magic.utf8))
    }

    public static func newSalt() -> Data {
        var bytes = [UInt8](repeating: 0, count: 16)
        precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess)
        return Data(bytes)
    }

    public static func deriveKey(password: String, salt: Data, rounds: UInt32 = defaultRounds) -> SymmetricKey {
        var key = [UInt8](repeating: 0, count: 32)
        let pw = Array(password.utf8)
        let status = salt.withUnsafeBytes { s in
            pw.withUnsafeBufferPointer { p in
                p.baseAddress!.withMemoryRebound(to: Int8.self, capacity: pw.count) { pp in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pp, pw.count,
                                         s.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                         CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), rounds, &key, key.count)
                }
            }
        }
        precondition(status == kCCSuccess, "PBKDF2 failed: \(status)")
        defer { key.withUnsafeMutableBytes { memset_s($0.baseAddress, $0.count, 0, $0.count) } }
        return SymmetricKey(data: key)
    }

    /// The whole file: notice, then the block. A fresh nonce every time.
    public static func seal(_ text: String, key: SymmetricKey, salt: Data, rounds: UInt32 = defaultRounds) -> Data {
        let head = header(salt: salt, rounds: rounds)
        // Sealing with a valid key and a random nonce cannot fail.
        let box = try! AES.GCM.seal(Data(text.utf8), using: key, authenticating: head)
        let payload = (head + box.combined!).base64EncodedString(options: [.lineLength76Characters, .endLineWithLineFeed])
        return Data("\(magic)\n\(notice)\n\n\(fence)\n\(payload)\n```\n".utf8)
    }

    /// The salt and round count the file was sealed with, to derive its key.
    public static func parameters(_ data: Data) throws -> (salt: Data, rounds: UInt32) {
        let blob = try payload(data)
        return (blob[blob.startIndex + 5 ..< blob.startIndex + headerSize], rounds(blob))
    }

    public static func open(_ data: Data, key: SymmetricKey) throws -> String {
        let blob = try payload(data)
        let head = blob.prefix(headerSize)
        do {
            let box = try AES.GCM.SealedBox(combined: blob.dropFirst(headerSize))
            let plain = try AES.GCM.open(box, using: key, authenticating: head)
            guard let text = String(data: plain, encoding: .utf8) else { throw Failure.wrongPasswordOrDamaged }
            return text
        } catch let error as Failure {
            throw error
        } catch {
            throw Failure.wrongPasswordOrDamaged
        }
    }

    public static func open(_ data: Data, password: String) throws -> (text: String, key: SymmetricKey, salt: Data, rounds: UInt32) {
        let p = try parameters(data)
        let key = deriveKey(password: password, salt: p.salt, rounds: p.rounds)
        return (try open(data, key: key), key, p.salt, p.rounds)
    }

    // MARK: Parts

    static func header(salt: Data, rounds: UInt32) -> Data {
        var d = Data([version])
        withUnsafeBytes(of: rounds.bigEndian) { d.append(contentsOf: $0) }
        d.append(salt)
        return d
    }

    private static func rounds(_ blob: Data) -> UInt32 {
        blob[blob.startIndex + 1 ..< blob.startIndex + 5].reduce(0) { $0 << 8 | UInt32($1) }
    }

    /// The decoded block: header and box, checked for shape.
    private static func payload(_ data: Data) throws -> Data {
        guard isSealed(data) else { throw Failure.notSealed }
        // Lines, not offsets: a sync tool may have turned the line endings into CRLF.
        let lines = String(decoding: data, as: UTF8.self).components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard let start = lines.firstIndex(of: fence),
              let end = lines[(start + 1)...].firstIndex(of: "```"),
              let blob = Data(base64Encoded: lines[(start + 1)..<end].joined(), options: .ignoreUnknownCharacters)
        else { throw Failure.malformed }
        // Header, a 12-byte nonce and a 16-byte tag at the least.
        guard blob.count >= headerSize + 12 + 16, blob.first == version else { throw Failure.malformed }
        let r = rounds(blob)
        // A round count this low or this high is damage, not a choice anyone made;
        // refusing it also stops a tampered file from hanging the app.
        guard r >= 10_000, r <= 50_000_000 else { throw Failure.malformed }
        return blob
    }
}
