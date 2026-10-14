# Decisions and findings

Short notes on choices that are not obvious from the code, and what testing showed. Newest first.

## Leading 1.3

### Code is coloured in the workers, and only when the block names its language
highlight.js grammars, through lowlight, return a hast tree, so colouring happens with the rest of the block in the parsing workers and arrives with the first paint. Only the 31 languages that turn up in notes are bundled. Guessing a language for unlabelled blocks is slow and often wrong, so those stay plain. The block's text is unchanged, trailing newline included, so Find counts the same matches. Blocks over 100,000 characters stay plain.

### Embeds are found by the app and served by kind
`![[picture.png]]` becomes an image whose address the app's scheme handler resolves the way a wikilink is resolved (beside the note, then the vault, shortest path first). `![[Note]]` is fetched as text from the page's own origin and rendered on the page. The handler serves an embed only as its kind (images as images, notes as text), so an embed can never reach any other file. An embedded note is a copy with its positions, ids and nested embeds removed: highlights and edits cannot land in it, Find leaves it out, and two notes embedding each other cannot loop. Embeds are opt-in (`vaultEmbeds`), so the developer prototype, which has no app behind it, shows them as links rather than requesting files nothing serves.

### Page breaks in the forms notes already use
Leading honours Obsidian's and Typora's `<div style="page-break-after: always"></div>` (and `break-after: page`), Pandoc's `\newpage` and `\pagebreak`, and the invisible `<!-- pagebreak -->`, so a note prints the same here as where it was written. On screen a break is a faint dashed rule; on paper it starts a new page and leaves no mark. Format › Insert Page Break (⌘↩) writes the Obsidian form. The print stylesheet breaks before the next block as well as after the marker, which holds even where WebKit ignores a break on an empty box. The self-test prints four paragraphs on exactly four pages.

### Tabs on the theme's paper
In macOS 26 the tab bar is translucent glass over whatever lies beneath, which in Leading is the page scrolling up under the title bar. The page kept a band of paper only behind the title bar (38 pt), so beneath the tab bar the glass showed text, and read as grey in every theme. AppKit offers no way to colour the tab bar, and its views are private, so instead the window tells the page how tall its bars are (title bar, plus tab bar when there are tabs: 76 pt), watching `contentLayoutRect` as tabs come and go, and the band, the text's starting point, the find bar and the outline follow. The glass then sits on sepia paper in sepia, and on dark paper in dark.

### No ligatures on paper
Checking that test's text showed that WebKit writes Literata's "Th" ligature into PDFs with no letters behind it: "The" copied or searched as "!e". It is a common ligature, not a contextual alternate (turning those off did not help), so printing sets letters without ligatures. Text that copies correctly matters more than an fi joined; the screen keeps its ligatures.

### Links open as tabs, and previews cover this note's own sections
A followed link opens its note as a new tab beside the note it came from, whatever macOS's own tab preference says: reading on from a link is one train of thought, not a new task. A note that is already open is brought forward where it is. The first version followed the system preference, which by default meant a new window each time. Previews first covered only links to other notes. In a note that links mostly to its own sections, as a contents list does, most links showed nothing but the browser's title tooltip, so `[[#Heading]]` and `[text](#heading)` now preview the section, and the tooltip is gone. A heading that is not there shows no card, never the whole note. Printing brings its window forward first, since a print sheet on a tab behind another never appears.

