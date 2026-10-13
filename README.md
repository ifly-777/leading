# Leading

A small, free Mac app for reading Markdown as a well-set page. Open a note and you get a calm column of text in a good typeface, and nothing else on screen. It also edits, and it highlights while you read, in the same syntax Obsidian uses.

Leading is intentionally minimal: no file manager, no sync, no AI, no account. It reads the files you already have, wherever they live.

## Install

Leading needs macOS 26 (Tahoe) or later, on Apple Silicon or Intel.

1. Download **Leading-x.y.z.dmg** from the [latest release](https://github.com/ifly-777/leading/releases/latest).
2. Open it and drag Leading into Applications.
3. Open Leading from Applications.

The first time, macOS will say it could not verify Leading. That is because Leading is not signed with Apple's paid developer certificate, not because anything is wrong with it. To let it through, once:

1. Click **Done** in that message (not Move to Trash).
2. Open **System Settings › Privacy & Security**, scroll down to **Security**, and click **Open Anyway** beside "Leading" was blocked to protect your Mac.
3. Click **Open Anyway** again when macOS asks, and confirm with Touch ID or your password.

The disk image has the same steps, with pictures, as *If macOS blocks Leading.pdf*. Updates do not ask again.

## What it does

- **Reading.** Literata, New York, Charter, Atkinson Hyperlegible Next or iA Writer Quattro, or any installed font. Size, line spacing and column width; light, sepia and dark themes; an outline of the headings. Tables, footnotes, code, task lists, and local images next to the file.
- **Obsidian notes.** Callouts, wikilinks, properties (as one quiet line) and highlights.
- **Highlighting.** Select text and press ⇧⌘H, or ⌥⌘1 to ⌥⌘5 for yellow, green, blue, pink and orange. Highlights are written as `==text==` or as Highlightr's `<mark>`, so Obsidian shows them too.
- **Editing.** ⌘E switches to the Markdown source and back. Changes save as you go, File › Revert To brings back any earlier version, and if another app changes the file Leading shows the new text without losing your place.
- **Find**, which ignores case, accents and curly quotes, and **Find and Replace** (⌥⌘F) while editing.

The welcome document that opens the first time lists every shortcut. Help › Welcome to Leading opens it again.

## Privacy

Leading collects nothing and sends nothing. It uses the network for one thing only: if you turn on **Check for updates automatically** (it asks once, and it is off unless you say yes), it asks GitHub once a day whether a newer version exists. Updates are verified with an EdDSA signature before they are installed. Leading › Check for Updates… checks once, on demand.

## Build it yourself

You need Xcode (free from the App Store), Node.js and Python 3.10 or later.

```
scripts/build-app.sh       # build/Leading.app
scripts/make-dmg.sh        # build/Leading-x.y.z.dmg
```

Tests:

```
cd web
npm test              # logic: parsing, highlights, smart punctuation, search, layout
npm run test:browser  # in WebKit: rendering, WCAG 1.4.12 text spacing, 5 MB speed, editing
cd ../mac && swift test
cd .. && scripts/selftest-app.sh   # the built app checks its own menus, editing, saving
```

`web/` also holds the typography prototype used to choose the defaults (`npm run proto`). [docs/decisions.md](docs/decisions.md) records the choices that are not obvious from the code, and what testing showed.

### Releasing

`scripts/release.sh` builds the app for both kinds of Mac, packs the DMG, signs the update archive with the key in the release Mac's Keychain and writes the update feed. `scripts/release.sh --publish` then tags the release and publishes it on GitHub.

## Fonts

Bundled unmodified under the SIL Open Font License 1.1: Literata (TypeTogether, for Google), Atkinson Hyperlegible Next (Braille Institute), and iA Writer Quattro and Mono (Information Architects, based on IBM Plex). Leading is not affiliated with iA and does not imitate iA Writer. New York, Charter and SF Mono come with macOS and are not bundled.

## Licence

MIT. See [LICENSE](LICENSE).
