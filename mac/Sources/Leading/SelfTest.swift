import AppKit
import PDFKit

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

        // Each step: send a menu command, then poll the settings store until the
        // check passes or 3 s go by. The page → Swift settings round trip can take
        // well over half a second on a slow machine (GitHub's macOS 14/15 runners),
        // so a fixed wait flakes. Find changes no setting; inspectPage checks it.
        let steps: [(action: String, name: String, ok: () -> Bool)] = [
            ("leadingToggleOutline", "Show Outline turns the outline on and saves it", { store.settings.outlineOpen != before.outlineOpen }),
            ("leadingBigger", "Bigger raises the size by 1 px", { store.settings.size == before.size + 1 }),
            ("leadingNarrower", "Narrower Column steps the line width down", { store.settings.measure != before.measure || before.measure == "narrow" }),
            ("leadingCycleTheme", "Next Theme changes the theme", { store.settings.theme != before.theme }),
        ]
        func step(_ i: Int) {
            guard i < steps.count else {
                send("leadingFind")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: inspectPage)
                return
            }
            send(steps[i].action)
            let deadline = Date().addingTimeInterval(3)
            func poll() {
                let passed = steps[i].ok()
                // Not there yet and still time: look again in 0.1 s.
                if !passed && Date() < deadline {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: poll)
                    return
                }
                check(steps[i].name, passed)
                step(i + 1)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: poll)
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
                                                        ownSaveCheck(window: window, page: page, doc: doc, check: check) {
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

    /// macOS reports Leading's own save as a change, sometimes after more typing.
    /// That late notice must not raise the "changed by another app" question.
    private static func ownSaveCheck(window: NSWindow, page: ReaderWebView, doc: MarkdownDocument, check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        doc.save(withDelegate: nil, didSave: nil, contextInfo: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            page.callAsyncJavaScript("const v = window.leading.view.editor.view; v.dispatch({ changes: { from: v.state.doc.length, insert: ' More typing.' }, userEvent: 'input.type' }); return true", arguments: [:], in: nil, in: .page) { _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    doc.presentedItemDidChange() // the late notice of our own save
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        check("Leading's own save, reported late, does not ask about another app", window.attachedSheet == nil)
                        if let sheet = window.attachedSheet { window.endSheet(sheet) }
                        doc.save(withDelegate: nil, didSave: nil, contextInfo: nil)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: done)
                    }
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
                        newDocumentCheck(check: check, done: done)
                    }
                }
            }
        }
    }

    /// File › New: a blank page in edit mode with the cursor in it; closing it
    /// with text in it brings macOS's "keep this new document?" question.
    private static func newDocumentCheck(check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        let before = Set(NSDocumentController.shared.documents.map { ObjectIdentifier($0) })
        NSDocumentController.shared.newDocument(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            guard let doc = NSDocumentController.shared.documents.first(where: { !before.contains(ObjectIdentifier($0)) }) as? MarkdownDocument,
                  let wc = doc.windowControllers.first as? DocumentWindowController, let window = wc.window else {
                check("File › New opens a window", false); return done()
            }
            let page = wc.pageForTests
            page.callAsyncJavaScript("return document.documentElement.dataset.mode === 'edit' && !!document.activeElement?.closest('.cm-content')", arguments: [:], in: nil, in: .page) { r in
                let firstResponder = (window.firstResponder as? NSView)?.isDescendant(of: page) == true
                check("File › New opens a blank page in edit mode, ready to type", (try? r.get()) as? Bool == true && firstResponder && doc.fileURL == nil)
                page.callAsyncJavaScript("const v = window.leading.view.editor.view; v.dispatch({ changes: { from: 0, insert: 'A new thought.' }, userEvent: 'input.type' }); return true", arguments: [:], in: nil, in: .page) { _ in
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        window.performClose(nil)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                            // macOS's own sheet: name and place, with Delete, Cancel and Save.
                            // Its buttons live in a system process, so the test cancels it and
                            // then discards the document itself.
                            let panel = window.attachedSheet as? NSSavePanel
                            check("Closing it with text in it asks whether to keep it (Save / Delete)", panel != nil && doc.fileURL == nil)
                            if let panel { window.endSheet(panel, returnCode: .cancel) }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                                let stillOpen = NSDocumentController.shared.documents.contains(doc)
                                check("Cancel keeps the new document open, text intact", stillOpen && doc.text == "A new thought.")
                                doc.updateChangeCount(.changeCleared)
                                doc.close()
                                guideCheck(check: check, done: done)
                            }
                        }
                    }
                }
            }
        }
    }

    /// Help › Leading Guide: the guide opens for reading and highlighting, but
    /// Edit Source is off and ⌘E sent straight to the window does nothing.
    private static func guideCheck(check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        FirstRun.openGuide()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            guard let doc = NSDocumentController.shared.documents.first(where: { ($0 as? MarkdownDocument)?.isGuide == true }) as? MarkdownDocument,
                  let wc = doc.windowControllers.first as? DocumentWindowController else {
                check("Help › Leading Guide opens the guide", false); return placeCheck(check: check, done: done)
            }
            let edit = NSMenuItem(title: "", action: #selector(ReaderActions.leadingToggleEdit(_:)), keyEquivalent: "")
            let highlight = NSMenuItem(title: "", action: #selector(ReaderActions.leadingHighlightYellow(_:)), keyEquivalent: "")
            let validator = wc as? NSMenuItemValidation
            check("The guide offers highlighting but not Edit Source",
                  validator?.validateMenuItem(edit) == false && validator?.validateMenuItem(highlight) == true && !doc.canEncrypt)
            wc.leadingToggleEdit(nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                wc.pageForTests.callAsyncJavaScript("return document.documentElement.dataset.mode !== 'edit' && window.leading.view.mode === 'read'", arguments: [:], in: nil, in: .page) { r in
                    check("⌘E leaves the guide in reading mode", (try? r.get()) as? Bool == true)
                    doc.close()
                    placeCheck(check: check, done: done)
                }
            }
        }
    }

    /// Reading place: scroll the second window halfway, close it, open the file
    /// again, and it comes back at the same block.
    private static func placeCheck(check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        guard let doc = NSDocumentController.shared.documents.first(where: { $0.fileURL?.lastPathComponent == "prose.md" }) as? MarkdownDocument,
              let url = doc.fileURL, let wc = doc.windowControllers.first as? DocumentWindowController else {
            check("The place test has prose.md open", false); return done()
        }
        let scroll = "const s = document.getElementById('scroller'); s.scrollTop = s.scrollHeight / 2; return true"
        let where_ = "return window.leading.view['placeMark']()?.s ?? -1"
        wc.pageForTests.callAsyncJavaScript(scroll, arguments: [:], in: nil, in: .page) { _ in
            // Past the half-second pause after which the page reports its place.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                wc.pageForTests.callAsyncJavaScript(where_, arguments: [:], in: nil, in: .page) { r in
                    let before = ((try? r.get()) as? NSNumber)?.intValue ?? -1
                    doc.close()
                    NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { reopened, _, _ in
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                            guard let page = (reopened?.windowControllers.first as? DocumentWindowController)?.pageForTests else {
                                check("prose.md opens again", false); return done()
                            }
                            page.callAsyncJavaScript(where_, arguments: [:], in: nil, in: .page) { r in
                                let after = ((try? r.get()) as? NSNumber)?.intValue ?? -2
                                check("A file opens again where the reader stopped (block at \(before) → \(after))", before > 0 && after == before)
                                wikiCheck(from: reopened as? MarkdownDocument, check: check, done: done)
                            }
                        }
                    }
                }
            }
        }
    }

    /// [[Linked#Far heading]] from prose.md: the note beside it opens, at that heading.
    private static func wikiCheck(from doc: MarkdownDocument?, check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        guard let doc, let folder = doc.fileURL?.deletingLastPathComponent(), let wc = doc.windowControllers.first as? DocumentWindowController else {
            check("The wikilink test has a document", false); return done()
        }
        let filler = Array(repeating: "Filler, so the heading starts well down the page.", count: 40).joined(separator: "\n\n")
        try? "# Linked\n\n\(filler)\n\n## Far heading\n\nHere.\n\n\(filler)\n".write(to: folder.appendingPathComponent("Linked.md"), atomically: true, encoding: .utf8)
        wc.pageOpenWiki(target: "linked", heading: "Far heading")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            guard let linked = NSDocumentController.shared.documents.first(where: { $0.fileURL?.lastPathComponent == "Linked.md" })?.windowControllers.first as? DocumentWindowController,
                  let linkedWindow = linked.window else {
                check("[[linked]] opens Linked.md beside the note", false); return done()
            }
            check("[[linked]] opens as a new tab beside the note it came from", wc.window?.tabbedWindows?.contains(linkedWindow) == true)
            let page = linked.pageForTests
            // With tabs, the bars over the page are taller: the band of paper behind them must cover the tab bar too.
            let bars = linkedWindow.frame.height - linkedWindow.contentLayoutRect.maxY
            page.callAsyncJavaScript("return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top'))", arguments: [:], in: nil, in: .page) { r in
                let band = ((try? r.get()) as? NSNumber)?.doubleValue ?? 0
                check("In a tab, the paper behind the title and tab bars covers both (\(Int(band)) of \(Int(bars)) pt)", bars > 50 && abs(band - bars) < 1.5)
            }
            let js = "const h = document.getElementById('far-heading'); const s = document.getElementById('scroller'); return s.scrollTop > 0 && h.getBoundingClientRect().top < s.clientHeight * 0.4"
            page.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
                check("[[linked#Far heading]] opens Linked.md at that heading", (try? r.get()) as? Bool == true)
                mathCheck(folder: folder, check: check, done: done)
            }
        }
    }

    /// A note with a formula and a Mermaid diagram: KaTeX typesets the one, Mermaid draws the other.
    private static func mathCheck(folder: URL, check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        let url = folder.appendingPathComponent("Math.md")
        try? "# Math\n\nEuler: $e^{i\\pi} + 1 = 0$, for $5.\n\n```mermaid\ngraph LR\n  A --> B\n```\n".write(to: url, atomically: true, encoding: .utf8)
        NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { doc, _, _ in
            // Mermaid loads on first use; give it a moment.
            DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
                guard let page = (doc?.windowControllers.first as? DocumentWindowController)?.pageForTests else {
                    check("Math.md opens", false); return done()
                }
                let js = "return [document.querySelectorAll('#doc .math .katex').length, document.querySelectorAll('#doc figure.diagram.drawn svg').length, document.fonts.check('20px KaTeX_Main')]"
                page.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
                    let v = (try? r.get()) as? [Any] ?? []
                    check("A formula is typeset in KaTeX's fonts, and a price stays prose", (v.first as? Int) == 1 && (v.count > 2 && v[2] as? Bool == true))
                    check("A Mermaid diagram is drawn", (v.count > 1 ? v[1] as? Int : nil) == 1)
                    embedCheck(folder: folder, check: check, done: done)
                }
            }
        }
    }

    /// ![[Linked#Far heading]] and ![[dot.png]] found on disk and shown; a task ticked while reading reaches the file.
    private static func embedCheck(folder: URL, check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        let url = folder.appendingPathComponent("Embeds.md")
        // A 2×2 PNG, in a subfolder, so it is found by searching rather than beside the note.
        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDKgCQAAhgQB/0FqBv4AAAAASUVORK5CYII=")!
        try? FileManager.default.createDirectory(at: folder.appendingPathComponent("attachments"), withIntermediateDirectories: true)
        try? png.write(to: folder.appendingPathComponent("attachments/dot.png"))
        try? "# Embeds\n\n![[Linked#Far heading]]\n\n![[dot.png|40]]\n\n- [ ] Walkaround\n".write(to: url, atomically: true, encoding: .utf8)
        NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { opened, _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                guard let doc = opened as? MarkdownDocument, let page = (doc.windowControllers.first as? DocumentWindowController)?.pageForTests else {
                    check("Embeds.md opens", false); return done()
                }
                let js = "const e = document.querySelector('#doc .note-embed'); const i = document.querySelector('#doc img.embed-img'); const t = e?.textContent ?? ''; return [e?.dataset.filled === 'yes' && t.includes('Far heading') && t.indexOf('Here.') < t.indexOf('Filler'), i ? i.naturalWidth : -1, e?.dataset.filled ?? 'none']"
                page.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
                    let v = (try? r.get()) as? [Any] ?? []
                    // The section starts at its heading, so the filler before it is left out.
                    check("![[Linked#Far heading]] shows that section of the note, found on disk (\(v.count > 2 ? v[2] : "?"))", v.first as? Bool == true)
                    check("![[dot.png]] shows the picture, found in a subfolder", (v.count > 1 ? v[1] as? Int : nil) == 2)
                    page.callAsyncJavaScript("document.querySelector('#doc li.task-list-item input').click(); return true", arguments: [:], in: nil, in: .page) { _ in
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                            check("Ticking a task while reading writes [x] into the file", doc.text.contains("- [x] Walkaround"))
                            pdfCheck(check: check, done: done)
                        }
                    }
                }
            }
        }
    }

    /// File › Export as PDF: real pages, with the text on them.
    private static func pdfCheck(check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        guard let wc = NSDocumentController.shared.documents.first(where: { $0.fileURL?.lastPathComponent == "prose.md" })?.windowControllers.first as? DocumentWindowController else {
            check("The PDF test has prose.md open", false); return done()
        }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("leading-selftest-\(UUID().uuidString).pdf")
        wc.runPrint(to: out) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                let pdf = PDFDocument(url: out)
                let pages = pdf?.pageCount ?? 0
                let text = pdf?.string ?? ""
                check("Export as PDF writes the whole file as pages (\(pages) pages)", pages >= 2 && text.contains("typographer"))
                // LEADING_SELFTEST_PDF=<path> keeps the PDF there, to look at.
                if let keep = ProcessInfo.processInfo.environment["LEADING_SELFTEST_PDF"] {
                    try? FileManager.default.removeItem(atPath: keep)
                    try? FileManager.default.moveItem(at: out, to: URL(fileURLWithPath: keep))
                } else {
                    try? FileManager.default.removeItem(at: out)
                }
                pageBreakCheck(check: check, done: done)
            }
        }
    }

    /// Page breaks in the three forms notes use: four short paragraphs print on exactly four pages.
    private static func pageBreakCheck(check: @escaping (String, Bool) -> Void, done: @escaping () -> Void) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("leading-breaks-\(UUID().uuidString).md")
        try? "One.\n\n\\newpage\n\nTwo.\n\n<!-- pagebreak -->\n\nThree.\n\n<div style=\"page-break-after: always;\"></div>\n\nFour.\n".write(to: url, atomically: true, encoding: .utf8)
        NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { opened, _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                guard let wc = opened?.windowControllers.first as? DocumentWindowController else { check("The page-break note opens", false); return done() }
                let out = FileManager.default.temporaryDirectory.appendingPathComponent("leading-breaks-\(UUID().uuidString).pdf")
                wc.runPrint(to: out) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        let pdf = PDFDocument(url: out)
                        let pages = (0..<(pdf?.pageCount ?? 0)).map { pdf?.page(at: $0)?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
                        check("Page breaks start new pages, and leave no mark (\(pages))", pages == ["One.", "Two.", "Three.", "Four."])
                        try? FileManager.default.removeItem(at: out)
                        opened?.close()
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
