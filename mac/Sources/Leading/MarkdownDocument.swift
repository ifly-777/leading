import AppKit
import LeadingCore

/// One open Markdown or text file. Stage 2 is a viewer: the file is read,
/// shown and re-read when it changes on disk, but never written.
@objc(MarkdownDocument)
final class MarkdownDocument: NSDocument {
    private(set) var file = TextFile(text: "")
    /// Show the file as written rather than as Markdown (for this session only;
    /// remembering it would mean writing metadata into the user's files).
    var showsPlainText = false
    let openedAt = Date()

    override class var autosavesInPlace: Bool { false }
    override class func canConcurrentlyReadDocuments(ofType typeName: String) -> Bool { true }

    override func read(from data: Data, ofType typeName: String) throws {
        file = TextFile.decode(data)
    }

    override func data(ofType typeName: String) throws -> Data {
        // Never reached in Stage 2 (nothing is edited); refuse rather than risk a write.
        throw NSError(domain: NSCocoaErrorDomain, code: NSFeatureUnsupportedError)
    }

    override func makeWindowControllers() {
        addWindowController(DocumentWindowController(document: self))
    }

    // MARK: Changes on disk

    override func presentedItemDidChange() {
        super.presentedItemDidChange()
        DispatchQueue.main.async { self.reloadFromDisk() }
    }

    /// Re-read the file (another app saved it, or Obsidian synced it) and show
    /// the new text without losing the reader's place. Nothing to lose here:
    /// a viewer has no unsaved edits.
    func reloadFromDisk() {
        guard let url = fileURL else { return }
        var coordError: NSError?
        var newData: Data?
        NSFileCoordinator(filePresenter: self).coordinate(readingItemAt: url, options: [], error: &coordError) { u in
            newData = try? Data(contentsOf: u)
        }
        guard let data = newData else { return }
        let updated = TextFile.decode(data)
        guard updated != file else { return }
        file = updated
        NSLog("Leading: %@ changed on disk; showing the new version", url.lastPathComponent)
        fileModificationDate = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        for wc in windowControllers { (wc as? DocumentWindowController)?.sendDocument(keepPlace: true) }
    }
}
