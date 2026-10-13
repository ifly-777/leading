import AppKit

/// LEADING_SELFTEST=1: after the first document paints, send the View and
/// Find menu commands through the normal responder chain, then ask the page
/// and the settings store what changed, print a report and quit. Lets
/// scripts check the menu → window → page → settings wiring without a screen.
enum SelfTest {
    static var enabled: Bool { ProcessInfo.processInfo.environment["LEADING_SELFTEST"] == "1" }
    private static var ran = false

    static func run(in window: NSWindow, page: ReaderWebView) {
        guard enabled, !ran else { return }
        ran = true
        let store = SettingsStore.shared
        let before = store.settings
        var results: [String] = []
        func check(_ name: String, _ ok: Bool) { results.append("\(ok ? "PASS" : "FAIL")  \(name)") }
        // Walk this window's responder chain (page → window → window controller),
        // as a menu command does once it reaches the window. (An untargeted
        // NSApp.sendAction needs a key window, which a locked screen cannot have.)
        func send(_ action: String) {
            let sel = Selector(action + ":")
            let start: NSResponder = window.firstResponder ?? window
            if !start.tryToPerform(sel, with: nil) { results.append("FAIL  \(action) reached nothing") }
        }
        window.makeKeyAndOrderFront(nil)

        // Each step: send a menu command, give the page a moment, then look.
        let steps: [(String, () -> Void)] = [
            ("leadingToggleOutline", { check("Show Outline turns the outline on and saves it", store.settings.outlineOpen != before.outlineOpen) }),
            ("leadingBigger", { check("Bigger raises the size by 1 px", store.settings.size == before.size + 1) }),
            ("leadingNarrower", { check("Narrower Column steps the line width down", store.settings.measure != before.measure || before.measure == "narrow") }),
            ("leadingCycleTheme", { check("Next Theme changes the theme", store.settings.theme != before.theme) }),
            ("leadingFind", {}),
        ]
        func step(_ i: Int) {
            guard i < steps.count else { return inspectPage() }
            send(steps[i].0)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { steps[i].1(); step(i + 1) }
        }
        func inspectPage() {
            let js = """
            return { findOpen: !document.querySelector('.findbar').hidden,
                     outlineShown: !document.getElementById('outline').hidden,
                     outlineItems: document.querySelectorAll('#outline a').length,
                     fontSize: getComputedStyle(document.getElementById('doc')).fontSize,
                     theme: document.documentElement.dataset.theme }
            """
            page.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
                if case .success(let value) = result, let v = value as? [String: Any] {
                    check("⌘F opens the page's find bar", v["findOpen"] as? Bool == true)
                    // Whichever way the toggle went, the page must match the saved setting.
                    let shown = v["outlineShown"] as? Bool == true
                    check("The outline is \(store.settings.outlineOpen ? "shown" : "hidden"), as saved (\(v["outlineItems"] ?? 0) headings)",
                          shown == store.settings.outlineOpen && (v["outlineItems"] as? Int ?? 0) > 3)
                    check("The page uses the new size (\(v["fontSize"] ?? "?"))", v["fontSize"] as? String == "\(Int(store.settings.size))px")
                    // "system" resolves to light or dark; otherwise the page must show exactly the chosen theme.
                    let t = store.settings.theme
                    check("The page shows the chosen theme (\(t) → \(v["theme"] ?? "?"))", t == "system" ? ["light", "dark"].contains(v["theme"] as? String ?? "") : (v["theme"] as? String) == t)
                } else {
                    check("Page answered", false)
                }
                extraChecks(window: window, page: page, check: check) {
                    // Leave the reader's settings as they were.
                    store.settings = before
                    print("Leading self-test\n" + results.joined(separator: "\n"))
                    fflush(stdout)
                    NSApp.terminate(nil)
                }
            }
        }
        step(0)
    }

    /// Settings reach every window; the file reloads when changed on disk;
    /// the plain-text toggle shows the file as written.
    private static func extraChecks(window: NSWindow, page: ReaderWebView, check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        let pages = NSApp.windows.compactMap { ($0.windowController as? DocumentWindowController)?.pageForTests }
        let size = "\(Int(SettingsStore.shared.settings.size))px"
        let group = DispatchGroup()
        var sizes: [String] = []
        for p in pages {
            group.enter()
            p.callAsyncJavaScript("return getComputedStyle(document.getElementById('doc')).fontSize", arguments: [:], in: nil, in: .page) { r in
                if case .success(let v) = r, let v = v as? String { sizes.append(v) }
                group.leave()
            }
        }
        group.notify(queue: .main) {
            check("All \(pages.count) open windows use the new size (\(sizes.joined(separator: ", ")))", pages.count >= 2 && sizes.count == pages.count && sizes.allSatisfy { $0 == size })
            // Reload: another app appends a marked line to the file.
            guard let doc = window.windowController?.document as? MarkdownDocument, let url = doc.fileURL else { check("Reload test has a file", false); return done() }
            let marker = "Selftest marker \(Int.random(in: 1000...9999))"
            if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data("\n\n\(marker)\n".utf8)); try? h.close() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                page.callAsyncJavaScript("return document.getElementById('doc').textContent.includes(m)", arguments: ["m": marker], in: nil, in: .page) { r in
                    check("The page shows text another app added to the file", (try? r.get()) as? Bool == true)
                    NSApp.sendAction(#selector(ReaderActions.leadingTogglePlainText(_:)), to: window.windowController, from: nil)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        page.callAsyncJavaScript("const p = document.querySelector('#doc pre.plain'); return !!p && p.textContent.startsWith('# ') && !document.querySelector('#doc h1')", arguments: [:], in: nil, in: .page) { r in
                            check("Show as Plain Text shows the raw Markdown, unrendered", (try? r.get()) as? Bool == true)
                            NSApp.sendAction(#selector(ReaderActions.leadingTogglePlainText(_:)), to: window.windowController, from: nil)
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { editingChecks(window: window, page: page, doc: doc, check: check, done: done) }
                        }
                    }
                }
            }
        }
    }

    /// Edit mode end to end: type, format, save, undo, back to reading.
    private static func editingChecks(window: NSWindow, page: ReaderWebView, doc: MarkdownDocument, check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        let wc = window.windowController
        func js(_ code: String, _ then: @escaping (Any?) -> Void) {
            page.callAsyncJavaScript(code, arguments: [:], in: nil, in: .page) { r in then(try? r.get()) }
        }
        func later(_ s: Double, _ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: f) }
        NSApp.sendAction(#selector(ReaderActions.leadingToggleEdit(_:)), to: wc, from: nil)
        later(0.8) {
            js("return !document.getElementById('editor').hidden && !!document.querySelector('#editor .cm-content')") { v in
                check("Edit Source (⌘E) shows the source editor", v as? Bool == true)
                // Type at the start, as a person would, through the editor.
                js("const v = window.leading.view.editor.view; v.dispatch({ changes: { from: 0, insert: 'Selftest typed here. ' }, userEvent: 'input.type' }); return true") { _ in
                    later(1.4) { // past the 0.8 s pause that triggers the fingerprint check
                        js("return window.leading.text()") { t in
                            let pageText = t as? String ?? ""
                            check("Swift's copy matches the editor after typing", doc.text == pageText && pageText.hasPrefix("Selftest typed here. "))
                            // Bold the word "Selftest" with the Format menu command.
                            js("window.leading.view.editor.view.dispatch({ selection: { anchor: 0, head: 8 } }); return true") { _ in
                                NSApp.sendAction(#selector(ReaderActions.leadingBold(_:)), to: wc, from: nil)
                                later(0.4) {
                                    check("Format › Bold wraps the selection in **", doc.text.hasPrefix("**Selftest** typed here. "))
                                    // Save, then read the file back from disk.
                                    doc.save(withDelegate: nil, didSave: nil, contextInfo: nil)
                                    later(1.0) {
                                        let onDisk = (try? String(contentsOf: doc.fileURL!, encoding: .utf8)) ?? ""
                                        check("Saving writes exactly the edited text to the file", onDisk == doc.text)
                                        NSApp.sendAction(#selector(ReaderActions.leadingUndo(_:)), to: wc, from: nil)
                                        later(0.5) {
                                            check("Undo removes the bold, in the editor and Swift's copy", doc.text.hasPrefix("Selftest typed here. "))
                                            NSApp.sendAction(#selector(ReaderActions.leadingToggleEdit(_:)), to: wc, from: nil)
                                            later(1.2) {
                                                js("return document.getElementById('editor').hidden && document.getElementById('doc').textContent.includes('Selftest typed here.')") { v in
                                                    check("Back in reading mode, the page shows the edited text", v as? Bool == true)
                                                    highlightChecks(window: window, page: page, doc: doc, check: check) {
                                                        conflictCheck(window: window, page: page, doc: doc, check: check, done: done)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// Reading mode: select a word, Format › Green Highlight writes Highlightr's
    /// mark into Swift's copy, and Undo takes it off again.
    private static func highlightChecks(window: NSWindow, page: ReaderWebView, doc: MarkdownDocument, check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        let wc = window.windowController
        let green = "<mark style=\"background: #BBFABBA6;\">typed</mark>"
        // Select the word "typed" on the page, as a drag with the mouse would.
        let select = """
        const w = document.createTreeWalker(document.getElementById('doc'), NodeFilter.SHOW_TEXT);
        while (w.nextNode()) { const t = w.currentNode; const i = t.data.indexOf('typed');
          if (i >= 0) { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 5);
            const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true } }
        return false
        """
        page.callAsyncJavaScript(select, arguments: [:], in: nil, in: .page) { r in
            check("The page selects a word to highlight", (try? r.get()) as? Bool == true)
            NSApp.sendAction(#selector(ReaderActions.leadingHighlightGreen(_:)), to: wc, from: nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                check("Green Highlight (⌥⌘2) while reading writes Highlightr's mark", doc.text.contains(green))
                let item = NSMenuItem(title: "", action: #selector(ReaderActions.leadingHighlight(_:)), keyEquivalent: "")
                _ = (wc as? NSMenuItemValidation)?.validateMenuItem(item)
                check("Highlight (⇧⌘H) now names the last colour (\(item.title))", item.title == "Highlight (Green)")
                NSApp.sendAction(#selector(ReaderActions.leadingUndo(_:)), to: wc, from: nil)
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    check("Undo while reading takes the highlight off", !doc.text.contains("<mark") && doc.text.contains("Selftest typed here."))
                    done()
                }
            }
        }
    }

    /// Another app changes the file while there are unsaved edits: Leading asks,
    /// "Keep My Edits" saves ours, and theirs goes into the version history.
    private static func conflictCheck(window: NSWindow, page: ReaderWebView, doc: MarkdownDocument, check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        guard let url = doc.fileURL else { return done() }
        let theirs = "Written by another app \(Int.random(in: 1000...9999))"
        let before = NSFileVersion.otherVersionsOfItem(at: url)?.count ?? 0
        // An edit of ours that is not saved yet…
        page.callAsyncJavaScript("const v = window.leading.view.editor.view; v.dispatch({ changes: { from: v.state.doc.length, insert: '\\nMy unsaved line.\\n' } }); return true", arguments: [:], in: nil, in: .page) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                // …and at the same moment another app rewrites the file.
                try? (theirs + "\n").write(to: url, atomically: true, encoding: .utf8)
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    let sheet = window.attachedSheet
                    check("Leading asks which version to keep", sheet != nil)
                    let keep = sheet.flatMap { s in Self.button(in: s.contentView, titled: "Keep My Edits") }
                    keep?.performClick(nil)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        let onDisk = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
                        check("Keep My Edits saves our text over theirs", onDisk.contains("My unsaved line.") && !onDisk.contains(theirs))
                        let versions = NSFileVersion.otherVersionsOfItem(at: url) ?? []
                        let saved = versions.contains { v in ((try? String(contentsOf: v.url, encoding: .utf8)) ?? "").contains(theirs) }
                        check("…and their text is kept in the version history (\(before) → \(versions.count) versions)", saved)
                        done()
                    }
                }
            }
        }
    }

    private static func button(in view: NSView?, titled title: String) -> NSButton? {
        guard let view else { return nil }
        if let b = view as? NSButton, b.title == title { return b }
        for v in view.subviews { if let b = button(in: v, titled: title) { return b } }
        return nil
    }
}
