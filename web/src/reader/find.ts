// Find, in both modes. One slim bar (so the search term carries across ⌘E)
// drives an "engine" for the current mode:
//
// - ReaderFind searches the text as displayed, insensitive to case, accents
//   and typography, using the search index built while the document is
//   parsed, so it covers blocks that are not painted yet. Matches are found
//   on the page one block at a time, only for blocks near the screen or
//   being jumped to, and outlined in a layer above the text so colour
//   highlights stay visible underneath.
// - The editor's engine (editor/editor-find.ts) searches the raw source and
//   adds Replace, Replace All and regular expressions.
//
// The bar shows "12 of 347", ticks beside the scroll bar, and announces the
// count to VoiceOver.

import { fold, findAll } from '../core/fold'
import { blockText, type Match, type SearchIndex } from '../core/search-index'

const MAX_DRAWN = 400

export interface FindOptions { caseSensitive: boolean; wholeWord: boolean; regex: boolean }

/** What the bar needs from a mode. Indexes are match numbers, 0-based. */
export interface FindEngine {
  readonly canReplace: boolean
  /** Run a search; returns the number of matches. */
  search(query: string, opts: FindOptions): number
  /** The first match at or after the top of the window. */
  firstVisible(): number
  /** Bring match i into view (`settle`: only if it has drifted out of the middle). */
  reveal(i: number, settle?: boolean): void
  /** Mark the matches near the screen; `current` more strongly. */
  draw(current: number): void
  clear(): void
  /** Positions for scroll-bar ticks, as fractions of the document's height. */
  ticks(current: number): { all: number[]; current: number | null }
  replace?(i: number, text: string): void
  replaceAll?(text: string): number
}

export class FindBar {
  readonly el: HTMLElement
  private input: HTMLInputElement
  private replaceInput: HTMLInputElement
  private count: HTMLElement
  private status: HTMLElement
  private total = 0
  private current = -1
  private opts: FindOptions = { caseSensitive: false, wholeWord: false, regex: false }
  private raf = 0
  private replacing = false
  lastSearchMs = 0
  engine: FindEngine
  /** The bar's own tick strip. */
  private ticksEl: HTMLElement

