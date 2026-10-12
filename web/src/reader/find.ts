// Find in reading mode. Searches the text as displayed, insensitive to case,
// accents and typography; marks matches with outlines drawn in a layer above
// the text (so colour highlights stay visible underneath); shows ticks beside
// the scroll bar; announces the count to VoiceOver.
//
// Stage 1 builds its index from the page's text. Stage 2 moves the index into
// the worker so it covers blocks that are not yet in the page.

import { fold, findAll, type Folded } from '../core/fold'

const BLOCK = 'p,li,h1,h2,h3,h4,h5,h6,td,th,pre,dt,dd,summary,.callout-title,figcaption'
const MAX_DRAWN = 400

export interface FindOptions { caseSensitive: boolean; wholeWord: boolean }

export class FindBar {
  readonly el: HTMLElement
  private input: HTMLInputElement
  private count: HTMLElement
  private status: HTMLElement
  private nodes: Text[] = []
  private starts: number[] = []
  /** Top-level block holding each text node, and that block's number. */
  private blocks: HTMLElement[] = []
  private blockNo: Int32Array = new Int32Array(0)
  private text = ''
  private folded: Folded | null = null
  private foldedCase: Folded | null = null
  private matches: [number, number][] = []
  private current = -1
  private opts: FindOptions = { caseSensitive: false, wholeWord: false }
  private raf = 0
  lastSearchMs = 0
  /** Where block n sits within the scroller (supplied by the reader, which caches it). */
  blockY: (b: number) => number = () => 0

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
  }

  get isOpen(): boolean { return !this.el.hidden }
  get query(): string { return this.input.value }

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

  /** Build the index ahead of the first keystroke (call when the page is idle). */
  prepare(): void { this.hay() }

  /** The page's text changed (new document, more blocks loaded). */
  invalidate(): void {
    this.folded = this.foldedCase = null
    if (this.isOpen && this.input.value) this.search(false)
  }

  private buildIndex(): void {
    this.nodes = []
    this.starts = []
    this.blocks = []
    const parts: string[] = []
    let len = 0
    let lastBlock: Element | null = null
    const walker = document.createTreeWalker(this.doc, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      // A separator between blocks stops matches running across paragraphs.
      const block = n.parentElement?.closest(BLOCK) ?? null
      if (block !== lastBlock && len) { parts.push('\n'); len += 1 }
      lastBlock = block
      this.nodes.push(n)
      this.starts.push(len)
      // Every top-level block carries data-b (it may sit inside a section wrapper).
      this.blocks.push((n.parentElement!.closest('[data-b]') as HTMLElement) ?? n.parentElement!)
      parts.push(n.data)
      len += n.data.length
    }
    this.text = parts.join('')
    this.blockNo = Int32Array.from(this.blocks, (b) => Number(b.dataset.b ?? -1))
  }

  private hay(): Folded {
    if (!this.nodes.length || (!this.folded && !this.foldedCase)) this.buildIndex()
    if (this.opts.caseSensitive) return (this.foldedCase ??= fold(this.text, true))
    return (this.folded ??= fold(this.text, false))
  }

  search(resetCurrent: boolean): void {
    const t0 = performance.now()
    const q = this.input.value
    this.matches = q ? findAll(this.hay(), this.text, q, this.opts) : []
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
  }

  private nodeIndex(off: number): number {
    let lo = 0, hi = this.starts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid] <= off) lo = mid; else hi = mid - 1 }
    return lo
  }

  private blockOf(m: [number, number]): HTMLElement { return this.blocks[this.nodeIndex(m[0])] }
  private blockNoOf(m: [number, number]): number { return this.blockNo[this.nodeIndex(m[0])] }

  /**
   * Number of the block at the top of the window (or `dy` px below it), by a
   * single hit test. Asking for the geometry of off-screen blocks instead can
   * cost hundreds of milliseconds on a 12,000-block page.
   */
  private blockAtTop(dy = 0): number {
    const box = this.frame.getBoundingClientRect()
    // A point just inside the column's left edge (the layout publishes it as --col-left).
    const colLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col-left')) || box.width / 3
    const x = box.left + colLeft + 40
    for (let y = Math.max(box.top + 4 + dy, box.top + 4); y < box.bottom; y += 24) {
      const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-b]') as HTMLElement | null
      if (el?.dataset.b) return Number(el.dataset.b)
    }
    return 0
  }

  private rangeFor(m: [number, number]): Range {
    const at = (off: number): [Text, number] => {
      const i = this.nodeIndex(off)
      return [this.nodes[i], Math.min(off - this.starts[i], this.nodes[i].data.length)]
    }
    const r = document.createRange()
    const [sn, so] = at(m[0])
    const [en, eo] = at(m[1] - 1)
    r.setStart(sn, so)
    r.setEnd(en, Math.min(eo + 1, en.data.length))
    return r
  }

  /** Open anything hiding the match, then centre it in the window. */
  private reveal(i: number): void {
    const r = this.rangeFor(this.matches[i])
    let el: Element | null = r.startContainer.parentElement
    for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) (d as HTMLDetailsElement).open = true
    const rect = r.getBoundingClientRect()
    const box = this.frame.getBoundingClientRect()
    this.scroller.scrollTop += rect.top - (box.top + box.height / 2)
    const wide = el?.closest('.table-scroll.scrolls') as HTMLElement | null
    if (wide) {
      const wr = wide.getBoundingClientRect()
      const r2 = r.getBoundingClientRect()
      if (r2.left < wr.left + 80 || r2.right > wr.right - 40) wide.scrollLeft += r2.left - (wr.left + wr.width / 2)
    }
  }

  private firstVisibleMatch(): number {
    if (!this.matches.length) return -1
    const i = this.firstInBlock(this.blockAtTop())
    return i >= this.matches.length ? 0 : i
  }

  /** First match in block `b` or later (matches are in block order). */
  private firstInBlock(b: number): number {
    let lo = 0, hi = this.matches.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.blockNoOf(this.matches[mid]) < b) lo = mid + 1
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
    if (!this.matches.length || !this.isOpen) return
    const box = this.frame.getBoundingClientRect()
    const margin = box.height
    const origin = this.layer.getBoundingClientRect()
    const frag = document.createDocumentFragment()
    let drawn = 0
    // Start a couple of blocks above the window so partly visible matches are drawn.
    for (let i = this.firstInBlock(this.blockAtTop() - 2); i < this.matches.length && drawn < MAX_DRAWN; i++) {
      const rects = this.rangeFor(this.matches[i]).getClientRects()
      if (!rects.length) continue
      if (rects[0].top > box.bottom + margin) break
      for (const r of rects) {
        const d = document.createElement('div')
        d.className = i === this.current ? 'sm current' : 'sm'
        // Grow the box a hair so the outline sits around the glyphs, not on them.
        d.style.cssText = `left:${r.left - origin.left - 2}px;top:${r.top - origin.top - 1}px;width:${r.width + 4}px;height:${r.height + 2}px`
        frag.append(d)
      }
      drawn++
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
      const b = this.blockNoOf(m)
      if (b === last) continue
      last = b
      add(this.blockY(b), '')
    }
    if (this.current >= 0) add(this.blockY(this.blockNoOf(this.matches[this.current])), 'current')
    this.ticks.append(frag)
  }

  /** The current match's text range, for "highlight this match" (Stage 4). */
  currentRange(): Range | null {
    return this.current >= 0 ? this.rangeFor(this.matches[this.current]) : null
  }
}
