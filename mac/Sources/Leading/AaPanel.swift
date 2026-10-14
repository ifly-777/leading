import AppKit
import LeadingCore
import SwiftUI

/// The "Aa" popover: font, size, line height, line width and theme, with the
/// finer controls under Advanced. Edits go straight to the shared settings,
/// which every open window follows.
struct AaPanel: View {
    @ObservedObject var store = SettingsStore.shared
    @State private var advanced = false
    @State private var families: [String] = []

    static func controller() -> NSViewController {
        let c = NSHostingController(rootView: AaPanel())
        c.sizingOptions = .preferredContentSize
        return c
    }

    private var s: Binding<ReaderSettings> { $store.settings }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Font", selection: s.font) {
                Text("Literata").tag("literata")
                Text("New York").tag("newyork")
                Text("Charter").tag("charter")
                Text("Atkinson Hyperlegible Next").tag("atkinson")
                Text("iA Writer Quattro").tag("quattro")
                Divider()
                Text("Other installed font…").tag("custom")
            }
            if store.settings.font == "custom" {
                Picker("Installed font", selection: s.customFont) {
                    Text("Choose…").tag("")
                    ForEach(families, id: \.self) { Text($0).tag($0) }
                }
                .onAppear { if families.isEmpty { families = NSFontManager.shared.availableFontFamilies.sorted() } }
            }
            row("Size", value: "\(Int(store.settings.size)) px") {
                Slider(value: s.size, in: 14...28, step: 1)
            }
            row("Line height", value: String(format: "%.2f", store.settings.lineHeight)) {
                Slider(value: s.lineHeight, in: 1.2...2.0, step: 0.05)
            }
            Picker("Line width", selection: s.measure) {
                Text("Narrow").tag("narrow"); Text("Medium").tag("medium"); Text("Wide").tag("wide")
            }.pickerStyle(.segmented)
            Picker("Theme", selection: s.theme) {
                Text("Auto").tag("system"); Text("Light").tag("light"); Text("Sepia").tag("sepia"); Text("Dark").tag("dark")
            }.pickerStyle(.segmented)

            DisclosureGroup("Advanced", isExpanded: $advanced) {
                VStack(alignment: .leading, spacing: 10) {
                    row("Letter spacing", value: String(format: "%+.3f em", store.settings.letterSpacing)) {
                        Slider(value: s.letterSpacing, in: -0.02...0.12, step: 0.005)
                    }
                    row("Word spacing", value: String(format: "%.2f em", store.settings.wordSpacing)) {
                        Slider(value: s.wordSpacing, in: 0...0.16, step: 0.01)
                    }
                    Picker("Paragraphs", selection: s.paragraphStyle) {
                        Text("Space between").tag("space"); Text("First-line indent").tag("indent")
                    }.pickerStyle(.segmented)
                    if store.settings.paragraphStyle == "space" {
                        row("Paragraph space", value: String(format: "%.1f em", store.settings.paragraphSpacing)) {
                            Slider(value: s.paragraphSpacing, in: 0...2, step: 0.1)
                        }
                    }
                    Picker("Alignment", selection: s.align) {
                        Text("Left").tag("left"); Text("Justified").tag("justify")
                    }.pickerStyle(.segmented)
                    Picker("Code font", selection: s.monoFont) {
                        Text("SF Mono").tag("sfmono"); Text("iA Writer Mono").tag("iamono")
                    }
                    Picker("Highlights", selection: s.highlightStyle) {
                        Text("Marker").tag("marker"); Text("Lowlight").tag("lowlight"); Text("Underline").tag("underline")
                    }.pickerStyle(.segmented)
                    Toggle("Shade alternate table rows", isOn: s.zebra)
                    Toggle("Show reading progress", isOn: s.progress)
                    Toggle("Focus on the paragraph being read", isOn: s.focus)
                    Toggle("Move a screen at a time", isOn: s.paged)
                }
                .padding(.top, 6)
            }
        }
        .padding(16)
        .frame(width: 320)
    }

    private func row<Content: View>(_ label: String, value: String, @ViewBuilder _ control: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label)
                Spacer()
                Text(value).foregroundStyle(.secondary).monospacedDigit()
            }
            control()
        }
    }
}
