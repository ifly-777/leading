// swift-tools-version:6.0
// Leading's Mac shell. Built into an app bundle by scripts/build-app.sh;
// Xcode can open this package directly for editing and debugging.

import PackageDescription

let package = Package(
    name: "Leading",
    platforms: [.macOS("26.0")],
    products: [.executable(name: "Leading", targets: ["Leading"])],
    targets: [
        // Pure logic (text decoding, link and image paths, settings), unit-tested.
        .target(name: "LeadingCore", path: "Sources/LeadingCore"),
        // The AppKit app. Swift 5 language mode keeps AppKit/WebKit delegate code plain.
        .executableTarget(
            name: "Leading",
            dependencies: ["LeadingCore"],
            path: "Sources/Leading",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(name: "LeadingTests", dependencies: ["LeadingCore"], path: "Tests/LeadingTests"),
    ]
)
