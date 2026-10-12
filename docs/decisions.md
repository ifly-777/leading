# Decisions and findings

Short notes on choices that are not obvious from the code, and what testing showed. Newest first.

## Stage 2

### Ad-hoc signatures keep macOS's default identity (security)
The plan was to pin each build's code-signing "designated requirement" to the bundle identifier, so that macOS would treat every update as the same app and not ask again for folder access (needed for local images in Documents, Desktop or iCloud Drive).

The update spike (`scripts/spike-sparkle.sh`) showed that this is unsafe. Sparkle accepts an update when **either** its EdDSA signature **or** its Apple code signature matches the installed app; the second route exists so developers can rotate keys. An identifier-only requirement is satisfied by anyone's ad-hoc app with the same identifier, so an attacker who could replace the download would bypass EdDSA entirely.

With the default ad-hoc requirement (a hash of the exact build, which nobody can reproduce), every update must carry a valid EdDSA signature. The spike now checks three cases:

| Case | Result |
| --- | --- |
| Honest update | installed; signature valid; no quarantine flag |
| Download signed with the wrong key | refused |
| Attacker's app carrying its own key | refused |

The cost: macOS may ask again for folder access after an update, only for documents that show local images from protected folders. A paid Developer ID would remove this trade-off.

### Sparkle works with ad-hoc signing
Sparkle 2.10 updated an ad-hoc-signed build from 0.2.0 to 0.2.1 with EdDSA verification, and the updated app carries no quarantine flag, so the Gatekeeper "Open Anyway" step is not repeated. Stage 5 uses Sparkle, with update checks off unless the reader opts in.

Sparkle is downloaded from its GitHub release by `scripts/fetch-sparkle.sh`, which checks it against the checksum in Sparkle's own `Package.swift`. (SwiftPM's own download stalled repeatedly on this Mac.)

### Gatekeeper behaves as planned on macOS 27
A CI-built DMG marked as downloaded by a browser: the app inside inherits the quarantine flag, its signature is valid, and `spctl` rejects it. That rejection is what produces the one-time block and the Open Anyway button. Apple's `syspolicy_check` reports the ad-hoc signature as a warning, not as damage, so users should see "could not verify", not the misleading "damaged".

### Opening speed (Apple M2, `scripts/measure-open.sh`)
| Case | Median | Target |
| --- | --- | --- |
| Small file, app running | 89–102 ms | < 150 ms |
| Small file, cold launch | ~420 ms | < 600 ms |
| 5 MB file, first screen | ~250 ms warm, ~440 ms cold | < 400 ms |

What it took:
- Show the window at once. WebKit pauses rendering in a window that is not on screen, so waiting for text before showing the window delayed the text.
- Make the next warm page only after the current window has painted (creating a web view costs the main thread 50–80 ms).
- Pass small documents inline; let the page fetch large ones from its own `leading://app` address. Passing 5 MB as a script argument cost 244 ms; custom-scheme origins are opaque, so the text has to be served same-origin.
- Find line endings by scanning bytes, not a Swift String (286 ms → about 1 ms on 5 MB).
- Each waiting page preloads the reading fonts and runs the parser once, so the first real render is not paying for either.

"First paint" is measured when the text is laid out, not at the next screen refresh. WebKit stops refreshing windows covered by others, and a visible window shows the text within one refresh (8–16 ms).

### WebKit layout traps on long pages
- `getBoundingClientRect` on an ancestor of skipped (`content-visibility: auto`) content forces layout of all of it, about 0.5 s at 5 MB. Geometry is read from an empty overlay (`#frame`) and from `offsetTop`.
- Moving focus or the selection makes WebKit re-check every `content-visibility: auto` element. Applied per block (12,000 of them) that cost about 0.5 s per keystroke in Find; applied to about 200 sections cut at headings, about 5 ms.

### Parsing 5 MB in parallel
remark parses about 1–2 MB a second on one core. Long files are cut before top-level headings (never inside fenced code or open HTML containers) and parsed by a pool of workers; a test checks that the result is identical to a whole-file parse. Files with footnotes stay whole, because footnote numbering runs across the document.

### Swift package instead of an Xcode project
A plain Swift package plus `scripts/build-app.sh` assembles the app bundle. It is easier to review, runs the same way locally and on CI, and Xcode can still open the package.
