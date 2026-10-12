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
            .separator(),
            item("Hide \(name)", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit \(name)", #selector(NSApplication.terminate(_:)), "q"),
        ])

        let recent = NSMenu(title: "Open Recent")
        // AppKit fills this submenu itself once it sees the Clear Menu action in it.
        recent.addItem(item("Clear Menu", #selector(NSDocumentController.clearRecentDocuments(_:))))
        let recentItem = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
        recentItem.submenu = recent
        bar.addSubmenu("File", [
            item("Open…", #selector(NSDocumentController.openDocument(_:)), "o"),
            recentItem,
            .separator(),
            item("Close", #selector(NSWindow.performClose(_:)), "w"),
        ])

        let find = NSMenu(title: "Find")
        find.items = [
            item("Find…", #selector(ReaderActions.leadingFind(_:)), "f"),
            item("Find Next", #selector(ReaderActions.leadingFindNext(_:)), "g"),
            item("Find Previous", #selector(ReaderActions.leadingFindPrevious(_:)), "g", [.command, .shift]),
        ]
        let findItem = NSMenuItem(title: "Find", action: nil, keyEquivalent: "")
        findItem.submenu = find
        bar.addSubmenu("Edit", [
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
            .separator(),
            findItem,
        ])

        let bigger = item("Bigger", #selector(ReaderActions.leadingBigger(_:)), "+")
        // ⌘= is the same physical key as ⌘+ on most layouts; accept both.
        let biggerAlias = item("Bigger", #selector(ReaderActions.leadingBigger(_:)), "=")
        biggerAlias.isHidden = true
        biggerAlias.allowsKeyEquivalentWhenHidden = true
        bar.addSubmenu("View", [
            item("Show Outline", #selector(ReaderActions.leadingToggleOutline(_:)), "o", [.command, .option]),
            .separator(),
            bigger, biggerAlias,
            item("Smaller", #selector(ReaderActions.leadingSmaller(_:)), "-"),
            item("Actual Size", #selector(ReaderActions.leadingActualSize(_:)), "0"),
            item("Narrower Column", #selector(ReaderActions.leadingNarrower(_:)), "[", [.command, .option]),
            item("Wider Column", #selector(ReaderActions.leadingWider(_:)), "]", [.command, .option]),
            item("Next Theme", #selector(ReaderActions.leadingCycleTheme(_:)), "t", [.command, .option]),
            .separator(),
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
        let helpItem = NSMenuItem(title: "Help", action: nil, keyEquivalent: "")
        helpItem.submenu = help
        bar.addItem(helpItem)
        NSApp.helpMenu = help
        return bar
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
}
