import AppKit
import CryptoKit
import LeadingCore

/// One open Markdown or text file.
///
/// The text lives in two places while editing: the page's editor (the truth
/// the reader types into) and `mirror`, Swift's copy, updated from the
/// editor's change messages. Saving reads the mirror, so it never has to wait
/// for the page. A fingerprint check after each pause in typing keeps the two
/// honest (see DocumentWindowController.pageSettled).
///
/// Saving is macOS's autosave in place, which also gives File › Revert To and
/// the version browser. The file's encoding, line endings and byte-order mark
/// are written back exactly as found.
///
/// An encrypted note (see SealedText) opens locked: only its sealed bytes are
/// held, and the window shows a password field instead of the page. Unlocked,
/// the derived key is kept (never the password) and every save seals the text
/// afresh. Locked again, the key and the text are dropped.
@objc(MarkdownDocument)
final class MarkdownDocument: NSDocument {
    /// How the file is stored on disk (encoding, line endings, BOM).
    private(set) var file = TextFile(text: "")
    private(set) var mirror = TextMirror("")
    /// Show the file as written rather than as Markdown (for this session only;
    /// remembering it would mean writing metadata into the user's files).
    var showsPlainText = false
    let openedAt = Date()

    var text: String { mirror.text }
    /// The text as Leading last read or wrote it on disk. macOS reports our own
    /// saves as changes too, often after more typing; matching this tells them
    /// apart from another app's edits.
    private var diskText = ""

    // MARK: Encryption state

    /// The file is an encrypted note (locked or not).
    private(set) var isEncrypted = false
    /// The derived key while unlocked; nil while locked.
    private var key: SymmetricKey?
    private var salt = Data()
    private var rounds = SealedText.defaultRounds
    /// The note's sealed bytes as last read or written. While locked this is all
    /// there is, and every save writes exactly these bytes back.
    private var sealed = Data()
    var isPasswordLocked: Bool { isEncrypted && key == nil }

    override class var autosavesInPlace: Bool { true }

    /// Saved for the first time, renamed or moved: local images are found next to the new place.
    override var fileURL: URL? {
        didSet {
            guard let url = fileURL, url != oldValue else { return }
            if let oldValue { Places.shared?.move(from: oldValue, to: url) }
            for wc in windowControllers { (wc as? DocumentWindowController)?.documentMoved(to: url) }
        }
    }
    override class func canConcurrentlyReadDocuments(ofType typeName: String) -> Bool { true }

    override func read(from data: Data, ofType typeName: String) throws {
        guard SealedText.isSealed(data) else {
            isEncrypted = false; key = nil; sealed = Data()
            file = TextFile.decode(data)
            mirror = TextMirror(file.text)
            diskText = file.text
            return
        }
        isEncrypted = true
        sealed = data
        // A version restored while unlocked opens with the key we hold, if it was
        // sealed with the same password; otherwise the note locks and asks for that one.
        if let key, let text = try? SealedText.open(data, key: key) {
            setText(text)
        } else {
            key = nil
            setText("")
        }
    }

    private func setText(_ text: String) {
        file = TextFile(text: text)
        mirror = TextMirror(text)
        diskText = text
    }

    override func data(ofType typeName: String) throws -> Data {
        if isEncrypted {
            // Locked: write back what is there, never an empty or plain note.
            guard let key else { return sealed }
            sealed = SealedText.seal(mirror.text, key: key, salt: salt, rounds: rounds)
            diskText = mirror.text
            return sealed
        }
        var out = file
        out.text = mirror.text
        diskText = out.text
        if let data = out.encoded() { return data }
        // The original encoding (an old Latin-1 file, say) cannot hold something
        // just typed, such as an emoji. Save as UTF-8 rather than lose it.
        NSLog("Leading: %@ now contains characters its encoding cannot hold; saving as UTF-8", displayName)
        out.encoding = .utf8
        out.hasBOM = false
        file = out
        return out.encoded() ?? Data(mirror.text.utf8)
    }

    override func makeWindowControllers() {
        addWindowController(DocumentWindowController(document: self))
    }

    // MARK: Edits from the page

    /// Apply a change set from the editor. Returns false if it did not fit
    /// (the caller then fetches the whole text from the page).
    func applyEdits(_ changes: [TextMirror.Change]) -> Bool {
        guard mirror.apply(changes) else { return false }
        updateChangeCount(.changeDone) // autosave writes it a moment later
        return true
    }

