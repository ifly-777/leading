import AppKit
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

    override class var autosavesInPlace: Bool { true }

    /// Saved for the first time, renamed or moved: local images are found next to the new place.
    override var fileURL: URL? {
        didSet {
            guard let url = fileURL, url != oldValue else { return }
            for wc in windowControllers { (wc as? DocumentWindowController)?.documentMoved(to: url) }
        }
    }
    override class func canConcurrentlyReadDocuments(ofType typeName: String) -> Bool { true }

    override func read(from data: Data, ofType typeName: String) throws {
        file = TextFile.decode(data)
        mirror = TextMirror(file.text)
    }

    override func data(ofType typeName: String) throws -> Data {
        var out = file
        out.text = mirror.text
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

    // MARK: Versions

    override func revert(toContentsOf url: URL, ofType typeName: String) throws {
        try super.revert(toContentsOf: url, ofType: typeName)
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
        let updated = TextFile.decode(data)
        guard updated.text != mirror.text else { return } // our own save, or nothing new
        if isDocumentEdited {
            askAboutConflict(disk: updated)
        } else {
            useDiskVersion(updated)
        }
    }

    private func useDiskVersion(_ updated: TextFile) {
        file = updated
        mirror = TextMirror(updated.text)
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
                if let ours = try? self.data(ofType: self.fileType ?? "net.daringfireball.markdown") {
                    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent)
                    if (try? ours.write(to: tmp)) != nil {
                        _ = try? NSFileVersion.addOfItem(at: url, withContentsOf: tmp, options: [])
                        try? FileManager.default.removeItem(at: tmp)
                    }
                }
                self.useDiskVersion(disk)
            }
        }
    }
}
