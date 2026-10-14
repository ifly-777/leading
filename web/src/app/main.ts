// The page inside each Leading window. Swift owns files, settings and menus;
// this page owns rendering. They talk through `window.leading` (Swift → page)
// and the "leading" message handler (page → Swift).

import { ReaderView, type Command, type Place } from '../reader/view'
import { warmPool } from '../reader/render'
import { tableToCSV } from '../reader/tables'
import type { Settings, Tuning } from '../core/settings'
import { renderMarkdown } from '../core/pipeline'

type ToSwift =
  | { type: 'ready' }
  | { type: 'painted'; ms: number }
  | { type: 'loaded'; timings: unknown }
  | { type: 'settings'; settings: Settings }
  | { type: 'openLink'; href: string }
  | { type: 'overTable'; over: boolean }
  | { type: 'copy'; text: string }
  | { type: 'edit'; edits: { from: number; to: number; insert: string }[] }
  | { type: 'settled'; length: number; hash: number }
  | { type: 'history'; undo: boolean; redo: boolean }
  | { type: 'mode'; editing: boolean }
  | { type: 'place'; s: number; dy: number }
  | { type: 'openWiki'; target: string; heading?: string }
  | { type: 'canGoBack'; can: boolean }

const post = (m: ToSwift | { type: 'log'; text: string }) => (window as any).webkit?.messageHandlers?.leading?.postMessage(m)

// Report page errors to the app's log (Console.app, or `log show`), since a
// shipped app has no web inspector open.
window.addEventListener('error', (e) => post({ type: 'log', text: `error: ${e.message} at ${e.filename}:${e.lineno}` }))
window.addEventListener('unhandledrejection', (e) => post({ type: 'log', text: `unhandled: ${String(e.reason?.stack ?? e.reason)}` }))
const $ = (id: string) => document.getElementById(id)!

const view = new ReaderView({
  win: $('window'), scroller: $('scroller'), doc: $('doc'), layer: $('layer'), ticks: $('ticks'), frame: $('frame'), outline: $('outline'), editor: $('editor'),
})

// Start the parsing workers now, before any file arrives, so they are warm.
warmPool()

view.onSettingsChanged = (settings) => post({ type: 'settings', settings })
view.onPlace = (p) => post({ type: 'place', ...p })
view.onCanGoBack = (can) => post({ type: 'canGoBack', can })
view.onCopyText = (text) => post({ type: 'copy', text })

// The document being shown, so a heading jump that arrives with it waits for it.
let loading: Promise<unknown> = Promise.resolve()
// Editing: Swift keeps a mirror of the text and saves from it.
view.editHost = {
  onEdit: (edits) => post({ type: 'edit', edits }),
  onSettled: (length, hash) => post({ type: 'settled', length, hash }),
  onHistory: (undo, redo) => post({ type: 'history', undo, redo }),
  onMode: (editing) => post({ type: 'mode', editing }),
}
view.reader.onFirstPaint = (ms) => post({ type: 'painted', ms })
view.tables.onHoverChange = (over) => post({ type: 'overTable', over })
view.tables.onCopyCSV = (text) => post({ type: 'copy', text })

// Links: in-page anchors and headings scroll here (and View › Back returns);
// everything else is Swift's decision (web links go to the browser, other
// Markdown files open in Leading, wikilinks are looked up in the vault).
document.addEventListener('click', (e) => {
  const t = e.target as Element
  const wiki = t.closest?.('#doc .wikilink') as HTMLElement | null
  if (wiki && !window.getSelection()?.toString()) {
    const target = wiki.dataset.target ?? ''
    const heading = wiki.dataset.heading
    // [[#Heading]] is a heading in this note.
    if (!target) { if (heading) view.jumpToHeading(heading); return }
    post({ type: 'openWiki', target, heading })
    return
  }
  const a = t.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a) return
  const href = a.getAttribute('href')!
  e.preventDefault()
  // A footnote number shows its note beside it; ⌥-click jumps to the endnotes as before.
  if (a.hasAttribute('data-footnote-ref') && !e.altKey && view.footnotes.toggle(a)) return
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1))
    const target = document.getElementById(id)
    if (target && document.getElementById('scroller')!.contains(target)) {
      view.rememberPlace()
      view.footnotes.hide()
      target.scrollIntoView({ block: 'start' })
    } else {
      view.jumpToHeading(id)
    }
    return
  }
  post({ type: 'openLink', href })
})

