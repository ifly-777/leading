import AppKit

/// The menu bar. Every shortcut lives here, so it is discoverable and works the
/// same whichever part of the window has focus; actions travel up the
/// responder chain to the window controller, which forwards them to the page.
enum MainMenu {
    static func build() -> NSMenu {
        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Leading"
        let bar = NSMenu()

        bar.addSubmenu(name, [
            item("About \(name)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            updatesItem(),
            .separator(),
            item("Settings…", #selector(AppDelegate.showSettings(_:)), ","),
            .separator(),
            item("Hide \(name)", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit \(name)", #selector(NSApplication.terminate(_:)), "q"),
        ])

        bar.addSubmenu("File", [
            // macOS adds Open Recent (and Close All, Share) to a document app's File menu itself.
            item("New", #selector(NSDocumentController.newDocument(_:)), "n"),
            item("Open…", #selector(NSDocumentController.openDocument(_:)), "o"),
            .separator(),
            item("Close", #selector(NSWindow.performClose(_:)), "w"),
            item("Save", #selector(NSDocument.save(_:)), "s"),
            item("Duplicate", #selector(NSDocument.duplicate(_:)), "s", [.command, .shift]),
            item("Rename…", #selector(NSDocument.rename(_:))),
            item("Move To…", #selector(NSDocument.move(_:))),
            // With autosave, AppKit turns this into the Revert To submenu (Last Opened, Browse All Versions…).
            item("Revert To Saved", #selector(NSDocument.revertToSaved(_:))),
        ])

        let find = NSMenu(title: "Find")
        find.items = [
            item("Find…", #selector(ReaderActions.leadingFind(_:)), "f"),
            item("Find and Replace…", #selector(ReaderActions.leadingFindReplace(_:)), "f", [.command, .option]),
            item("Find Next", #selector(ReaderActions.leadingFindNext(_:)), "g"),
            item("Find Previous", #selector(ReaderActions.leadingFindPrevious(_:)), "g", [.command, .shift]),
        ]
        let findItem = NSMenuItem(title: "Find", action: nil, keyEquivalent: "")
        findItem.submenu = find
        bar.addSubmenu("Edit", [
            // The page's editor keeps the one undo history (it includes highlights in Stage 4).
            item("Undo", #selector(ReaderActions.leadingUndo(_:)), "z"),
            item("Redo", #selector(ReaderActions.leadingRedo(_:)), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
            .separator(),
            findItem,
        ])

        let bigger = item("Bigger", #selector(ReaderActions.leadingBigger(_:)), "+")
        // ⌘= is the same physical key as ⌘+ on most layouts; accept both.
        let biggerAlias = item("Bigger", #selector(ReaderActions.leadingBigger(_:)), "=")
        biggerAlias.isHidden = true
        biggerAlias.allowsKeyEquivalentWhenHidden = true
        bar.addSubmenu("Format", [
            item("Bold", #selector(ReaderActions.leadingBold(_:)), "b"),
            item("Italic", #selector(ReaderActions.leadingItalic(_:)), "i"),
            item("Underline", #selector(ReaderActions.leadingUnderline(_:)), "u"),
            item("Strikethrough", #selector(ReaderActions.leadingStrike(_:)), "x", [.command, .shift]),
            item("Code", #selector(ReaderActions.leadingCode(_:)), "c", [.command, .option]),
            item("Link…", #selector(ReaderActions.leadingLink(_:)), "k"),
            .separator(),
            item("Bulleted List", #selector(ReaderActions.leadingBulletList(_:)), "l"),
            item("Numbered List", #selector(ReaderActions.leadingNumberList(_:)), "l", [.command, .shift]),
            item("Table", #selector(ReaderActions.leadingTable(_:)), "t", [.command, .shift]),
            .separator(),
            // Highlights work while reading too; they are the one change reading mode makes.
            item("Highlight", #selector(ReaderActions.leadingHighlight(_:)), "h", [.command, .shift]),
            item("Yellow Highlight", #selector(ReaderActions.leadingHighlightYellow(_:)), "1", [.command, .option]),
            item("Green Highlight", #selector(ReaderActions.leadingHighlightGreen(_:)), "2", [.command, .option]),
            item("Blue Highlight", #selector(ReaderActions.leadingHighlightBlue(_:)), "3", [.command, .option]),
            item("Pink Highlight", #selector(ReaderActions.leadingHighlightPink(_:)), "4", [.command, .option]),
            item("Orange Highlight", #selector(ReaderActions.leadingHighlightOrange(_:)), "5", [.command, .option]),
            item("Remove Highlight", #selector(ReaderActions.leadingRemoveHighlight(_:)), "0", [.command, .option]),
            .separator(),
            item("Smart Punctuation While Typing", #selector(ReaderActions.leadingToggleSmartTyping(_:))),
        ])
        bar.addSubmenu("View", [
            item("Edit Source", #selector(ReaderActions.leadingToggleEdit(_:)), "e"),
            .separator(),
            item("Show Outline", #selector(ReaderActions.leadingToggleOutline(_:)), "o", [.command, .option]),
            item("Back", #selector(ReaderActions.leadingBack(_:)), "["),
            .separator(),
            bigger, biggerAlias,
            item("Smaller", #selector(ReaderActions.leadingSmaller(_:)), "-"),
            item("Actual Size", #selector(ReaderActions.leadingActualSize(_:)), "0"),
            item("Narrower Column", #selector(ReaderActions.leadingNarrower(_:)), "[", [.command, .option]),
            item("Wider Column", #selector(ReaderActions.leadingWider(_:)), "]", [.command, .option]),
            item("Next Theme", #selector(ReaderActions.leadingCycleTheme(_:)), "t", [.command, .option]),
            .separator(),
            item("Show Reading Progress", #selector(ReaderActions.leadingToggleProgress(_:)), "p", [.command, .option]),
            item("Show as Plain Text", #selector(ReaderActions.leadingTogglePlainText(_:))),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])

        let window = NSMenu(title: "Window")
        window.items = [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))),
        ]
        let windowItem = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        windowItem.submenu = window
        bar.addItem(windowItem)
        NSApp.windowsMenu = window

        let help = NSMenu(title: "Help")
        help.items = [
            item("Welcome to \(name)", #selector(AppDelegate.showWelcome(_:))),
            item("\(name) on GitHub", #selector(AppDelegate.showWebsite(_:))),
        ]
        let helpItem = NSMenuItem(title: "Help", action: nil, keyEquivalent: "")
        helpItem.submenu = help
        bar.addItem(helpItem)
        NSApp.helpMenu = help
        return bar
    }

    /// Sparkle's checker is not in the responder chain, so this item targets it directly.
    private static func updatesItem() -> NSMenuItem {
        let i = item("Check for Updates…", #selector(Updates.checkForUpdates(_:)))
        i.target = Updates.shared
        return i
    }

    private static func item(_ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        if !key.isEmpty { i.keyEquivalentModifierMask = mods }
        return i
    }
}

private extension NSMenu {
    func addSubmenu(_ title: String, _ items: [NSMenuItem]) {
        let m = NSMenu(title: title)
        m.items = items
        let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        i.submenu = m
        addItem(i)
    }
}

/// Selectors for Leading's own commands. Prefixed so WebKit's built-in
/// handlers (it has its own find, zoom and so on) never intercept them.
@objc protocol ReaderActions {
    func leadingFind(_ sender: Any?)
    func leadingFindNext(_ sender: Any?)
    func leadingFindPrevious(_ sender: Any?)
    func leadingToggleOutline(_ sender: Any?)
    func leadingBigger(_ sender: Any?)
    func leadingSmaller(_ sender: Any?)
    func leadingActualSize(_ sender: Any?)
    func leadingNarrower(_ sender: Any?)
    func leadingWider(_ sender: Any?)
    func leadingCycleTheme(_ sender: Any?)
    func leadingTogglePlainText(_ sender: Any?)
    func leadingToggleEdit(_ sender: Any?)
    func leadingFindReplace(_ sender: Any?)
    func leadingUndo(_ sender: Any?)
    func leadingRedo(_ sender: Any?)
    func leadingBold(_ sender: Any?)
    func leadingItalic(_ sender: Any?)
    func leadingUnderline(_ sender: Any?)
    func leadingStrike(_ sender: Any?)
    func leadingCode(_ sender: Any?)
    func leadingLink(_ sender: Any?)
    func leadingBulletList(_ sender: Any?)
    func leadingNumberList(_ sender: Any?)
    func leadingTable(_ sender: Any?)
    func leadingToggleSmartTyping(_ sender: Any?)
    func leadingToggleProgress(_ sender: Any?)
    func leadingBack(_ sender: Any?)
    func leadingHighlight(_ sender: Any?)
    func leadingHighlightYellow(_ sender: Any?)
    func leadingHighlightGreen(_ sender: Any?)
    func leadingHighlightBlue(_ sender: Any?)
    func leadingHighlightPink(_ sender: Any?)
    func leadingHighlightOrange(_ sender: Any?)
    func leadingRemoveHighlight(_ sender: Any?)
}
