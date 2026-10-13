# Leading

A small, free, open-source Mac app for reading Markdown with beautiful typography. Intentionally minimal: no file manager, no sync, no AI, no account.

**Status: Stage 3 of 5.** The Mac app reads Markdown (Stage 2) and edits it (Stage 3: ⌘E, autosave and versions, Find and Replace). Highlighting while reading comes in Stage 4; the friendly installer in Stage 5. The typography prototype from Stage 1 is still here for tuning defaults.

## Run the prototype

You need Node.js (any recent version). In Terminal:

```
cd web
npm install
npm run proto
```

Safari opens the prototype. Press `\` to hide the control panel. Put your own notes in `web/test/fixtures/private/` (never committed) or drop a file onto the page.

## Build the app

You need Xcode (free from the App Store) and Node.js:

```
scripts/build-app.sh
open build/Leading.app
```

## Tests

```
cd web
npm test              # logic: parsing, highlights, smart punctuation, search, layout
npm run test:browser  # in WebKit: rendering, WCAG 1.4.12 text spacing, 5 MB speed, editing
cd ../mac && swift test
cd .. && scripts/selftest-app.sh   # the built app checks its own menus, editing, saving
```

## Fonts

Bundled unmodified under the SIL Open Font License 1.1: Literata (TypeTogether, for Google), Atkinson Hyperlegible Next (Braille Institute), and iA Writer Quattro and Mono (Information Architects, based on IBM Plex). Leading is not affiliated with iA and does not imitate iA Writer. New York, Charter and SF Mono come with macOS and are not bundled.

## Licence

MIT. See [LICENSE](LICENSE).
