// The page inside each Leading window. Swift owns files, settings and menus;
// this page owns rendering. They talk through `window.leading` (Swift → page)
// and the "leading" message handler (page → Swift).

import { ReaderView, type Command } from '../reader/view'
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

const post = (m: ToSwift | { type: 'log'; text: string }) => (window as any).webkit?.messageHandlers?.leading?.postMessage(m)

// Report page errors to the app's log (Console.app, or `log show`), since a
// shipped app has no web inspector open.
window.addEventListener('error', (e) => post({ type: 'log', text: `error: ${e.message} at ${e.filename}:${e.lineno}` }))
window.addEventListener('unhandledrejection', (e) => post({ type: 'log', text: `unhandled: ${String(e.reason?.stack ?? e.reason)}` }))
const $ = (id: string) => document.getElementById(id)!

const view = new ReaderView({
  win: $('window'), scroller: $('scroller'), doc: $('doc'), layer: $('layer'), ticks: $('ticks'), frame: $('frame'), outline: $('outline'),
})

// Start the parsing workers now, before any file arrives, so they are warm.
warmPool()

view.onSettingsChanged = (settings) => post({ type: 'settings', settings })
view.reader.onFirstPaint = (ms) => post({ type: 'painted', ms })
view.tables.onHoverChange = (over) => post({ type: 'overTable', over })
view.tables.onCopyCSV = (text) => post({ type: 'copy', text })

// Links: in-page anchors scroll here; everything else is Swift's decision
// (web links go to the browser, other Markdown files open in Leading).
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
  if (!a) return
  const href = a.getAttribute('href')!
  e.preventDefault()
  if (href.startsWith('#')) {
    const target = document.getElementById(decodeURIComponent(href.slice(1)))
    target?.scrollIntoView({ block: 'start' })
    return
  }
  post({ type: 'openLink', href })
})

;(window as any).leading = {
  /** Show a document (called by Swift when a file opens or changes on disk). */
  async load(args: { text?: string; textURL?: string; imageBase: string | null; plain?: boolean; keepPlace?: boolean }) {
    // Small files arrive inline; large ones are fetched from the app's private address.
    const text = args.text ?? (await (await fetch(args.textURL!)).text())
    let r
    try {
      r = await view.open(text, { imageBase: args.imageBase, plain: args.plain, keepPlace: args.keepPlace })
    } catch (e) {
      post({ type: 'log', text: `open failed: ${(e as Error)?.stack ?? e}` })
      throw e
    }
    if (r) post({ type: 'loaded', timings: r.timings })
  },
  /** New settings from the Aa panel or another window. */
  async settings(args: { settings: Partial<Settings>; tuning?: Tuning }) {
    view.settings = { ...view.settings, ...args.settings }
    if (args.tuning) view.tuning = args.tuning
    await view.apply()
  },
  command(args: { name: Command }) { view.command(args.name) },
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