### Reading-mode edits all go through the editor
Ticking a task, like a highlight, is applied through the source editor, so ⌘Z undoes either, and Swift's copy of the text and the autosave see one stream of edits. The tick finds the `[ ]` from the list item's source position, in tight and loose lists alike (a loose list puts the box inside the item's first paragraph).

### Highlights are listed from the page, by page order
The highlights tab reads the page's own `<mark class="hl">` elements, so it always matches what the reader sees. Each highlight's section is found from page order, not source offsets: the outline's offsets date from the last full render, and an earlier version filed a highlight under the wrong heading after a new one was made above it. Copy writes each highlight exactly as in the file, so colours survive a paste into Obsidian.

### Quotations keep their emphasis paired
Copy as Quote takes the selection's source. A selection starting inside `*italics*` or `**bold**` would leave a stray marker, so unpaired marker runs at either end are taken in from just outside. Runs are counted, not characters: `**` and `==` are one marker each, which a first version got wrong.

### Focus dims blocks, and list items within lists
The block under a reading line a third of the way down the window stays at full strength; in a list, the top-level item. Opacity is used, not colour, so highlights, code and math recede with their text. A nested item cannot be brighter than its parent, which is why only top-level items are singled out.

### Printing switches to light paper
The window scrolls inside a fixed frame, so a print stylesheet lets the document flow onto pages, hides everything but the text, and sets the reader's typeface at 11 pt across the full measure. Before printing, the page switches to the light theme, draws every diagram and loads every image; afterwards it switches back. WebKit prints blank pages unless its print view is given a frame first.

### Quick Look: the page lives in the extension
App extensions must be sandboxed, and a sandboxed extension cannot read its containing app's Resources (first tried; "you don't have permission to view it"). So the page is copied once, into the extension's bundle, and the app reaches it through a relative link in its own Resources. WebKit also refuses to start its page process in a sandbox without `com.apple.security.network.client`, even for a page that never uses the network. The preview has that entitlement and makes no connection: the page's CSP forbids every request, and its scheme handler serves only its own folder. The preview is read-only (no highlighting, ticking or editing), and shows no pictures beside the file, since Quick Look grants access to the one file only.

## Leading 1.2

### Math is typeset while the file is parsed
KaTeX is pure JavaScript, so the parsing workers typeset each formula as they render its block, and math arrives already set in the first paint. Nothing changes height afterwards, so a remembered place still lands on the right line. Each formula leaves a numbered empty span in the tree, and KaTeX's HTML replaces it after the block is serialised: KaTeX needs its own inline styles, which the sanitiser rightly strips from the file's HTML. Only the TeX ever reaches KaTeX, which escapes it, with `trust` off, so `\href{javascript:…}` and raw tags come out as text.

Single dollars follow Obsidian's rule, not the CommonMark extension's. A `$` opens math only if a non-space follows it, and closes it only if a non-space precedes it and no digit follows. The stock extension would take "it costs $5 and $10" as a formula. A `$` that cannot close because a space precedes it ends the attempt, so in "$3.50 vs $x$" only `$x$` is math. The rule lives in a tokenizer (`plugins/math-text.ts`), not a pass over the text, because emphasis and escapes are resolved first: `$a*b*c$` and `$\{x\}$` would otherwise reach KaTeX broken. `$$` blocks count as fences when the file is split for the workers, so a display formula with a blank line or a `# ` inside is never cut.

Formulas and diagrams are left out of Find, on both sides (the worker's index and the page's own count), so match numbers cannot drift. For highlights a formula is one piece, like inline code.

KaTeX adds about 265 kB to the page and to each worker. Warm opening of the standard files changed by 1 to 3 ms (prose 69–70 → 72–73 ms, tables 82–83 → 84 ms, M2). Cold launches varied by hundreds of milliseconds between runs of the same build, too much to see a difference of this size. If it ever matters, KaTeX can load only for files that contain `$`.

### Diagrams are drawn on the page, and only when there is one
Mermaid measures text in a live page, so it cannot run in the workers. It is also large (about 7 MB with its layout engines), so it is a separate bundle loaded the first time a file has a diagram. It ships inside the app and needs nothing from the network or the CSP. All twenty diagram types tried, from flowcharts to C4, Kanban and architecture, drew under `script-src 'self'` with no CSP violation and no error. Diagrams near the window are drawn first and the rest as they come within 1,500 px. They use the theme's own colours and the reading font through Mermaid's `base` theme, are cached by source and look, and are drawn again when the theme or font changes. A diagram that fails shows its source and Mermaid's first line of complaint.

Current WebKit anchors scrolling itself (`overflow-anchor`), so when a diagram above the window grows, the line being read stays put. Moving the page by the change as well, as first written, moved it twice. The manual correction now runs only on engines without native anchoring.

## After 1.0.0

### Wikilinks are found the way Obsidian finds them
A wikilink opens its note in Leading: first a file of that name beside the note, then anywhere in the vault (the nearest folder above holding `.obsidian`; with no vault, the note's own folder and those below it), preferring the match nearest the vault's top, which is Obsidian's rule. Names match regardless of case and Unicode composition, but the URL keeps the spelling on disk: macOS ignores case, and `linked.md` would otherwise open a second window for an open `Linked.md`. The search runs off the main thread and stops after 50,000 entries. A missing note beeps; Leading does not create notes. `[[Note#Heading]]` and `other.md#heading` open at that heading, matched by its text or its slug. The page waits for the document's text before jumping, but not for its images.

### Back is per document
View › Back (⌘[) returns to where the last jump began: an outline click, a heading link, an anchor or a footnote ⌥-click, up to 50 deep. Going back across files is left to macOS's tabs and windows, so Leading keeps no history of its own between documents. The place probe now walks down from the top of the column until it meets a block: at the very top of the page it used to land in the padding, find nothing, and so remember nothing.

### Footnotes open beside their number
Clicking a footnote number shows the note in a card under its line, within the column, flipped above when there is no room below. Esc, a click elsewhere, or scrolling the number out of sight closes it. ⌥-click jumps to the endnotes as before, and the endnotes stay on the page. The card holds a copy of the note with its ids and source positions stripped, so nothing in it maps back into the file: a highlight is made in the endnote itself, and the card shows it there next time.

### Progress is counted in words, not pixels
View › Show Reading Progress (⌥⌘P, off by default) draws a hairline the width of the column under the title bar, and shows the time left in the window's corner while scrolling. Both are measured in words: a table, an image or a code block takes far more height than reading time, and long pages give far-away blocks only an estimated height, so a scroll fraction would jump about. Time left assumes 238 words a minute, Brysbaert's 2019 meta-analysis figure for silent reading of English non-fiction; a fast reader will beat it. The label first sat at the column's foot, but there it covered text; the corner is clear except in narrow windows, and it shows only while scrolling.

### The reader's place is kept outside the file
Each file reopens where the reader stopped. The place is the source offset of the block at the top of the window plus pixels into it, the same mark ⌘E already carries across modes, so a file edited elsewhere still reopens near the right paragraph. Places live in `~/Library/Application Support/Leading/places.json`, keyed by resolved path, at most 1,000 files, oldest dropped first. An extended attribute on the file was rejected: autosave writes atomically and would drop it, and sync tools would see a change on every scroll. The page reports its place half a second after scrolling stops; the store is written on window close, on quit and every 10 s while dirty. README pictures always open at the top; the self-test keeps its places in a temporary folder.

### A highlight must not move text, so the marker is not cloned
Adding a highlight could make a whole paragraph re-break. The cause was `box-decoration-break: clone` on the marker style. WebKit drops `text-wrap: pretty` for any paragraph that holds a cloned inline box and lays it out line by line instead: with a cloned mark, the paragraph broke exactly as `text-wrap: wrap` would at 79 of 84 widths tested, against 9 of 84 when unmarked. Padding cancelled by negative margin, border radius and the background do not matter; a cloned box with no padding at all still reflowed the paragraph.

The marker is now a single uncloned box. It keeps its soft fill, rounded corners and slight overhang at the two ends of the highlight; where the highlight wraps onto another line, the fill now stops square at the text. `text-wrap: pretty` stays: it is the better paragraph and it was never the culprit.

`highlight-reflow.spec.ts` renders three paragraphs with and without seven highlights, in all three styles, ragged and justified, at every 4 px from 420 to 640 px, and requires identical breaks. With the clone back it fails 2,241 cases; without it, none.

The test that a boundary at a space moves nothing runs on macOS only. On the Linux CI runner, WebKit shapes with HarfBuzz instead of CoreText, and marking the word "office" moves its glyphs there. That is not the engine Leading ships on, and on macOS nothing moves.

A boundary inside a word is a separate, smaller effect. WebKit shapes the text on each side of an inline element apart, so kerning and ligatures across the cut are lost: "AV|ATAR" grows 2.4 px, "of|fice" loses its ligature. The rest of the line shifts by that much, and now and then a break moves (12 of 2,016 mid-word cases per style in an earlier run of the same test, identical for every style and for a bare `<span>`). A boundary at a space changes no glyph's position. Reader highlights are not snapped to words, so a sloppy drag still causes this. The cures are to snap highlights to word edges or to draw them without an element (an overlay from the range's rectangles, or the CSS Custom Highlight API); both are larger changes and neither was made here.

## Stage 5

### Releases are made on the release Mac, not on CI
The update-signing key (EdDSA) was generated with Sparkle's `generate_keys` and lives only in this Mac's login Keychain, under the account `io.github.ifly-777.leading`. Putting it in a GitHub secret would let anyone who gained write access to the repository's workflows sign updates. So `scripts/release.sh` builds, packs and signs here, checks that the key compiled into the app is the Keychain's, verifies the signature, and only publishes with `--publish`. The Release workflow on CI still builds the DMG on a clean Mac, as a check that the repository alone is enough.

Losing the key would strand every installed copy: they would refuse all future updates. It needs a backup (`generate_keys -x`) in a password manager.

### The update feed
Each release carries an `appcast.xml` naming only itself; the app reads `releases/latest/download/appcast.xml`, which GitHub redirects to the newest release's copy. Release notes are Markdown in `docs/releases/<version>.md`, shown formatted by Sparkle and used for the GitHub release. The feed works only once the repository is public.

End-to-end test with the real key: a 0.9.9 build read a local copy of the 1.0.0 feed, downloaded the zip, verified it and installed it. The result had a valid signature, no quarantine flag, and was identical to the release build.

### Updates stay off until the reader says yes
The first-launch question has the update box unticked. Sparkle is created only when checks are on or the reader chooses Check for Updates…, and its own automatic-check setting is set from Leading's record of the answer each time it starts. A reader who says no never causes a network request; one test run confirmed no Sparkle preferences were written at all.

### First launch
Launched with no file for the first time, Leading opens the welcome document, then asks two things over it: open Markdown files with Leading (ticked; hidden if it already does) and check for updates (unticked). The welcome document is copied to `~/Library/Application Support/Leading/` and opened from there, because highlighting or editing it would otherwise write inside the app and break its signature. If Leading is running from the disk image or from macOS's translocation folder, it asks the reader to move it to Applications first and asks the two questions next time: a default app or an update in a temporary place would not last.

### The disk image
`dmgbuild` writes Finder's layout file directly, so the DMG needs no scripting of Finder and builds the same on CI. It is installed into `build/.dmg-venv` at pinned versions with pinned hashes, and needs Python 3.10 or later. The background and the "If macOS blocks Leading" guide are HTML in `mac/Resources/dmg/`, rendered by WebKit (`scripts/render.swift`) in the app's own fonts. Finder counts its title bar in the window size, so the window is 28 pt taller than the background.

### Gatekeeper on this Mac cannot show the first-run block
A quarantined copy of a build that had already run here was let through (macOS remembers code it has allowed by its hash) and ran from the translocation folder. A copy with an unseen hash was held at launch as expected. The warning is drawn by a system process that screenshots here cannot capture, and the "was blocked" line in Privacy & Security appears only after the warning is dismissed, so the guide's drawings follow the published wording for macOS 15 and later, to be checked against a real first install.

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
