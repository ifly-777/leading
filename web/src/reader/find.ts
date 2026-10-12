// Find in reading mode. Searches the text as displayed, insensitive to case,
// accents and typography; marks matches with outlines drawn in a layer above
// the text (so colour highlights stay visible underneath); shows ticks beside
// the scroll bar; announces the count to VoiceOver.
//
// Matching runs on the reader's search index, built while the document is
// parsed, so it covers blocks that are not painted yet. Matches are found on
// the page one block at a time, only for blocks near the screen or being
// jumped to.

import { fold, findAll } from '../core/fold'
import { blockText, type Match, type SearchIndex } from '../core/search-index'

const MAX_DRAWN = 400

export interface FindOptions { caseSensitive: boolean; wholeWord: boolean }

export class FindBar {
  readonly el: HTMLElement
  private input: HTMLInputElement
  private count: HTMLElement
  private status: HTMLElement
  private matches: Match[] = []
  private current = -1
  private opts: FindOptions = { caseSensitive: false, wholeWord: false }
  private raf = 0
  /** Ranges found on the page for each block, for the current query. */
  private ranges = new Map<number, Range[]>()
  private drawn: [number, HTMLElement][] = []
  lastSearchMs = 0

  /** The reader's search index (replaced when a new document opens). */
  index: () => SearchIndex | null = () => null
  /** Block n's element; with `force`, the reader paints up to it first. */
  getBlock: (b: number, force: boolean) => HTMLElement | null = () => null
  /** Where block n sits within the scroller (the reader caches it). */
  blockY: (b: number) => number = () => 0
  /** Called when the page's geometry changes (the reader drops cached positions). */
  onLayoutShift: () => void = () => {}

