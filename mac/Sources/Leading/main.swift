import AppKit

// No storyboard or nib: the app is built in code so every piece is visible here.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
