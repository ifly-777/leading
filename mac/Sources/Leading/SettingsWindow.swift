import AppKit
import LeadingCore
import SwiftUI

/// Leading › Settings… (⌘,): the five highlight colours, as Leading shows
/// them on light and on dark paper. Changing one alters only the display; the
/// colour written into files stays the standard one, so Obsidian and other
/// apps see the same highlights as before.
enum SettingsWindow {
    static func make() -> NSWindowController {
        let host = NSHostingController(rootView: HighlightColorsView())
        host.sizingOptions = .preferredContentSize
        let window = NSWindow(contentViewController: host)
        window.title = "Settings"
        window.styleMask = [.titled, .closable]
        window.setFrameAutosaveName("Settings")
        return NSWindowController(window: window)
    }
}

struct HighlightColorsView: View {
    @ObservedObject var store = SettingsStore.shared

    // The two papers, so each swatch is judged against what it will sit on.
    private let lightPaper = Color(red: 0xFB / 255, green: 0xF8 / 255, blue: 0xF2 / 255)
    private let darkPaper = Color(red: 0x1E / 255, green: 0x1D / 255, blue: 0x1B / 255)
    private let lightInk = Color(red: 0x2B / 255, green: 0x28 / 255, blue: 0x24 / 255)
    private let darkInk = Color(red: 0xDC / 255, green: 0xD6 / 255, blue: 0xCC / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Highlight colours").font(.headline)
            Text("How Leading shows each colour. Files keep the standard colours, so other apps are not affected. Sepia uses the light colours.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    Text("")
                    Text("Light").font(.caption).foregroundStyle(.secondary)
                    Text("Dark").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(HighlightColors.slots, id: \.self) { slot in
                    GridRow {
                        Text(HighlightColors.names[slot] ?? slot).frame(width: 60, alignment: .leading)
                        swatch(slot, dark: false)
                        swatch(slot, dark: true)
                    }
                }
            }
            HStack {
                Spacer()
                Button("Restore Defaults") { store.settings.highlightColors = HighlightColors() }
                    .disabled(store.settings.highlightColors.isDefault)
            }
        }
        .padding(20)
        .frame(width: 400)
    }

    private func swatch(_ slot: String, dark: Bool) -> some View {
        HStack(spacing: 8) {
            ColorPicker("", selection: binding(slot, dark: dark), supportsOpacity: false).labelsHidden()
            Text("Sample")
                .padding(.horizontal, 4)
                .background(RoundedRectangle(cornerRadius: 3).fill(Color(hex: current(slot, dark: dark)) ?? .yellow))
                .foregroundStyle(dark ? darkInk : lightInk)
                .padding(4)
                .background(dark ? darkPaper : lightPaper, in: RoundedRectangle(cornerRadius: 5))
        }
    }

    private func current(_ slot: String, dark: Bool) -> String {
        let c = store.settings.highlightColors
        return (dark ? c.dark[slot] : c.light[slot]) ?? (dark ? HighlightColors.defaultDark[slot] : HighlightColors.defaultLight[slot]) ?? "#FBE59B"
    }

    private func binding(_ slot: String, dark: Bool) -> Binding<Color> {
        Binding(
            get: { Color(hex: current(slot, dark: dark)) ?? .yellow },
            set: { color in
                guard let hex = color.hexString else { return }
                // Picking the default again clears the override, so "Restore Defaults" stays honest.
                let def = dark ? HighlightColors.defaultDark[slot] : HighlightColors.defaultLight[slot]
                if dark { store.settings.highlightColors.dark[slot] = hex == def ? nil : hex }
                else { store.settings.highlightColors.light[slot] = hex == def ? nil : hex }
            })
    }
}

extension Color {
    init?(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count >= 6, let v = UInt32(h.prefix(6), radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
    }

    /// "#RRGGBB" in sRGB, the form the page understands.
    var hexString: String? {
        guard let c = NSColor(self).usingColorSpace(.sRGB) else { return nil }
        let r = Int((c.redComponent * 255).rounded()), g = Int((c.greenComponent * 255).rounded()), b = Int((c.blueComponent * 255).rounded())
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}
