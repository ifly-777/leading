// Stage 1 prototype: the real pipeline, stylesheet and reader pieces, with a
// rail of live controls for tuning defaults by eye. The rail is throwaway;
// everything it drives (settings.ts, leading.css, reader/*) is the real thing.

import {
  DEFAULTS, RANGES, TUNING, FONTS, MONO_FONTS, MEASURE_CHARS, applySettings, resolveTheme,
  type Settings, type Tuning, type FontId, type Measure, type Theme,
} from '../core/settings'
import { SLOTS } from '../core/highlight-colors'
import { Reader, warmPool, type LoadTimings } from '../reader/render'
import { computeLayout, applyLayout } from '../reader/layout'
import { avgCharEm } from '../reader/measure'
import { OutlinePanel } from '../reader/outline'
import { FindBar } from '../reader/find'
import { TableWatcher } from '../reader/tables'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const root = document.documentElement
const rail = $('rail')
const win = $('window')
const scroller = $('scroller')
const doc = $('doc')

// ---------------------------------------------------------------------------
// State, persisted locally so a reload keeps your tuning.

const STORE = 'leading-prototype-v1'
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
let settings: Settings = clone(DEFAULTS)
let tuning: Tuning = clone(TUNING)
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
  if (saved?.settings) settings = { ...settings, ...saved.settings }
  if (saved?.tuning) tuning = { ...tuning, ...saved.tuning, themes: { ...tuning.themes, ...saved.tuning.themes } }
} catch { /* private window or blocked storage: start from defaults */ }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ settings, tuning })) } catch { /* ignore */ } }

let wcag = false
const dark = matchMedia('(prefers-color-scheme: dark)')

// ---------------------------------------------------------------------------
// Reader pieces

const reader = new Reader(doc)
const outline = new OutlinePanel($('outline'), scroller)
const find = new FindBar(win, scroller, doc, $('layer'), $('ticks'), $('frame'))
const tables = new TableWatcher(scroller)
let blocksLoaded: { s: number }[] = []

outline.locate = (item, force) => {
  const blk = reader.blockEl(item.b, force)
  if (!blk) return null
  // Most headings are blocks themselves; some sit inside a callout or list.
  return blk.matches('h1,h2,h3,h4,h5,h6') ? blk : blk.querySelector<HTMLElement>(`:is(h1,h2,h3,h4,h5,h6)[data-s="${item.s}"]`)
}
find.blockY = (b) => reader.blockY(b, scroller)
find.onLayoutShift = () => reader.invalidateGeometry()
reader.onBlocksAdded = () => reader.invalidateGeometry()
outline.onClose = () => { settings.outlineOpen = false; refresh() }

// ---------------------------------------------------------------------------
// Applying settings

let avg = 0.5
let avgKey = ''

function effective(): Settings {
  // The WCAG 1.4.12 check overrides spacing with the criterion's own values.
  return wcag ? { ...settings, lineHeight: Math.max(1.5, settings.lineHeight), letterSpacing: 0.12, wordSpacing: 0.16, paragraphStyle: 'space', paragraphSpacing: 2 } : settings
}

async function refresh(): Promise<void> {
  const s = effective()
  applySettings(root, s, tuning, { prefersDark: dark.matches, avgCharEm: avg })
  const key = [getComputedStyle(doc).fontFamily, s.letterSpacing, s.wordSpacing, root.style.getPropertyValue('--weight')].join('|')
  if (key !== avgKey) {
    avgKey = key
    avg = await avgCharEm(doc)
    applySettings(root, s, tuning, { prefersDark: dark.matches, avgCharEm: avg })
  }
  relayout()
  save()
  syncRail()
}

function relayout(): void {
  const s = effective()
  const r = computeLayout({
    width: scroller.clientWidth, fontPx: s.size,
    measureEm: MEASURE_CHARS[s.measure] * avg, narrowEm: MEASURE_CHARS.narrow * avg, outlineOpen: s.outlineOpen,
  })
  applyLayout(root, r)
  const o = outline.el
  o.hidden = r.outline === 'hidden'
  o.classList.toggle('popover', r.outline === 'popover')
  tables.recheckAll(doc)
  reader.invalidateGeometry()
  outline.updateCurrent()
  find.draw()
  layoutInfo = `${Math.round(r.colW)} px column (${(r.colW / s.size / avg).toFixed(0)} chars), outline: ${r.outline}`
  showTimings()
}

new ResizeObserver(() => relayout()).observe(scroller)
dark.addEventListener('change', () => refresh())

// ---------------------------------------------------------------------------
// Documents

const FIXTURES = ['prose.md', 'highlights.md', 'obsidian.md', 'tables.md', 'torture.md']
const privateDocs = import.meta.glob('/test/fixtures/private/*.{md,markdown,txt}', { query: '?url', import: 'default' })

