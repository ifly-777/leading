// Stage 1 prototype: the real pipeline, stylesheet and reader pieces, with a
// rail of live controls for tuning defaults by eye. The rail is throwaway;
// everything it drives (settings.ts, leading.css, reader/*) is the real thing.

import { DEFAULTS, RANGES, TUNING, FONTS, MONO_FONTS, type Settings, type Tuning, type FontId, type Measure, type Theme } from '../core/settings'
import { SLOTS } from '../core/highlight-colors'
import { warmPool, type LoadTimings } from '../reader/render'
import { ReaderView } from '../reader/view'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const rail = $('rail')
const scroller = $('scroller')

const view = new ReaderView({
  win: $('window'), scroller, doc: $('doc'), layer: $('layer'), ticks: $('ticks'), frame: $('frame'), outline: $('outline'),
})
const { find } = view

// ---------------------------------------------------------------------------
// State, persisted locally so a reload keeps your tuning.

const STORE = 'leading-prototype-v1'
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
  if (saved?.settings) view.settings = { ...view.settings, ...saved.settings }
  if (saved?.tuning) view.tuning = { ...view.tuning, ...saved.tuning, themes: { ...view.tuning.themes, ...saved.tuning.themes } }
} catch { /* private window or blocked storage: start from defaults */ }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ settings: view.settings, tuning: view.tuning })) } catch { /* ignore */ } }
// Shorthands the rail code reads and writes.
const S = () => view.settings
const T = () => view.tuning

async function refresh(): Promise<void> {
  await view.apply()
  save()
  syncRail()
  showTimings()
}
view.onSettingsChanged = () => { save(); syncRail(); showTimings() }
new ResizeObserver(() => showTimings()).observe(scroller)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => syncRail())

// ---------------------------------------------------------------------------
// Documents

const FIXTURES = ['prose.md', 'highlights.md', 'obsidian.md', 'tables.md', 'torture.md']
const privateDocs = import.meta.glob('/test/fixtures/private/*.{md,markdown,txt}', { query: '?url', import: 'default' })

let timings: LoadTimings | null = null
let currentName = ''
let plainText = false
let currentSrc = ''
let currentBase: string | null = null

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

async function openText(name: string, src: string, imageBase: string | null): Promise<void> {
  currentName = name
  currentSrc = src
  currentBase = imageBase
  const r = await view.open(src, { imageBase, plain: plainText })
  if (!r) return // a newer open replaced this one
  timings = r.timings
  showTimings()
  syncRail()
}

async function openFixture(name: string): Promise<void> {
  const url = name.startsWith('/') ? name : `/test/fixtures/${name}`
  const res = await fetch(url)
  if (!res.ok) {
    $('doc').innerHTML = name.includes('stress')
      ? '<p>The stress file has not been generated. Run <code>npm run stress</code> in the <code>web</code> folder, then reload.</p>'
      : `<p>Could not load ${escapeHtml(name)}.</p>`
    return
  }
  await openText(name, await res.text(), url.slice(0, url.lastIndexOf('/') + 1))
}

