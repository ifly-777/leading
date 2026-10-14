import Foundation

// A Quick Look extension has no main of its own: the system's extension
// runtime starts it and loads PreviewViewController (named in Info.plist).
@_silgen_name("NSExtensionMain")
func NSExtensionMain(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32

exit(NSExtensionMain(CommandLine.argc, CommandLine.unsafeArgv))