  constructor(win: HTMLElement, private scroller: HTMLElement, ticks: HTMLElement, readerEngine: FindEngine) {
    this.engine = readerEngine
    this.ticksEl = ticks
    this.el = document.createElement('div')
    this.el.className = 'findbar'
    this.el.hidden = true
    this.el.setAttribute('role', 'search')
    this.el.innerHTML = `
      <div class="find-row">
        <input type="search" class="find-q" placeholder="Find" aria-label="Find in document" spellcheck="false" autocomplete="off">
        <span class="count" aria-hidden="true"></span>
        <button class="opt" data-opt="caseSensitive" title="Match Case" aria-pressed="false">Aa</button>
        <button class="opt" data-opt="wholeWord" title="Whole Word" aria-pressed="false">W</button>
        <button class="opt regex" data-opt="regex" title="Regular Expression (editing only)" aria-pressed="false">.*</button>
        <button class="prev" title="Previous (⇧⌘G)" aria-label="Previous match">‹</button>
        <button class="next" title="Next (⌘G)" aria-label="Next match">›</button>
        <button class="close" title="Close (Esc)" aria-label="Close find">✕</button>
      </div>
      <div class="replace-row" hidden>
        <input type="text" class="find-r" placeholder="Replace with" aria-label="Replace with" spellcheck="false" autocomplete="off">
        <button class="do-replace" title="Replace this match">Replace</button>
        <button class="do-replace-all" title="Replace every match">All</button>
      </div>
      <span class="sr-status" role="status" aria-live="polite"></span>`
    win.append(this.el)
    this.input = this.el.querySelector('.find-q')!
    this.replaceInput = this.el.querySelector('.find-r')!
    this.count = this.el.querySelector('.count')!
    this.status = this.el.querySelector('.sr-status')!
    this.input.addEventListener('input', () => this.search(true))
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.target === this.replaceInput) { e.preventDefault(); this.replaceOne() }
      else if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1) }
      else if (e.key === 'Escape') { e.preventDefault(); this.close() }
    }
    this.input.addEventListener('keydown', keys)
    this.replaceInput.addEventListener('keydown', keys)
    this.el.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.opt as keyof FindOptions
      this.opts[k] = !this.opts[k]
      b.setAttribute('aria-pressed', String(this.opts[k]))
      this.search(true)
      this.input.focus()
    }))
    this.el.querySelector('.prev')!.addEventListener('click', () => this.step(-1))
    this.el.querySelector('.next')!.addEventListener('click', () => this.step(1))
    this.el.querySelector('.close')!.addEventListener('click', () => this.close())
    this.el.querySelector('.do-replace')!.addEventListener('click', () => this.replaceOne())
    this.el.querySelector('.do-replace-all')!.addEventListener('click', () => this.replaceAll())
    scroller.addEventListener('scroll', () => this.scheduleDraw(), { passive: true })
  }

  get isOpen(): boolean { return !this.el.hidden }
  get query(): string { return this.input.value }
  set query(q: string) { this.input.value = q }

  /** Switch modes, keeping the query; re-runs the search in the new mode. */
  setEngine(e: FindEngine, scroller: HTMLElement): void {
    this.engine.clear()
    this.engine = e
    if (scroller !== this.scroller) {
      this.scroller = scroller
      scroller.addEventListener('scroll', () => this.scheduleDraw(), { passive: true })
    }
    // Replace and regular expressions exist only where the file can be changed.
    this.el.classList.toggle('can-replace', e.canReplace)
    if (!e.canReplace) { this.replacing = false; this.opts.regex = false; this.el.querySelector('.regex')!.setAttribute('aria-pressed', 'false') }
    this.el.querySelector<HTMLElement>('.replace-row')!.hidden = !this.replacing
    if (this.isOpen && this.input.value) this.search(true)
  }

  open(replace = false): void {
    this.replacing = replace && this.engine.canReplace
    this.el.querySelector<HTMLElement>('.replace-row')!.hidden = !this.replacing
    this.el.hidden = false
    this.input.focus()
    this.input.select()
    if (this.input.value) this.search(false)
  }

  close(): void {
    this.el.hidden = true
    this.engine.clear()
    this.ticksEl.replaceChildren()
    // Leave the reader where they are.
    this.scroller.focus({ preventScroll: true })
  }

  /** The document changed (new text, more blocks painted): search again. */
  invalidate(): void {
    if (this.isOpen && this.input.value) this.search(false)
  }

  search(resetCurrent: boolean): void {
    const t0 = performance.now()
    const q = this.input.value
    this.total = q ? this.engine.search(q, this.opts) : 0
    this.lastSearchMs = performance.now() - t0
    if (resetCurrent || this.current >= this.total) this.current = this.total ? this.engine.firstVisible() : -1
    if (this.current >= this.total) this.current = 0
    this.updateCount()
    this.drawTicks()
    this.draw()
  }

  private updateCount(): void {
    const n = this.total
    const label = !this.input.value ? '' : n ? `${(this.current + 1).toLocaleString()} of ${n.toLocaleString()}` : 'No matches'
    this.count.textContent = label
    this.status.textContent = label
  }

  step(dir: 1 | -1): void {
    if (!this.total) return
    this.current = (this.current + dir + this.total) % this.total
    this.engine.reveal(this.current)
    this.updateCount()
    this.drawTicks()
    this.draw()
    // A jump into a never-seen part of a long page lays out new sections over
    // the next frame or two; centre again once they have settled.
    const i = this.current
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.current !== i || !this.isOpen) return
      this.engine.reveal(i, true)
      this.draw()
    }))
  }

  private replaceOne(): void {
    if (!this.engine.replace || this.current < 0 || !this.total) return
    this.engine.replace(this.current, this.replaceInput.value)
    this.search(false)
    if (this.total) this.engine.reveal(this.current)
    this.draw()
  }

  private replaceAll(): void {
    if (!this.engine.replaceAll || !this.total) return
    const n = this.engine.replaceAll(this.replaceInput.value)
    this.search(false)
    this.status.textContent = `Replaced ${n.toLocaleString()}`
  }

  private scheduleDraw(): void {
    if (this.raf || !this.isOpen) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw() })
  }

  draw(): void {
    if (!this.isOpen || !this.total) { this.engine.clear(); return }
    this.engine.draw(this.current)
  }

  /** Ticks beside the scroll bar: where the hits cluster in a long document. */
  private drawTicks(): void {
    this.ticksEl.replaceChildren()
    if (!this.total) return
    const h = this.ticksEl.clientHeight
    const { all, current } = this.engine.ticks(this.current)
    const used = new Set<number>()
    const frag = document.createDocumentFragment()
    const add = (f: number, cls: string) => {
      const px = Math.round(f * h)
      if (cls !== 'current' && used.has(px)) return
      used.add(px)
      const t = document.createElement('i')
      if (cls) t.className = cls
      t.style.top = px + 'px'
      frag.append(t)
    }
    for (const f of all) add(f, '')
    if (current !== null) add(current, 'current')
    this.ticksEl.append(frag)
  }

  // For tests and Stage 4 ("highlight this match").
  driftNow(): number { return (this.engine as any).driftNow?.() ?? 0 }
  currentRange(): Range | null { return (this.engine as any).rangeOf?.(this.current, true) ?? null }
  get matchCount(): number { return this.total }
  /** The current match's number, or -1. */
  get currentIndex(): number { return this.total ? this.current : -1 }
}

