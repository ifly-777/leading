# Leading

A small, free, open-source Mac app for reading Markdown with beautiful typography. Intentionally minimal: no file manager, no sync, no AI, no account.

**Status: Stage 1, the typography prototype.** There is no Mac app yet. This stage is a web page that uses the real Markdown pipeline, stylesheet and fonts, with live controls for tuning every typographic default by eye.

## Run the prototype

You need Node.js (any recent version). In Terminal:

```
cd web
npm install
npm run proto
```

Safari opens the prototype. Press `\` to hide the control panel. Put your own notes in `web/test/fixtures/private/` (never committed) or drop a file onto the page.

## Tests

```
cd web
npm test              # logic: parsing, highlights, smart punctuation, search, layout
npm run test:browser  # in WebKit: rendering, WCAG 1.4.12 text spacing, 5 MB speed
```

## Fonts

Bundled unmodified under the SIL Open Font License 1.1: Literata (TypeTogether, for Google), Atkinson Hyperlegible Next (Braille Institute), and iA Writer Quattro and Mono (Information Architects, based on IBM Plex). Leading is not affiliated with iA and does not imitate iA Writer. New York, Charter and SF Mono come with macOS and are not bundled.

## Licence

MIT. See [LICENSE](LICENSE).