let timings: LoadTimings | null = null
let layoutInfo = ''
let currentName = ''
let plainText = false
let currentSrc = ''

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

async function openText(name: string, src: string, imageBase: string | null): Promise<void> {
  currentName = name
  currentSrc = src
  find.invalidate()
  scroller.scrollTop = 0
  if (plainText) {
    doc.innerHTML = `<pre class="plain">${escapeHtml(src)}</pre>`
    outline.setItems([])
    timings = null
  } else {
    const r = await reader.load(src, { imageBase })
    if (!r) return // a newer load replaced this one
    timings = r.timings
    blocksLoaded = r.blocks
    outline.setItems(r.outline)
  }
  tables.scan(doc)
  tables.recheckAll(doc)
  find.invalidate()
  outline.updateCurrent()
  showTimings()
  syncRail()
  // Warm the search index and block geometry once the page has settled, so the
  // first keystroke in Find is as quick as the rest. (Stage 2 does this in the worker.)
  const loaded = currentName
  setTimeout(() => { if (currentName === loaded) { find.prepare(); reader.blockY(0, scroller) } }, 300)
}

async function openFixture(name: string): Promise<void> {
  const url = name.startsWith('/') ? name : `/test/fixtures/${name}`
  const res = await fetch(url)
  if (!res.ok) {
    doc.innerHTML = name.includes('stress')
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
    layoutInfo,
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
  checkbox(d0, 'Show as plain text', () => plainText, (v) => { plainText = v; openText(currentName, currentSrc, null) })
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
  fsel.addEventListener('change', () => { settings.font = fsel.value as FontId; refresh() })
  syncers.push(() => { fsel.value = settings.font })
  d1.append(frow)
  const crow = document.createElement('div')
  crow.className = 'row wide'
  crow.innerHTML = `<label>Font name</label><input type="text" placeholder="e.g. Iowan Old Style" aria-label="Other font name">`
  const cin = crow.querySelector('input')!
  cin.addEventListener('change', () => { settings.customFont = cin.value; refresh() })
  syncers.push(() => { crow.hidden = settings.font !== 'custom'; cin.value = settings.customFont })
  d1.append(crow)
  slider(d1, 'Size', RANGES.size, () => settings.size, (v) => (settings.size = v), (v) => v + ' px')
  slider(d1, 'Line height', RANGES.lineHeight, () => settings.lineHeight, (v) => (settings.lineHeight = v), (v) => v.toFixed(2))
  segmented<Measure>(d1, 'Line width', [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']], () => settings.measure, (v) => (settings.measure = v))
  segmented<Theme>(d1, 'Theme', [['system', 'Auto'], ['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark']], () => settings.theme, (v) => (settings.theme = v))

  const d2 = section('Advanced', false)
  slider(d2, 'Letter spacing', RANGES.letterSpacing, () => settings.letterSpacing, (v) => (settings.letterSpacing = v), (v) => v.toFixed(3) + ' em')
  slider(d2, 'Word spacing', RANGES.wordSpacing, () => settings.wordSpacing, (v) => (settings.wordSpacing = v), (v) => v.toFixed(2) + ' em')
  segmented(d2, 'Paragraphs', [['space', 'Space'], ['indent', 'Indent']] as [Settings['paragraphStyle'], string][], () => settings.paragraphStyle, (v) => (settings.paragraphStyle = v))
  slider(d2, 'Para. spacing', RANGES.paragraphSpacing, () => settings.paragraphSpacing, (v) => (settings.paragraphSpacing = v), (v) => v.toFixed(1) + ' em')
  segmented(d2, 'Alignment', [['left', 'Left'], ['justify', 'Justified']] as [Settings['align'], string][], () => settings.align, (v) => (settings.align = v))
  segmented(d2, 'Code font', Object.entries(MONO_FONTS).map(([k, f]) => [k, f.label]) as [Settings['monoFont'], string][], () => settings.monoFont, (v) => (settings.monoFont = v))

  const d3 = section('Highlights, tables, outline, find')
  segmented(d3, 'Highlights', [['marker', 'Marker'], ['lowlight', 'Lowlight'], ['underline', 'Underline']] as [Settings['highlightStyle'], string][], () => settings.highlightStyle, (v) => (settings.highlightStyle = v))
  checkbox(d3, 'Zebra rows', () => settings.zebra, (v) => (settings.zebra = v))
  checkbox(d3, 'Outline (⌥⌘O)', () => settings.outlineOpen, (v) => (settings.outlineOpen = v))
  const fb = document.createElement('div')
  fb.className = 'btns'
  fb.innerHTML = `<button>Find (⌘F)</button>`
  fb.querySelector('button')!.addEventListener('click', () => find.open())
  d3.append(fb)

  // Values tuned by eye; Export turns them into the app's defaults.
  const d4 = section('Tuning (becomes the defaults)', false)
  slider(d4, 'Heading ratio', { min: 1.1, max: 1.35, step: 0.01 }, () => tuning.headingRatio, (v) => (tuning.headingRatio = v), (v) => v.toFixed(2))
  slider(d4, 'Dark weight', { min: 300, max: 420, step: 5 }, () => tuning.darkWeight, (v) => (tuning.darkWeight = v))
  slider(d4, 'Outline size', { min: 11, max: 16, step: 0.5 }, () => tuning.outlineSize, (v) => (tuning.outlineSize = v), (v) => v + ' px')
  slider(d4, 'Outline fade', { min: 0.15, max: 1, step: 0.05 }, () => tuning.outlineIdleOpacity, (v) => (tuning.outlineIdleOpacity = v), (v) => v.toFixed(2))
  const themeNote = document.createElement('p')
  themeNote.className = 'hint'
  d4.append(themeNote)
  syncers.push(() => { themeNote.textContent = `Colours below edit the ${resolveTheme(settings.theme, dark.matches)} theme.` })
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
  checkbox(d5, 'WCAG 1.4.12 stress', () => wcag, (v) => { wcag = v })
  const exp = document.createElement('div')
  exp.innerHTML = `<div class="btns"><button id="export">Export settings</button><button id="reset">Reset to defaults</button></div><textarea id="exported" readonly aria-label="Exported settings" placeholder="Press Export, then send me this text."></textarea>`
  d5.append(exp)
  exp.querySelector('#export')!.addEventListener('click', async () => {
    const text = JSON.stringify({ settings, tuning }, null, 2)
    const ta = exp.querySelector('textarea')!
    ta.value = text
    try { await navigator.clipboard.writeText(text) } catch { ta.select() }
  })
  exp.querySelector('#reset')!.addEventListener('click', () => { settings = clone(DEFAULTS); tuning = clone(TUNING); refresh() })
  const keys = document.createElement('p')
  keys.className = 'hint'
  keys.innerHTML = '<kbd>⌘F</kbd> find · <kbd>⌘G</kbd>/<kbd>⇧⌘G</kbd> next/previous · <kbd>⌥⌘O</kbd> outline (type to filter) · <kbd>⌥⌘[</kbd>/<kbd>⌥⌘]</kbd> narrower/wider · <kbd>⌥⌘T</kbd> theme · <kbd>\\</kbd> hide this panel'
  d5.append(keys)
}

function cur() { return tuning.themes[resolveTheme(settings.theme, dark.matches)] }

function colorInput(parent: HTMLElement, label: string, get: () => string, set: (v: string) => void): void {
  const l = document.createElement('label')
  l.innerHTML = `<input type="color" aria-label="${label}"><span>${label}</span>`
  const input = l.querySelector('input')!
  input.addEventListener('input', () => { set(input.value.toUpperCase()); refresh() })
  syncers.push(() => { input.value = get().slice(0, 7) })
  parent.append(l)
}

// ---------------------------------------------------------------------------
// Keyboard: the same shortcuts the app will have, where Safari lets a page have them.

const MEASURES: Measure[] = ['narrow', 'medium', 'wide']
const THEMES: Theme[] = ['light', 'sepia', 'dark']

document.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest('input, textarea, select')
  if (e.key === '\\' && !typing) { document.body.classList.toggle('rail-hidden'); relayout(); return }
  if (!e.metaKey) return
  const k = e.key.toLowerCase()
  if (k === 'f' && !e.altKey) { e.preventDefault(); find.open(); return }
  if (k === 'g') { e.preventDefault(); if (!find.isOpen) find.open(); find.step(e.shiftKey ? -1 : 1); return }
  if (!e.altKey) return
  // With ⌥ held, e.key is a special character, so match on the physical key.
  if (e.code === 'KeyO') {
    e.preventDefault()
    settings.outlineOpen = !settings.outlineOpen
    refresh().then(() => { if (settings.outlineOpen) outline.focusForTyping() })
  } else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    e.preventDefault()
    const i = MEASURES.indexOf(settings.measure) + (e.code === 'BracketLeft' ? -1 : 1)
    settings.measure = MEASURES[Math.max(0, Math.min(2, i))]
    refresh()
  } else if (e.code === 'KeyT') {
    e.preventDefault()
    const now = resolveTheme(settings.theme, dark.matches)
    settings.theme = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length]
    refresh()
  }
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
;(window as any).leading = { openFixture, openText, refresh, settings: () => settings, setWcag: (v: boolean) => { wcag = v; return refresh() }, timings: () => timings, find, blocks: () => blocksLoaded }

buildRail()
warmPool() // as the app will at launch
await refresh()
await openFixture('prose.md')