;(window as any).leading = {
  /** Show a document (called by Swift when a file opens or changes on disk). */
  async load(args: { text?: string; textURL?: string; imageBase: string | null; plain?: boolean; keepPlace?: boolean; fromDisk?: boolean; edit?: boolean; resume?: Place; name?: string; preview?: boolean }) {
    view.docName = args.name ?? null
    view.readOnly = !!args.preview
    if (view.readOnly) document.documentElement.dataset.readOnly = ''
    // Heading jumps that arrive with the document wait until its text is shown.
    let shown!: () => void
    loading = new Promise<void>((ok) => { shown = ok })
    // Small files arrive inline; large ones are fetched from the app's private address.
    const text = args.text ?? (await fetch(args.textURL!).then((r) => r.text()).catch((e) => { shown(); throw e }))
    // A new document opens straight into the editor; marking the page now
    // keeps the empty reading view from flashing up first.
    if (args.edit) document.documentElement.dataset.mode = 'edit'
    let r
    try {
      r = await view.open(text, { imageBase: args.imageBase, vaultEmbeds: !args.preview, plain: args.plain, keepPlace: args.keepPlace, fromDisk: args.fromDisk, resume: args.resume })
    } catch (e) {
      post({ type: 'log', text: `open failed: ${(e as Error)?.stack ?? e}` })
      throw e
    } finally {
      shown()
    }
    if (args.edit && view.mode === 'read') await view.toggleEdit()
    if (r) {
      // Report how many local images loaded, once they have had a moment (used by tests).
      // Lazy images further down would otherwise wait until scrolled to; never wait more than 3 s.
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('#doc img'))
      const settled = Promise.all(imgs.map((i) => {
        if (i.complete && i.naturalWidth) return null
        i.loading = 'eager'
        return new Promise((ok) => { i.addEventListener('load', ok); i.addEventListener('error', ok) })
      }))
      await Promise.race([settled, new Promise((ok) => setTimeout(ok, 3000))])
      post({ type: 'loaded', timings: { ...r.timings, images: imgs.length, imagesLoaded: imgs.filter((i) => i.naturalWidth > 0).length } })
    }
  },
  /** New settings from the Aa panel or another window. */
  async settings(args: { settings: Partial<Settings>; tuning?: Tuning }) {
    view.settings = { ...view.settings, ...args.settings }
    if (args.tuning) view.tuning = args.tuning
    await view.apply()
  },
  command(args: { name: Command }) { return view.command(args.name) },
  /** File › Print and Export as PDF: get the page ready for paper, then put it back. */
  preparePrint() { return view.preparePrint() },
  afterPrint() { return view.afterPrint() },
  /** The file was saved under a new name, or moved. */
  setName(args: { name: string | null }) { view.docName = args.name },
  /** Go to a heading named in a link that opened this document (or one already open). */
  async jumpToHeading(args: { text: string }) {
    await loading.catch(() => {})
    return view.jumpToHeading(args.text)
  },
  /** The whole current text: Swift asks for it if its copy ever disagrees. */
  text() { return view.editor?.exists ? view.editor.text : null },
  /** Right-click "Copy Table as CSV": the table under the pointer. */
  copyTableAsCSV() { if (view.tables.hovered) post({ type: 'copy', text: tableToCSV(view.tables.hovered) }) },
  /** For the measuring script and tests. */
  view,
}

// Get ready for a document before one arrives: apply the default settings,
// load the reading fonts (they otherwise load only when text first appears,
// delaying the first paint) and run the parser once on a small sample so the
// script engine has compiled it. Then tell Swift this page is ready.
async function warmUp(): Promise<void> {
  await view.apply()
  const families = ['Literata', 'iA Writer Mono V']
  await Promise.all(families.flatMap((f) => ['400', '600', 'italic 400'].map((w) => document.fonts.load(`${w} 19px "${f}"`).catch(() => []))))
  renderMarkdown(['# Warm', 'A *short* paragraph with **bold**, `code`, "quotes" -- and a [link](#x).', '| a | b |\n|---|---|\n| 1 | 2 |'].join('\n\n'))
}
warmUp().finally(() => post({ type: 'ready' }))
