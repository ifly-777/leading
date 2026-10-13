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
                // Leave the reader's settings as they were.
                store.settings = before
                print("Leading self-test\n" + results.joined(separator: "\n"))
                fflush(stdout)
                NSApp.terminate(nil)
            }
        }
        step(0)
    }
}
