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
                            done()
                        }
                    }
                }
            }
        }
    }
}