    /// Replace the mirror with the page's text after a failed check.
    func resync(_ text: String) {
        mirror.replaceAll(text)
        updateChangeCount(.changeDone)
    }

    // MARK: Encryption

    /// Deriving a key takes about a third of a second, so it runs off the main thread.
    private static let crypto = DispatchQueue(label: "leading.crypto", qos: .userInitiated)

    private func eachWindow(_ f: (DocumentWindowController) -> Void) {
        for wc in windowControllers { if let wc = wc as? DocumentWindowController { f(wc) } }
    }

    /// Open the sealed bytes with a password. `done(false)`: wrong password (or damage).
    func unlock(password: String, done: @escaping (Bool) -> Void) {
        let bytes = sealed
        Self.crypto.async {
            let opened = try? SealedText.open(bytes, password: password)
            DispatchQueue.main.async {
                // Locked again, or replaced from disk, while the key was being derived.
                guard let opened, self.isPasswordLocked, bytes == self.sealed else { return done(false) }
                self.key = opened.key; self.salt = opened.salt; self.rounds = opened.rounds
                self.setText(opened.text)
                self.eachWindow { $0.documentUnlocked() }
                done(true)
            }
        }
    }

    /// Seal what is there, drop the key and the text. Unsaved edits are sealed
    /// first, so even if the save that follows never runs (the Mac sleeps at
    /// once), they wait in memory encrypted and a later save writes them.
    func lock() {
        guard isEncrypted, let key else { return }
        let edited = isDocumentEdited
        if edited { sealed = SealedText.seal(mirror.text, key: key, salt: salt, rounds: rounds) }
        self.key = nil
        setText("")
        eachWindow { $0.documentLocked() }
        if edited { autosave(withImplicitCancellability: false) { _ in } }
    }

    /// The four commands that change encryption are only for a saved file:
    /// an untitled note's autosaves live elsewhere and could leave plain copies.
    var canEncrypt: Bool { fileURL != nil && !isEncrypted && !isGuide }

    /// The Leading Guide's own copy. It is reference, so its source cannot be
    /// edited; highlighting and ticking tasks still write to it, as marking up a
    /// manual should. File › Duplicate gives a copy that edits normally.
    var isGuide: Bool {
        guard let url = fileURL, let guide = FirstRun.guideURL else { return false }
        return url.resolvingSymlinksInPath().standardizedFileURL == guide.resolvingSymlinksInPath().standardizedFileURL
    }

    /// Encrypt a plain note. Once the sealed file is saved, the plain versions
    /// macOS kept for File › Revert To are removed, or they would stay readable.
    func encrypt(password: String, done: @escaping (Error?) -> Void) {
        let newSalt = SealedText.newSalt()
        Self.crypto.async {
            let newKey = SealedText.deriveKey(password: password, salt: newSalt)
            DispatchQueue.main.async {
                guard self.canEncrypt else { return done(nil) }
                self.isEncrypted = true
                self.key = newKey; self.salt = newSalt; self.rounds = SealedText.defaultRounds
                self.saveSealed { error in
                    if error != nil { self.isEncrypted = false; self.key = nil; self.sealed = Data() }
                    done(error)
                }
            }
        }
    }

    /// Check the current password against the key we hold (same salt, same key).
    private func check(_ password: String, then: @escaping (Bool) -> Void) {
        let (s, r, k) = (salt, rounds, key)
        Self.crypto.async {
            let ok = k.map { SealedText.deriveKey(password: password, salt: s, rounds: r) == $0 } ?? false
            DispatchQueue.main.async { then(ok) }
        }
    }

    enum PasswordError: LocalizedError {
        case wrong
        var errorDescription: String? { "That is not this note’s password." }
    }

    func changePassword(current: String, new: String, done: @escaping (Error?) -> Void) {
        check(current) { ok in
            guard ok else { return done(PasswordError.wrong) }
            let newSalt = SealedText.newSalt()
            Self.crypto.async {
                let newKey = SealedText.deriveKey(password: new, salt: newSalt)
                DispatchQueue.main.async {
                    guard !self.isPasswordLocked, self.isEncrypted else { return done(nil) }
                    let old = (self.key, self.salt, self.rounds)
                    self.key = newKey; self.salt = newSalt; self.rounds = SealedText.defaultRounds
                    // Earlier versions need the old password; a reader who changes it
                    // usually means the old one should open nothing.
                    self.saveSealed { error in
                        if error != nil { (self.key, self.salt, self.rounds) = old }
                        done(error)
                    }
                }
            }
        }
    }