  /**
   * `frame` is an empty overlay covering the scroller. Geometry is read from it,
   * never from the scroller or the column: in WebKit, a rect query on an element
   * forces layout of every skipped off-screen block inside it (~0.5 s at 5 MB).
   */
  constructor(private win: HTMLElement, private scroller: HTMLElement, private doc: HTMLElement,
              private layer: HTMLElement, private ticks: HTMLElement, private frame: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'findbar'
    this.el.hidden = true
    this.el.setAttribute('role', 'search')
    this.el.innerHTML = `
      <input type="search" placeholder="Find" aria-label="Find in document" spellcheck="false" autocomplete="off">
      <span class="count" aria-hidden="true"></span>
      <button class="opt" data-opt="caseSensitive" title="Match Case" aria-pressed="false">Aa</button>
      <button class="opt" data-opt="wholeWord" title="Whole Word" aria-pressed="false">W</button>
      <button class="prev" title="Previous (⇧⌘G)" aria-label="Previous match">‹</button>
      <button class="next" title="Next (⌘G)" aria-label="Next match">›</button>
      <button class="close" title="Close (Esc)" aria-label="Close find">✕</button>
      <span class="sr-status" role="status" aria-live="polite"></span>`
    win.append(this.el)
    this.input = this.el.querySelector('input')!
    this.count = this.el.querySelector('.count')!
    this.status = this.el.querySelector('.sr-status')!
    this.input.addEventListener('input', () => this.search(true))
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1) }
      else if (e.key === 'Escape') { e.preventDefault(); this.close() }
    })
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
    scroller.addEventListener('scroll', () => this.scheduleDraw(), { passive: true })
    // On long pages, sections start with estimated heights and settle to their
    // real ones as they come into view. That moves text without a scroll event,
    // so redraw whenever the document's size changes, or marks would drift.
    new ResizeObserver(() => { this.onLayoutShift(); this.scheduleDraw() }).observe(doc)
  }

  get isOpen(): boolean { return !this.el.hidden }
  get query(): string { return this.input.value }
  set query(q: string) { this.input.value = q }

  open(): void {
    this.el.hidden = false
    this.input.focus()
    this.input.select()
    if (this.input.value) this.search(false)
  }

  close(): void {
    this.el.hidden = true
    this.layer.replaceChildren()
    this.ticks.replaceChildren()
    // Leave the reader where they are.
    this.scroller.focus({ preventScroll: true })
  }

  /** The index grew or the page changed (new document, more blocks painted). */
  invalidate(): void {
    this.ranges.clear()
    if (this.isOpen && this.input.value) this.search(false)
  }

  search(resetCurrent: boolean): void {
    const t0 = performance.now()
    const q = this.input.value
    this.matches = q ? (this.index()?.find(q, this.opts) ?? []) : []
    this.ranges.clear()
    this.lastSearchMs = performance.now() - t0
    if (resetCurrent || this.current >= this.matches.length) this.current = this.firstVisibleMatch()
    this.updateCount()
    this.drawTicks()
    this.draw()
  }

  private updateCount(): void {
    const n = this.matches.length
    const label = !this.input.value ? '' : n ? `${this.current + 1} of ${n.toLocaleString()}` : 'No matches'
    this.count.textContent = label
    this.status.textContent = label
  }

  step(dir: 1 | -1): void {
    if (!this.matches.length) return
    this.current = (this.current + dir + this.matches.length) % this.matches.length
    this.reveal(this.current)
    this.updateCount()
    this.drawTicks()
    this.draw()
    // A jump into a never-seen part of a long page lays out new sections over
    // the next frame or two; centre again once they have settled.
    const i = this.current
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.current !== i || !this.isOpen) return
      this.reveal(i, true)
      this.draw()
    }))
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
    const out = findAll(fold(text, this.opts.caseSensitive), text, this.input.value, this.opts).map(([s, e]) => {
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

  private rangeOf(i: number, force = false): Range | null {
    const m = this.matches[i]
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
    // A point just inside the column's left edge (the layout publishes it as --col-left).
    const colLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col-left')) || box.width / 3
    const x = box.left + colLeft + 40
    for (let y = Math.max(box.top + 4 + dy, box.top + 4); y < box.bottom; y += 24) {
      const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-b]') as HTMLElement | null
      if (el?.dataset.b) return Number(el.dataset.b)
    }
    return dy ? Infinity : 0
  }

  /** Open anything hiding the match, then centre it in the window (`settle`: only if it has drifted). */
  private reveal(i: number, settle = false): void {
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

  private firstVisibleMatch(): number {
    if (!this.matches.length) return -1
    const i = this.firstInBlock(this.blockAt())
    return i >= this.matches.length ? 0 : i
  }

  /** First match in block `b` or later. */
  private firstInBlock(b: number): number {
    let lo = 0, hi = this.matches.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.matches[mid].b < b) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private scheduleDraw(): void {
    if (this.raf || !this.isOpen) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw() })
  }

  /** Outline only the matches near the screen; the count stays exact. */
  draw(): void {
    this.layer.replaceChildren()
    this.drawn = []
    if (!this.matches.length || !this.isOpen) return
    const box = this.frame.getBoundingClientRect()
    const origin = this.layer.getBoundingClientRect()
    // Blocks from a little above the window to a little below it.
    const first = Math.max(0, this.blockAt() - 2)
    const last = this.blockAt(box.height - 8) + 2
    const frag = document.createDocumentFragment()
    for (let i = this.firstInBlock(first); i < this.matches.length && this.drawn.length < MAX_DRAWN; i++) {
      if (this.matches[i].b > last) break
      const r = this.rangeOf(i)
      if (!r) continue
      for (const rect of r.getClientRects()) {
        const d = document.createElement('div')
        d.className = i === this.current ? 'sm current' : 'sm'
        // Grow the box a hair so the outline sits around the glyphs, not on them.
        d.style.cssText = `left:${rect.left - origin.left - 2}px;top:${rect.top - origin.top - 1}px;width:${rect.width + 4}px;height:${rect.height + 2}px`
        frag.append(d)
        this.drawn.push([i, d])
      }
    }
    this.layer.append(frag)
  }

  /** Ticks beside the scroll bar: where the hits cluster in a long document. */
  private drawTicks(): void {
    this.ticks.replaceChildren()
    if (!this.matches.length) return
    const total = this.scroller.scrollHeight
    const h = this.ticks.clientHeight
    const used = new Set<number>()
    const frag = document.createDocumentFragment()
    const add = (y: number, cls: string) => {
      const px = Math.round((y / total) * h)
      if (cls !== 'current' && used.has(px)) return
      used.add(px)
      const t = document.createElement('i')
      if (cls) t.className = cls
      t.style.top = px + 'px'
      frag.append(t)
    }
    // One tick per pixel row is all a scroll bar can show. Positions come from
    // the reader's cached block geometry, so even 500,000 hits cost little.
    let last = -1
    for (const m of this.matches) {
      if (m.b === last) continue
      last = m.b
      add(this.blockY(m.b), '')
    }
    if (this.current >= 0) add(this.blockY(this.matches[this.current].b), 'current')
    this.ticks.append(frag)
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

  /** The current match's text range, for "highlight this match" (Stage 4). */
  currentRange(): Range | null {
    return this.current >= 0 ? this.rangeOf(this.current, true) : null
  }
}
