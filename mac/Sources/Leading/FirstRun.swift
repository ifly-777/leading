import AppKit
import UniformTypeIdentifiers

/// The first launch: the welcome document, and two questions asked once
/// (open Markdown files with Leading? check for updates?). Both answers can be
/// changed later in Settings.
enum FirstRun {
    private static let doneKey = "firstRunDone"
    /// Self-tests and the update spike never ask. A spike build is also marked
    /// in its Info.plist, because the copy Sparkle relaunches after an update
    /// has none of the test's environment variables.
    private static var testing: Bool {
        let env = ProcessInfo.processInfo.environment
        return SelfTest.enabled || Snapshot.enabled || env["LEADING_SPIKE_UPDATE"] == "1"
            || Bundle.main.object(forInfoDictionaryKey: "LeadingTestBuild") as? Bool == true
    }

    /// Nothing has been asked yet on this Mac (for this user).
    static var isFirst: Bool { !testing && !UserDefaults.standard.bool(forKey: doneKey) }

    // MARK: The welcome document

    /// The welcome document is a copy in Application Support rather than the
    /// file inside the app: highlighting or editing writes to the file, and
    /// writing inside the app would break its signature. The copy is the
    /// reader's own to try things on; it is only replaced if it has gone.
    static func openWelcome() { openCopy(of: "Welcome to Leading", refreshPerVersion: false) }

    /// The guide is a copy for the same reason, but a manual must match the app
    /// it describes, so each new version replaces it. Highlights made on the old
    /// copy go with it; that is the price of never showing stale instructions.
    static func openGuide() { openCopy(of: "Leading Guide", refreshPerVersion: true) }

    /// Where the guide's copy lives. A document at this address opens without
    /// source editing (see MarkdownDocument.isGuide).
    static var guideURL: URL? { copiesFolder?.appendingPathComponent("Leading Guide.md") }

    private static var copiesFolder: URL? {
        try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Leading", isDirectory: true)
    }

    private static func openCopy(of name: String, refreshPerVersion: Bool) {
        guard let bundled = Bundle.main.url(forResource: name, withExtension: "md") else { return }
        let fm = FileManager.default
        guard let folder = copiesFolder else { return }
        let copy = folder.appendingPathComponent(bundled.lastPathComponent)
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let versionKey = "copyVersion." + name
        // Never swap the file out from under an open window; the next open after
        // it closes picks up the new copy.
        let stale = refreshPerVersion && UserDefaults.standard.string(forKey: versionKey) != version
            && NSDocumentController.shared.document(for: copy) == nil
        if stale { try? fm.removeItem(at: copy) }
        if !fm.fileExists(atPath: copy.path) {
            try? fm.createDirectory(at: folder, withIntermediateDirectories: true)
            if (try? fm.copyItem(at: bundled, to: copy)) != nil, refreshPerVersion {
                UserDefaults.standard.set(version, forKey: versionKey)
            }
        }
        NSDocumentController.shared.openDocument(withContentsOf: copy, display: true) { _, _, error in
            if let error { NSLog("Leading: could not open %@: %@", name, String(describing: error)) }
        }
    }

    // MARK: The two questions

    /// Asked once, a moment after launch, over the front document window.
    static func ask() {
        guard isFirst else { return }
        let window = NSApp.orderedWindows.first { $0.windowController is DocumentWindowController }

        // Run from the disk image (or from wherever macOS moved a quarantined
        // app to): offering to make this copy the default would point Markdown
        // files at something about to vanish, and Sparkle cannot update it.
        // Say so, and ask the questions next time, from Applications.
        if AppLocation.isTemporary {
            let alert = NSAlert()
            alert.messageText = "Move Leading to Applications"
            alert.informativeText = "Leading is running from the disk image. Quit it, drag Leading into the Applications folder, eject the disk image, then open Leading from Applications."
            alert.addButton(withTitle: "OK")
            present(alert, over: window) { _ in }
            return
        }

        let alert = NSAlert()
        alert.messageText = "Welcome to Leading"
        alert.informativeText = "Two quick choices. You can change either later in Leading › Settings."
        alert.addButton(withTitle: "Continue")

        let makeDefault = NSButton(checkboxWithTitle: "Open Markdown files with Leading", target: nil, action: nil)
        makeDefault.state = .on
        let updates = NSButton(checkboxWithTitle: "Check for updates automatically", target: nil, action: nil)
        updates.state = .off
        let note = NSTextField(wrappingLabelWithString: "Once a day, Leading would ask GitHub whether a newer version exists. It is the only time Leading uses the network, and nothing about you or your files is sent.")
        note.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        note.textColor = .secondaryLabelColor
        note.preferredMaxLayoutWidth = 260

        var rows: [NSView] = []
        // Already the default (another copy of Leading, or an earlier yes): nothing to ask.
        if !MarkdownDefault.isLeading { rows.append(makeDefault) }
        rows += [updates, note]
        let stack = NSStackView(views: rows)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.setCustomSpacing(4, after: updates)
        stack.frame.size = stack.fittingSize
        alert.accessoryView = stack

        present(alert, over: window) { _ in
            UserDefaults.standard.set(true, forKey: doneKey)
            if rows.contains(makeDefault), makeDefault.state == .on { MarkdownDefault.make() }
            Updates.shared.setOptedIn(updates.state == .on)
        }
    }

    private static func present(_ alert: NSAlert, over window: NSWindow?, then done: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window { alert.beginSheetModal(for: window, completionHandler: done) }
        else { done(alert.runModal()) }
    }
}

/// Whether Markdown files open in this copy of Leading, and making it so.
enum MarkdownDefault {
    static let type = UTType("net.daringfireball.markdown")!

    static var isLeading: Bool {
        guard let app = NSWorkspace.shared.urlForApplication(toOpen: type) else { return false }
        return app.resolvingSymlinksInPath().standardizedFileURL == Bundle.main.bundleURL.resolvingSymlinksInPath().standardizedFileURL
    }

    /// macOS records the choice at once; `done` runs on the main thread.
    static func make(done: @escaping () -> Void = {}) {
        NSWorkspace.shared.setDefaultApplication(at: Bundle.main.bundleURL, toOpen: type) { error in
            if let error { NSLog("Leading: could not become the default for Markdown: %@", String(describing: error)) }
            DispatchQueue.main.async(execute: done)
        }
    }
}

enum AppLocation {
    /// Running from a read-only disk image, or from the random folder macOS
    /// uses for a quarantined app that was opened before being moved.
    static var isTemporary: Bool {
        let url = Bundle.main.bundleURL
        if url.path.contains("/AppTranslocation/") { return true }
        return (try? url.resourceValues(forKeys: [.volumeIsReadOnlyKey]))?.volumeIsReadOnly ?? false
    }
}
