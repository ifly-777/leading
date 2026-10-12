import Foundation
import os

/// Measures how long a document takes to reach the screen. Always recorded as
/// signposts (visible in Instruments); also written as JSON lines to the file
/// named by LEADING_TIMING_LOG, which scripts/measure-open.sh reads.
final class OpenTiming {
    static let shared = OpenTiming()
    private let log = OSLog(subsystem: Bundle.main.bundleIdentifier ?? "Leading", category: .pointsOfInterest)
    private let logFile = ProcessInfo.processInfo.environment["LEADING_TIMING_LOG"]
    private var firstDocument = true

    func launchBegan() { os_signpost(.event, log: log, name: "launch") }

    /// A document's first text is on screen.
    func painted(file: URL?, openedAt: Date, pageMs: Double) {
        os_signpost(.event, log: log, name: "first paint", "%{public}s", file?.lastPathComponent ?? "")
        guard let logFile else { return }
        let sinceOpen = Date().timeIntervalSince(openedAt) * 1000
        var entry: [String: Any] = ["file": file?.lastPathComponent ?? "", "sinceOpenMs": sinceOpen.rounded(), "pageMs": pageMs.rounded()]
        // For the first document after launch, also time from process start: the cold-launch number.
        if firstDocument, let start = Self.processStart() {
            entry["sinceLaunchMs"] = (Date().timeIntervalSince(start) * 1000).rounded()
        }
        firstDocument = false
        guard let data = try? JSONSerialization.data(withJSONObject: entry), let handle = FileHandle(forWritingAtPath: logFile) ?? {
            FileManager.default.createFile(atPath: logFile, contents: nil)
            return FileHandle(forWritingAtPath: logFile)
        }() else { return }
        handle.seekToEndOfFile()
        handle.write(data + Data("\n".utf8))
        try? handle.close()
    }

    /// When this process started, from the kernel.
    private static func processStart() -> Date? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
        let t = info.kp_proc.p_starttime
        return Date(timeIntervalSince1970: Double(t.tv_sec) + Double(t.tv_usec) / 1_000_000)
    }
}
