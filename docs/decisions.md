# Decisions and findings

Short notes on choices that are not obvious from the code, and what testing showed. Newest first.

## Between Stages 4 and 5

### First feedback from real use
- Smart punctuation while typing is on by default. Earlier builds saved it off, so it is turned on once for existing settings; turning it off afterwards sticks.
- Format › Bulleted List (⌘L) and Numbered List (⇧⌘L) act on every selected line, and undo the list if all of them already are one. Format › Table (⇧⌘T) starts a two-column table, or makes the selected lines one (tabs split cells, so a paste from a spreadsheet converts). Letters rather than ⇧⌘7/8, because AppKit matches shifted digits by the character they type, which varies by keyboard layout.
- A wrapped list item in the editor continues under its first letter. The marker's width is measured in the editor's own face and applied as a hanging indent; reading mode already did this.
- The Outline toolbar button stays pressed while the outline shows.

### A blank page when Leading opens on its own
A file opened from Finder still opens to read. Launching Leading with no file, or File › New (⌘N), opens a blank page in edit mode with the cursor ready, since there is nothing to read yet. Closing a new page that has text brings macOS's own save sheet (Delete, Cancel, Save) rather than a warning of our own; quitting keeps new pages for next time, as TextEdit does. New files are Markdown (.md). Once saved, a document shows local images from its new folder.

## Stage 4

### How a selection becomes a highlight in the file
Every run of text on the page carries its source range. The aligner (`sourcemap.ts`) maps a selection's two ends to exact source offsets, through curly quotes, entities, escapes and quote prefixes. `highlight-edit.ts` then parses each touched block on its own and places markers where Markdown allows them:

- one highlight per paragraph, heading, list item or table cell;
- markers outside formatting that is wholly selected (`==**bold** idea==`), inside formatting that is partly selected (`**bo==ld==**`);
- code, wikilinks and images taken whole;
- highlights the selection touches are taken out and their remainders put back in the old colour and syntax; highlights it does not touch stay byte for byte.

Every result is parsed again before anything is written. The text must read the same, the structure must be the same, and exactly the selected characters must carry the new colour. `==` is used only where CommonMark's spacing rules let it open and close (so Obsidian reads it the same way); elsewhere `<mark>` is used, since it has no such rules. If neither passes, nothing is written and a short message says so. In about 6,000 random documents and selections (bold, links, code, quotes, tables, callouts, existing highlights in five colours), none was refused and none went wrong.

### Storage
Yellow is `==text==`; other colours are Highlightr's `<mark style="background: #RRGGBBAA;">` with its default hex values, checked against Highlightr's source (orange is `#FFB86CA6`). Changing a colour in Settings changes only how Leading shows it.

### One history
A highlight made while reading goes through the editor, so ⌘Z undoes it in either mode. The editor's code loads at the first highlight if it has not already loaded in the background.

### Only the changed block is redrawn
Redrawing a whole 5 MB page for one highlight took about a second and flashed. Now only the blocks that changed are rendered again, and the shift in source offsets for everything after them is recorded rather than written into thousands of elements. A highlight anywhere in the 5 MB stress file takes about 10 ms (60 ms for the first, which also sets up the editor). One trap found on the way: re-measuring every table after a change laid out the whole page and took 3 s.

## Stage 3

### One text, one history
While editing, the page's CodeMirror editor holds the text and the only undo history. Swift keeps a mirror, updated from each change set (UTF-16 offsets, the unit both sides use), and saves from it, so saving never waits on the page. A moment after typing stops, the page sends a fingerprint (FNV-1a over UTF-16 units, implemented identically in `hash.ts` and `TextMirror.swift`); if the mirror disagrees, Swift takes the page's text. Tests: 10,000 random change sets with emoji and accents in Swift, plus WebKit tests that replay the page's messages and compare.

Undo lives in the page for both modes (⌘Z while reading re-renders the page), which is also where Stage 4's highlights will go, so they undo the same way.

### Saving and conflicts
Autosave in place gives File › Revert To and the version browser. The file's encoding, line endings and byte-order mark are written back as found; if an old Latin-1 file gains a character it cannot hold, it is saved as UTF-8 rather than lose it. If another app changes the file while edits are unsaved, Leading asks which to keep and puts the other version into the version history first, so neither is lost.

### Find in edit mode
The same bar as reading mode, so the query carries across ⌘E. Plain searches match the raw source with reading mode's rules (case, accents and typography ignored); the .* toggle switches to regular expressions with `$1` groups in replacements. Replace All is one undoable change.

### The editor loads on demand
CodeMirror doubled the page's script (487 KB → 984 KB). It now loads on the first ⌘E, and in the background two seconds after a document opens, so reading starts with the lighter page and ⌘E is still immediate.

### Formatting toggles
Applying a format twice restores the text exactly (500 random cases in the tests). Italic and bold read asterisk runs carefully, so italic never removes bold. Spaces at the edges of a selection stay outside the markers; a selection of only spaces acts as a cursor.

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