// ---------------------------------------------------------------------------

/** Reading-mode engine: the search index plus per-block matching on the page. */
export class ReaderFind implements FindEngine {
  readonly canReplace = false
  private matches: Match[] = []
  private q = ''
  private opts: FindOptions = { caseSensitive: false, wholeWord: false, regex: false }
  /** Ranges found on the page for each block, for the current query. */
  private ranges = new Map<number, Range[]>()
  private drawn: [number, HTMLElement][] = []

  /** The reader's search index (replaced when a new document opens). */
  index: () => SearchIndex | null = () => null
  /** Block n's element; with `force`, the reader paints up to it first. */
  getBlock: (b: number, force: boolean) => HTMLElement | null = () => null
  /** Where block n sits within the scroller (the reader caches it). */
  blockY: (b: number) => number = () => 0
  /** Called when the page's geometry changes (the reader drops cached positions). */
  onLayoutShift: () => void = () => {}
  /** Redraw request when the layout moves (wired to the bar). */
  onRedraw: () => void = () => {}

  /**
   * `frame` is an empty overlay covering the scroller. Geometry is read from it,
   * never from the scroller or the column: in WebKit, a rect query on an element
   * forces layout of every skipped off-screen block inside it (~0.5 s at 5 MB).
   */
  constructor(private scroller: HTMLElement, doc: HTMLElement, private layer: HTMLElement, private frame: HTMLElement) {
    // On long pages, sections start with estimated heights and settle to their
    // real ones as they come into view. That moves text without a scroll event,
    // so redraw whenever the document's size changes, or marks would drift.
    new ResizeObserver(() => { this.onLayoutShift(); this.onRedraw() }).observe(doc)
  }

  /** The page changed (new document, more blocks painted). */
  invalidate(): void { this.ranges.clear() }

  search(query: string, opts: FindOptions): number {
    this.q = query
    this.opts = { ...opts, regex: false } // reading mode never uses regular expressions
    this.matches = this.index()?.find(query, this.opts) ?? []
    this.ranges.clear()
    return this.matches.length
  }

