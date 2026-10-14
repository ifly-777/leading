import AppKit
import SwiftUI

/// Locks every unlocked encrypted note when the reader steps away: the Mac
/// sleeps (closing the lid does this), the display sleeps, the screen locks,
/// the screen saver starts, or another user takes over the screen.
final class LockWatcher {
    static let shared = LockWatcher()
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        let ws = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            ws.addObserver(forName: name, object: nil, queue: .main) { n in LockWatcher.lockAll(because: n.name.rawValue) }
        }
        // Not public API in name, but long stable: posted by loginwindow and the screen saver.
        let dist = DistributedNotificationCenter.default()
        for name in ["com.apple.screenIsLocked", "com.apple.screensaver.didstart"] {
            dist.addObserver(forName: Notification.Name(name), object: nil, queue: .main) { n in LockWatcher.lockAll(because: n.name.rawValue) }
        }
    }

    static var anyUnlocked: Bool { documents.contains { $0.isEncrypted && !$0.isPasswordLocked } }

    static func lockAll(because reason: String = "Lock command") {
        let open = documents.filter { $0.isEncrypted && !$0.isPasswordLocked }
        if !open.isEmpty { NSLog("Leading: locking %d encrypted note(s): %@", open.count, reason) }
        for doc in open { doc.lock() }
    }

    private static var documents: [MarkdownDocument] { NSDocumentController.shared.documents.compactMap { $0 as? MarkdownDocument } }
}

// MARK: The locked page

/// Shown in place of the reading page while a note is locked. It is plain
/// AppKit and SwiftUI, so the password never passes through the web page.
final class LockedView: NSHostingView<LockedPanel> {
    init(name: String, unlock: @escaping (String, @escaping (Bool) -> Void) -> Void) {
        super.init(rootView: LockedPanel(name: name, unlock: unlock))
    }
    required init(rootView: LockedPanel) { super.init(rootView: rootView) }
    required init?(coder: NSCoder) { fatalError("not used") }
}

struct LockedPanel: View {
    let name: String
    let unlock: (String, @escaping (Bool) -> Void) -> Void
    @State private var password = ""
    @State private var working = false
    @State private var wrong = false
    @State private var shake: CGFloat = 0
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "lock.fill").font(.system(size: 34, weight: .light)).foregroundStyle(.secondary)
            Text(name).font(.title2)
            Text("This note is encrypted.").foregroundStyle(.secondary)
            HStack {
                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 220)
                    .focused($focused)
                    .onSubmit(submit)
                    .disabled(working)
                    .modifier(Shake(amount: shake))
                Button("Unlock", action: submit).disabled(password.isEmpty || working)
            }
            // Keep the line's height so nothing jumps when the message appears.
            Text(wrong ? "Wrong password" : " ").font(.callout).foregroundStyle(.red)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { focused = true }
    }

    private func submit() {
        guard !password.isEmpty, !working else { return }
        working = true
        wrong = false
        unlock(password) { ok in
            working = false
            if ok { password = ""; return }
            wrong = true
            password = ""
            withAnimation(.linear(duration: 0.4)) { shake += 1 }
            focused = true
        }
    }
}

/// The macOS "wrong password" shake.
private struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 8 * sin(amount * .pi * 6), y: 0))
    }
}

// MARK: The password sheet

/// The deliberate sheet for setting up, changing or removing a note's password.
/// Encrypting asks twice and needs a ticked box, since nothing can recover the note.
enum PasswordSheet {
    enum Mode { case encrypt, change, remove }

    /// `perform(current, new, done)`; `done(nil)` closes the sheet, an error is shown in it.
    static func show(_ mode: Mode, name: String, on window: NSWindow,
                     perform: @escaping (_ current: String, _ new: String, _ done: @escaping (Error?) -> Void) -> Void) {
        let sheet = NSWindow(contentRect: .zero, styleMask: [.titled], backing: .buffered, defer: false)
        let close = { [weak window, weak sheet] in
            if let sheet { window?.endSheet(sheet) }
        }
        let host = NSHostingController(rootView: PasswordForm(mode: mode, name: name, perform: perform, close: close))
        host.sizingOptions = .preferredContentSize
        sheet.contentViewController = host
        window.beginSheet(sheet)
    }
}

struct PasswordForm: View {
    let mode: PasswordSheet.Mode
    let name: String
    let perform: (String, String, @escaping (Error?) -> Void) -> Void
    let close: () -> Void

    @State private var current = ""
    @State private var new = ""
    @State private var again = ""
    @State private var understood = false
    @State private var working = false
    @State private var error: String?

    private static let minimum = 8

    private var title: String {
        switch mode {
        case .encrypt: "Encrypt “\(name)”"
        case .change: "Change the Password for “\(name)”"
        case .remove: "Remove Encryption from “\(name)”"
        }
    }

    private var asksNew: Bool { mode != .remove }
    private var asksCurrent: Bool { mode != .encrypt }

    /// Why the action button is not available yet, shown under the fields.
    private var problem: String? {
        guard asksNew else { return nil }
        if new.isEmpty { return nil }
        if new.count < Self.minimum { return "Use at least \(Self.minimum) characters." }
        if !again.isEmpty, again != new { return "The two passwords are not the same." }
        return nil
    }

    private var ready: Bool {
        if working { return false }
        if asksCurrent && current.isEmpty { return false }
        if asksNew && (new.count < Self.minimum || again != new) { return false }
        if mode == .encrypt && !understood { return false }
        return true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline)
            switch mode {
            case .encrypt:
                Text("Leading will save this note encrypted. You will need the password to read it, here or on any other Mac. **There is no way to recover the note if you forget the password.**")
                    .fixedSize(horizontal: false, vertical: true)
                Text("Copies made before now, in Time Machine, iCloud, Obsidian Sync or git, are not encrypted. Other apps, Obsidian included, will see only a notice.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            case .change:
                Text("Earlier versions of the note, in File › Revert To, will be removed, since they need the old password.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            case .remove:
                Text("The note will be saved as ordinary Markdown that any app can read.")
                    .fixedSize(horizontal: false, vertical: true)
            }
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 8) {
                if asksCurrent { row(mode == .remove ? "Password:" : "Current password:", $current) }
                if asksNew {
                    row(mode == .change ? "New password:" : "Password:", $new)
                    row("Again:", $again)
                }
            }
            .disabled(working)
            if mode == .encrypt {
                Toggle("I understand I cannot recover this note without the password", isOn: $understood)
                    .disabled(working)
            }
            Text(error ?? problem ?? " ").font(.callout).foregroundStyle(.red)
            HStack {
                if working { ProgressView().controlSize(.small) }
                Spacer()
                Button("Cancel", role: .cancel, action: close).keyboardShortcut(.cancelAction).disabled(working)
                Button(mode == .encrypt ? "Encrypt" : mode == .change ? "Change Password" : "Remove Encryption", action: submit)
                    .keyboardShortcut(.defaultAction).disabled(!ready)
            }
        }
        .padding(20)
        .frame(width: 440)
    }

    private func row(_ label: String, _ text: Binding<String>) -> some View {
        GridRow {
            Text(label).gridColumnAlignment(.trailing)
            SecureField("", text: text).textFieldStyle(.roundedBorder).onSubmit(submit)
        }
    }

    private func submit() {
        guard ready else { return }
        working = true
        error = nil
        perform(current, new) { e in
            working = false
            if let e { error = e.localizedDescription; current = "" } else { close() }
        }
    }
}