function showTimings(): void {
  const el = document.getElementById('timings')
  if (!el) return
  const t = timings
  const f = (n?: number) => (n == null ? '–' : n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString())
  const lines = [
    `${currentName}  ${t ? (t.bytes / 1024).toFixed(0) + ' KB, ' + t.blocks.toLocaleString() + ' blocks' : ''}`,
    t?.previewParse != null ? `opening slice    ${f(t.previewParse)} ms` : '',
    t ? `first paint      ${f(t.firstPaint)} ms` : '',
    t?.pieces != null ? `parallel pieces  ${t.pieces}\nall parsed       ${f(t.parsed)} ms` : '',
    t ? `all in page      ${f(t.complete)} ms` : '',
    find.isOpen && find.query ? `last search      ${f(find.lastSearchMs)} ms` : '',
    view.layout ? `${Math.round(view.layout.colW)} px column (${view.charsPerLine.toFixed(0)} chars), outline: ${view.layout.outline}` : '',
  ]
  el.textContent = lines.filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// The control rail

type Bind = () => void
const syncers: Bind[] = []
const syncRail = () => syncers.forEach((f) => f())

function section(title: string, open = true): HTMLElement {
  const d = document.createElement('details')
  d.open = open
  d.innerHTML = `<summary>${title}</summary>`
  rail.append(d)
  return d
}

function slider(parent: HTMLElement, label: string, range: { min: number; max: number; step: number },
                get: () => number, set: (v: number) => void, fmt = (v: number) => String(v)): void {
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `<label>${label}</label><input type="range" min="${range.min}" max="${range.max}" step="${range.step}"><output></output>`
  const input = row.querySelector('input')!
  const out = row.querySelector('output')!
  input.setAttribute('aria-label', label)
  input.addEventListener('input', () => { set(Number(input.value)); out.textContent = fmt(Number(input.value)); refresh() })
  syncers.push(() => { input.value = String(get()); out.textContent = fmt(get()) })
  parent.append(row)
}

function segmented<T extends string>(parent: HTMLElement, label: string, options: [T, string][], get: () => T, set: (v: T) => void): void {
  const row = document.createElement('div')
  row.className = 'row wide'
  row.innerHTML = `<label>${label}</label><div class="seg" role="group" aria-label="${label}"></div>`
  const seg = row.querySelector('.seg')!
  for (const [value, text] of options) {
    const b = document.createElement('button')
    b.textContent = text
    b.addEventListener('click', () => { set(value); refresh() })
    syncers.push(() => b.setAttribute('aria-pressed', String(get() === value)))
    seg.append(b)
  }
  parent.append(row)
}

function checkbox(parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void): void {
  const row = document.createElement('div')
  row.className = 'row wide'
  row.innerHTML = `<label>${label}</label><input type="checkbox" aria-label="${label}">`
  const input = row.querySelector('input')!
  input.addEventListener('change', () => { set(input.checked); refresh() })
  syncers.push(() => { input.checked = get() })
  parent.append(row)
}

function buildRail(): void {
  rail.innerHTML = `<h1>Leading <small>prototype · <kbd>\\</kbd> hides this</small></h1>`

  // Documents
  const d0 = section('Document')
  const row = document.createElement('div')
  row.className = 'row wide'
  row.innerHTML = `<label>Test file</label><select aria-label="Test document"></select>`
  const sel = row.querySelector('select')!
  const opts: [string, string][] = FIXTURES.map((f) => [f, f])
  for (const p of Object.keys(privateDocs)) opts.push([p, 'yours: ' + p.split('/').pop()])
  opts.push(['stress-5mb.md', '5 MB stress file'])
  sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${escapeHtml(t)}</option>`).join('')
  sel.addEventListener('change', () => openFixture(sel.value))
  syncers.push(() => { if (opts.some(([v]) => v === currentName)) sel.value = currentName })
  d0.append(row)
  const btns = document.createElement('div')
  btns.className = 'btns'
  btns.innerHTML = `<button id="openfile">Open a file…</button><input type="file" id="file" hidden accept=".md,.markdown,.txt,text/markdown,text/plain">`
  d0.append(btns)
  const file = btns.querySelector<HTMLInputElement>('#file')!
  btns.querySelector('#openfile')!.addEventListener('click', () => file.click())
  file.addEventListener('change', async () => { const f = file.files?.[0]; if (f) openText(f.name, await f.text(), null) })
  checkbox(d0, 'Show as plain text', () => plainText, (v) => { plainText = v; openText(currentName, currentSrc, currentBase) })
  const hint = document.createElement('p')
  hint.className = 'hint'
  hint.innerHTML = 'Or drop a file anywhere. Files you put in <code>web/test/fixtures/private/</code> appear in the list; they never leave your Mac and are never committed.'
  d0.append(hint)
  const tm = document.createElement('div')
  tm.className = 'timings'
  tm.id = 'timings'
  d0.append(tm)

  // The five "Aa" controls
  const d1 = section('Reading (the Aa panel)')
  const frow = document.createElement('div')
  frow.className = 'row wide'
  frow.innerHTML = `<label>Font</label><select aria-label="Font">${Object.entries(FONTS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('')}<option value="custom">Other installed font…</option></select>`
  const fsel = frow.querySelector('select')!
  fsel.addEventListener('change', () => { S().font = fsel.value as FontId; refresh() })
  syncers.push(() => { fsel.value = S().font })
  d1.append(frow)
  const crow = document.createElement('div')
  crow.className = 'row wide'
  crow.innerHTML = `<label>Font name</label><input type="text" placeholder="e.g. Iowan Old Style" aria-label="Other font name">`
  const cin = crow.querySelector('input')!
  cin.addEventListener('change', () => { S().customFont = cin.value; refresh() })
  syncers.push(() => { crow.hidden = S().font !== 'custom'; cin.value = S().customFont })
  d1.append(crow)
  slider(d1, 'Size', RANGES.size, () => S().size, (v) => (S().size = v), (v) => v + ' px')
  slider(d1, 'Line height', RANGES.lineHeight, () => S().lineHeight, (v) => (S().lineHeight = v), (v) => v.toFixed(2))
  segmented<Measure>(d1, 'Line width', [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']], () => S().measure, (v) => (S().measure = v))
  segmented<Theme>(d1, 'Theme', [['system', 'Auto'], ['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark']], () => S().theme, (v) => (S().theme = v))

  const d2 = section('Advanced', false)
  slider(d2, 'Letter spacing', RANGES.letterSpacing, () => S().letterSpacing, (v) => (S().letterSpacing = v), (v) => v.toFixed(3) + ' em')
  slider(d2, 'Word spacing', RANGES.wordSpacing, () => S().wordSpacing, (v) => (S().wordSpacing = v), (v) => v.toFixed(2) + ' em')
  segmented(d2, 'Paragraphs', [['space', 'Space'], ['indent', 'Indent']] as [Settings['paragraphStyle'], string][], () => S().paragraphStyle, (v) => (S().paragraphStyle = v))
  slider(d2, 'Para. spacing', RANGES.paragraphSpacing, () => S().paragraphSpacing, (v) => (S().paragraphSpacing = v), (v) => v.toFixed(1) + ' em')
  segmented(d2, 'Alignment', [['left', 'Left'], ['justify', 'Justified']] as [Settings['align'], string][], () => S().align, (v) => (S().align = v))
  segmented(d2, 'Code font', Object.entries(MONO_FONTS).map(([k, f]) => [k, f.label]) as [Settings['monoFont'], string][], () => S().monoFont, (v) => (S().monoFont = v))

  const d3 = section('Highlights, tables, outline, find')
  segmented(d3, 'Highlights', [['marker', 'Marker'], ['lowlight', 'Lowlight'], ['underline', 'Underline']] as [Settings['highlightStyle'], string][], () => S().highlightStyle, (v) => (S().highlightStyle = v))
  checkbox(d3, 'Zebra rows', () => S().zebra, (v) => (S().zebra = v))
  checkbox(d3, 'Outline (⌥⌘O)', () => S().outlineOpen, (v) => (S().outlineOpen = v))
  const fb = document.createElement('div')
  fb.className = 'btns'
  fb.innerHTML = `<button>Find (⌘F)</button>`
  fb.querySelector('button')!.addEventListener('click', () => find.open())
  d3.append(fb)

  // Values tuned by eye; Export turns them into the app's defaults.
  const d4 = section('Tuning (becomes the defaults)', false)
  slider(d4, 'Heading ratio', { min: 1.1, max: 1.35, step: 0.01 }, () => T().headingRatio, (v) => (T().headingRatio = v), (v) => v.toFixed(2))
  slider(d4, 'Dark weight', { min: 300, max: 420, step: 5 }, () => T().darkWeight, (v) => (T().darkWeight = v))
  slider(d4, 'Outline size', { min: 11, max: 16, step: 0.5 }, () => T().outlineSize, (v) => (T().outlineSize = v), (v) => v + ' px')
  slider(d4, 'Outline fade', { min: 0.15, max: 1, step: 0.05 }, () => T().outlineIdleOpacity, (v) => (T().outlineIdleOpacity = v), (v) => v.toFixed(2))
  const themeNote = document.createElement('p')
  themeNote.className = 'hint'
  d4.append(themeNote)
  syncers.push(() => { themeNote.textContent = `Colours below edit the ${view.theme} theme.` })
  const tcols = document.createElement('div')
  tcols.className = 'colors'
  const themeKeys: [keyof Tuning['themes']['light'], string][] = [['bg', 'paper'], ['fg', 'ink'], ['muted', 'muted'], ['link', 'link'], ['search', 'search']]
  for (const [k, label] of themeKeys) colorInput(tcols, label, () => cur()[k] as string, (v) => ((cur() as any)[k] = v))
  d4.append(tcols)
  const fills = document.createElement('div')
  fills.className = 'colors'
  for (const s of SLOTS) colorInput(fills, s + ' fill', () => cur().hlFill[s], (v) => (cur().hlFill[s] = v))
  for (const s of SLOTS) colorInput(fills, s + ' line', () => cur().hlLine[s], (v) => (cur().hlLine[s] = v))
  d4.append(fills)

  const d5 = section('Checks and export')
  checkbox(d5, 'WCAG 1.4.12 stress', () => view.wcag, (v) => { view.wcag = v })
  const exp = document.createElement('div')
  exp.innerHTML = `<div class="btns"><button id="export">Export settings</button><button id="reset">Reset to defaults</button></div><textarea id="exported" readonly aria-label="Exported settings" placeholder="Press Export, then send me this text."></textarea>`
  d5.append(exp)
  exp.querySelector('#export')!.addEventListener('click', async () => {
    const text = JSON.stringify({ settings: view.settings, tuning: view.tuning }, null, 2)
    const ta = exp.querySelector('textarea')!
    ta.value = text
    try { await navigator.clipboard.writeText(text) } catch { ta.select() }
  })
  exp.querySelector('#reset')!.addEventListener('click', () => { view.settings = clone(DEFAULTS); view.tuning = clone(TUNING); refresh() })
  const keys = document.createElement('p')
  keys.className = 'hint'
  keys.innerHTML = '<kbd>⌘F</kbd> find · <kbd>⌘G</kbd>/<kbd>⇧⌘G</kbd> next/previous · <kbd>⌥⌘O</kbd> outline (type to filter) · <kbd>⌥⌘[</kbd>/<kbd>⌥⌘]</kbd> narrower/wider · <kbd>⌥⌘T</kbd> theme · <kbd>\\</kbd> hide this panel'
  d5.append(keys)
}

function cur() { return T().themes[view.theme] }

function colorInput(parent: HTMLElement, label: string, get: () => string, set: (v: string) => void): void {
  const l = document.createElement('label')
  l.innerHTML = `<input type="color" aria-label="${label}"><span>${label}</span>`
  const input = l.querySelector('input')!
  input.addEventListener('input', () => { set(input.value.toUpperCase()); refresh() })
  syncers.push(() => { input.value = get().slice(0, 7) })
  parent.append(l)
}

// ---------------------------------------------------------------------------
// Keyboard: the same shortcuts the app has, where Safari lets a page have them.

document.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest('input, textarea, select')
  if (e.key === '\\' && !typing) { document.body.classList.toggle('rail-hidden'); view.relayout(); return }
  if (!e.metaKey) return
  const k = e.key.toLowerCase()
  if (k === 'f' && !e.altKey) { e.preventDefault(); view.command('find'); return }
  if (k === 'g') { e.preventDefault(); view.command(e.shiftKey ? 'findPrevious' : 'findNext'); return }
  if (!e.altKey) return
  // With ⌥ held, e.key is a special character, so match on the physical key.
  const byCode: Record<string, Parameters<typeof view.command>[0]> = { KeyO: 'toggleOutline', BracketLeft: 'narrower', BracketRight: 'wider', KeyT: 'cycleTheme' }
  const c = byCode[e.code]
  if (c) { e.preventDefault(); view.command(c) }
})

// Drag and drop a file anywhere to read it.
const drop = $('drop')
window.addEventListener('dragover', (e) => { e.preventDefault(); drop.hidden = false })
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.hidden = true })
window.addEventListener('drop', async (e) => {
  e.preventDefault()
  drop.hidden = true
  const f = e.dataTransfer?.files?.[0]
  if (f) openText(f.name, await f.text(), null)
})

// Expose a hook for the automated browser checks.
;(window as any).leading = { openFixture, openText, refresh, settings: () => view.settings, setWcag: (v: boolean) => { view.wcag = v; return refresh() }, timings: () => timings, find, view }

buildRail()
warmPool() // as the app will at launch
await refresh()
await openFixture('prose.md')