  /** The matches inside block b, found in the page's own text of that block. */
  private rangesIn(b: number, force: boolean): Range[] {
    const cached = this.ranges.get(b)
    if (cached) return cached
    const el = this.getBlock(b, force)
    if (!el) return []
    const nodes: Text[] = []
    const starts: number[] = []
    // Same text rule as the index, so the k-th hit here is the k-th hit there.
    const text = blockText<Node>(el, (n) => n.childNodes, (n) => (n.nodeType === 1 ? (n as Element).tagName.toLowerCase() : null),
      (n) => (n.nodeType === 3 ? (n as Text).data : null), (n, start) => { nodes.push(n as Text); starts.push(start) })
    const at = (off: number): [Text, number] => {
      let lo = 0, hi = starts.length - 1
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1 }
      return [nodes[lo], Math.min(off - starts[lo], nodes[lo].data.length)]
    }
    const out = findAll(fold(text, this.opts.caseSensitive), text, this.q, this.opts).map(([s, e]) => {
      const r = document.createRange()
      const [sn, so] = at(s)
      const [en, eo] = at(e - 1)
      r.setStart(sn, so)
      r.setEnd(en, Math.min(eo + 1, en.data.length))
      return r
    })
    this.ranges.set(b, out)
    return out
  }

  rangeOf(i: number, force = false): Range | null {
    const m = this.matches[i]
    if (!m) return null
    const rs = this.rangesIn(m.b, force)
    return rs[Math.min(m.k, rs.length - 1)] ?? null
  }

  /**
   * Number of the block at the top of the window (or `dy` px below it), by a
   * single hit test. Asking for the geometry of off-screen blocks instead can
   * cost hundreds of milliseconds on a 12,000-block page.
   */
  private blockAt(dy = 0): number {
    const box = this.frame.getBoundingClientRect()
    const colLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col-left')) || box.width / 3
    const x = box.left + colLeft + 40
    for (let y = Math.max(box.top + 4 + dy, box.top + 4); y < box.bottom; y += 24) {
      const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-b]') as HTMLElement | null
      if (el?.dataset.b) return Number(el.dataset.b)
    }
    return dy ? Infinity : 0
  }

  reveal(i: number, settle = false): void {
    const r = this.rangeOf(i, true)
    if (!r) return
    const el: Element | null = r.startContainer.parentElement
    for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) (d as HTMLDetailsElement).open = true
    const rect = r.getBoundingClientRect()
    const box = this.frame.getBoundingClientRect()
    const off = rect.top - (box.top + box.height / 2)
    if (settle && Math.abs(off) < box.height / 4) return // still comfortably in view: don't nudge the page
    this.scroller.scrollTop += off
    const wide = el?.closest('.table-scroll.scrolls') as HTMLElement | null
    if (wide) {
      const wr = wide.getBoundingClientRect()
      const r2 = r.getBoundingClientRect()
      if (r2.left < wr.left + 80 || r2.right > wr.right - 40) wide.scrollLeft += r2.left - (wr.left + wr.width / 2)
    }
  }

  firstVisible(): number {
    const i = this.firstInBlock(this.blockAt())
    return i >= this.matches.length ? 0 : i
  }

  private firstInBlock(b: number): number {
    let lo = 0, hi = this.matches.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.matches[mid].b < b) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  clear(): void {
    this.layer.replaceChildren()
    this.drawn = []
  }

  draw(current: number): void {
    this.clear()
    if (!this.matches.length) return
    const box = this.frame.getBoundingClientRect()
    const origin = this.layer.getBoundingClientRect()
    const first = Math.max(0, this.blockAt() - 2)
    const last = this.blockAt(box.height - 8) + 2
    const frag = document.createDocumentFragment()
    for (let i = this.firstInBlock(first); i < this.matches.length && this.drawn.length < MAX_DRAWN; i++) {
      if (this.matches[i].b > last) break
      const r = this.rangeOf(i)
      if (!r) continue
      for (const rect of r.getClientRects()) {
        const d = document.createElement('div')
        d.className = i === current ? 'sm current' : 'sm'
        // Grow the box a hair so the outline sits around the glyphs, not on them.
        d.style.cssText = `left:${rect.left - origin.left - 2}px;top:${rect.top - origin.top - 1}px;width:${rect.width + 4}px;height:${rect.height + 2}px`
        frag.append(d)
        this.drawn.push([i, d])
      }
    }
    this.layer.append(frag)
  }

  ticks(current: number): { all: number[]; current: number | null } {
    const total = this.scroller.scrollHeight || 1
    const all: number[] = []
    let last = -1
    // One per block is all a scroll bar can show; positions are cached by the reader.
    for (const m of this.matches) {
      if (m.b === last) continue
      last = m.b
      all.push(this.blockY(m.b) / total)
    }
    const c = this.matches[current]
    return { all, current: c ? this.blockY(c.b) / total : null }
  }

  /** For tests: the largest gap (px) between a drawn mark and its text right now. */
  driftNow(): number {
    let worst = 0
    for (const [i, d] of this.drawn) {
      const r = this.rangeOf(i)?.getClientRects()[0]
      const b = d.getBoundingClientRect()
      if (r) worst = Math.max(worst, Math.abs(b.top + 1 - r.top))
    }
    return worst
  }
}
