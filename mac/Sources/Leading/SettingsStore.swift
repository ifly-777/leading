import Combine
import Foundation
import LeadingCore

/// The reading settings, shared by every window and kept in the app's one
/// preferences file. Any change is pushed to all open pages.
final class SettingsStore: ObservableObject {
    static let shared = SettingsStore()
    private let key = "readerSettings"

    @Published var settings: ReaderSettings {
        didSet {
            guard settings != oldValue else { return }
            if let data = try? JSONEncoder().encode(settings) { UserDefaults.standard.set(data, forKey: key) }
        }
    }

    private init() {
        if let data = UserDefaults.standard.data(forKey: key), let s = try? JSONDecoder().decode(ReaderSettings.self, from: data) {
            settings = s
        } else {
            settings = ReaderSettings()
        }
    }

    /// A change made inside a page (a shortcut, or Esc closing the outline).
    func update(fromPage dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let s = try? JSONDecoder().decode(ReaderSettings.self, from: data) else { return }
        settings = s
    }
}