    /// Write the note back as plain Markdown (UTF-8). Its encrypted versions stay in
    /// File › Revert To, still needing the password.
    func removeEncryption(password: String, done: @escaping (Error?) -> Void) {
        check(password) { ok in
            guard ok else { return done(PasswordError.wrong) }
            guard !self.isPasswordLocked, self.isEncrypted, let url = self.fileURL, let type = self.fileType else { return done(nil) }
            let old = (self.key, self.sealed)
            self.isEncrypted = false; self.key = nil; self.sealed = Data()
            self.file = TextFile(text: self.mirror.text)
            self.save(to: url, ofType: type, for: .saveOperation) { error in
                if let error {
                    self.isEncrypted = true; (self.key, self.sealed) = old
                    return done(error)
                }
                done(nil)
            }
        }
    }

    private func saveSealed(done: @escaping (Error?) -> Void) {
        guard let url = fileURL, let type = fileType else { return done(nil) }
        save(to: url, ofType: type, for: .saveOperation) { error in
            done(error)
            // macOS keeps the file as it was before this save in File › Revert To, and
            // records it a moment after the save completes, not during it. Look again shortly.
            if error == nil { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.purgeVersions() } }
        }
    }

    /// Every save of an encrypted note is followed by a sweep of File › Revert To:
    /// a version that is not sealed, or that the current key cannot open (sealed under
    /// an old password), is removed. Versions under the current password are kept.
    override func save(to url: URL, ofType typeName: String, for op: NSDocument.SaveOperationType, completionHandler: @escaping (Error?) -> Void) {
        super.save(to: url, ofType: typeName, for: op) { error in
            completionHandler(error)
            if error == nil { self.purgeVersions() }
        }
    }

    private func purgeVersions() {
        guard isEncrypted, let key, let url = fileURL else { return }
        Self.crypto.async {
            for v in NSFileVersion.otherVersionsOfItem(at: url) ?? [] {
                guard let data = try? Data(contentsOf: v.url), SealedText.isSealed(data), (try? SealedText.open(data, key: key)) != nil else {
                    do { try v.remove() } catch { NSLog("Leading: could not remove a version of %@: %@", url.lastPathComponent, error.localizedDescription) }
                    continue
                }
            }
        }
    }

    // MARK: Versions

    override func revert(toContentsOf url: URL, ofType typeName: String) throws {
        let wasUnlocked = isEncrypted && !isPasswordLocked
        try super.revert(toContentsOf: url, ofType: typeName)
        if isPasswordLocked {
            // An older version under another password (or an encrypted one restored over plain text).
            for wc in windowControllers { (wc as? DocumentWindowController)?.documentLocked() }
            return
        }
        if !isEncrypted && wasUnlocked { NSLog("Leading: %@ was restored to a version without encryption", displayName) }
        // The restored text replaces the editor's text and its undo history.
        for wc in windowControllers { (wc as? DocumentWindowController)?.sendDocument(keepPlace: true, fromDisk: true) }
    }

    // MARK: Changes on disk

    override func presentedItemDidChange() {
        super.presentedItemDidChange()
        DispatchQueue.main.async { self.reloadFromDisk() }
    }

    /// Another app saved the file (or Obsidian synced it). Show the new text
    /// without losing the reader's place. If there are edits not yet saved,
    /// ask which version to keep rather than silently dropping either.
    func reloadFromDisk() {
        guard let url = fileURL else { return }
        var coordError: NSError?
        var newData: Data?
        NSFileCoordinator(filePresenter: self).coordinate(readingItemAt: url, options: [], error: &coordError) { u in
            newData = try? Data(contentsOf: u)
        }
        guard let data = newData else { return }
        if isEncrypted || SealedText.isSealed(data) {
            guard data != sealed else { return } // our own save
            return sealedChangedOnDisk(data)
        }
        let updated = TextFile.decode(data)
        // Our own save (reported late, perhaps after more typing), or nothing new.
        guard updated.text != diskText, updated.text != mirror.text else { diskText = updated.text; return }
        if isDocumentEdited {
            askAboutConflict(disk: updated)
        } else {
            useDiskVersion(updated)
        }
    }

    /// An encrypted note (or one that became encrypted, or stopped being) was
    /// changed by another app: Obsidian Sync bringing an edit from another Mac, say.
    private func sealedChangedOnDisk(_ data: Data) {
        guard SealedText.isSealed(data) else {
            // Encryption was removed elsewhere. Locked, we have nothing to lose; unlocked, our
            // edits (if any) go through the usual question, against the now-plain text.
            let wasLocked = isPasswordLocked
            isEncrypted = false; key = nil; sealed = Data()
            if wasLocked {
                setText("")
                useDiskVersion(TextFile.decode(data))
                for wc in windowControllers { (wc as? DocumentWindowController)?.documentUnlocked() }
            } else if isDocumentEdited {
                askAboutConflict(disk: TextFile.decode(data))
            } else {
                useDiskVersion(TextFile.decode(data))
            }
            return
        }
        // Locked with edits sealed but not yet written: they are newer than anything
        // on disk (this is usually our own earlier save, reported late). Let the save land.
        if isPasswordLocked && isDocumentEdited { return }
        if isPasswordLocked || !isEncrypted {
            // Locked: keep the new bytes for when the password comes. Plain until now
            // (encrypted elsewhere): drop the text and lock.
            let wasPlain = !isEncrypted
            isEncrypted = true; key = nil; sealed = data
            setText("")
            fileModificationDate = (try? fileURL?.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            updateChangeCount(.changeCleared)
            if wasPlain { for wc in windowControllers { (wc as? DocumentWindowController)?.documentLocked() } }
            return
        }
        guard let key, let text = try? SealedText.open(data, key: key) else {
            // Sealed under a different password now (changed on another Mac). Keep our
            // edits, sealed as they were, in the version history, then lock on theirs.
            NSLog("Leading: %@ was re-encrypted elsewhere with another password; locking", displayName)
            if isDocumentEdited, let url = fileURL, let ours = try? self.data(ofType: fileType ?? "net.daringfireball.markdown") {
                keepInVersions(ours, for: url)
            }
            self.key = nil; sealed = data
            setText("")
            fileModificationDate = (try? fileURL?.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            updateChangeCount(.changeCleared)
            for wc in windowControllers { (wc as? DocumentWindowController)?.documentLocked() }
            return
        }
        // Same password: treat the text as any other change on disk. Their salt may
        // differ only if the password was re-set to the same one; take it with the file.
        if let p = try? SealedText.parameters(data) { salt = p.salt; rounds = p.rounds }
        sealed = data
        guard text != diskText, text != mirror.text else { diskText = text; return }
        if isDocumentEdited { askAboutConflict(disk: TextFile(text: text)) } else { useDiskVersion(TextFile(text: text)) }
    }

    private func keepInVersions(_ data: Data, for url: URL) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent)
        if (try? data.write(to: tmp)) != nil {
            _ = try? NSFileVersion.addOfItem(at: url, withContentsOf: tmp, options: [])
            try? FileManager.default.removeItem(at: tmp)
        }
    }

    private func useDiskVersion(_ updated: TextFile) {
        file = updated
        mirror = TextMirror(updated.text)
        diskText = updated.text
        NSLog("Leading: %@ changed on disk; showing the new version", displayName)
        fileModificationDate = (try? fileURL?.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        updateChangeCount(.changeCleared)
        for wc in windowControllers { (wc as? DocumentWindowController)?.sendDocument(keepPlace: true, fromDisk: true) }
    }

    private var askingAboutConflict = false

    private func askAboutConflict(disk: TextFile) {
        guard !askingAboutConflict, let window = windowControllers.first?.window else { return }
        askingAboutConflict = true
        let alert = NSAlert()
        alert.messageText = "“\(displayName ?? "This document")” was changed by another app."
        alert.informativeText = "You have edits here that aren’t saved yet. Which version do you want to keep? The other is still available in File › Revert To › Browse All Versions."
        alert.addButton(withTitle: "Keep My Edits")
        alert.addButton(withTitle: "Use the Other Version")
        alert.beginSheetModal(for: window) { response in
            self.askingAboutConflict = false
            guard let url = self.fileURL else { return }
            if response == .alertFirstButtonReturn {
                // Keep the other app's text in the version history, then save ours over it.
                _ = try? NSFileVersion.addOfItem(at: url, withContentsOf: url, options: [])
                self.fileModificationDate = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
                self.save(nil)
            } else {
                // Keep our unsaved edits in the version history, then show theirs.
                // For an encrypted note these bytes are sealed, so no plain text reaches the history.
                if let ours = try? self.data(ofType: self.fileType ?? "net.daringfireball.markdown") {
                    self.keepInVersions(ours, for: url)
                }
                self.useDiskVersion(disk)
            }
        }
    }
}
