// Puts a document on screen as fast as possible.
//
// Short documents render in one go on the main thread. Long ones paint the
// opening ~20 KB at once; meanwhile the file is cut at headings into pieces
// that a small pool of workers parses in parallel. Pieces are painted in
// order as they arrive, a slice at a time between frames, so scrolling and
// typing never stall.

import { renderMarkdown, type Block, type OutlineItem, type RenderOptions, type RenderResult } from '../core/pipeline'
import { splitForParallel, referenceDefinitions } from '../core/chunks'
import { topIn } from './geometry'
import { SearchIndex } from '../core/search-index'

export const PREVIEW_BYTES = 20_000
export const LARGE_DOC = 300_000 // above this, far-away blocks skip layout

export interface LoadTimings {
  previewParse?: number // ms, main thread, opening slice
  firstPaint: number // ms from load() to the first frame with text
  pieces?: number // how many parallel pieces
  parsed?: number // ms until every piece was parsed and rendered to HTML
  complete: number // ms from load() until every block is in the page
  blocks: number
  bytes: number
}

export interface LoadResult { outline: OutlineItem[]; blocks: Block[]; timings: LoadTimings }

/**
 * The opening slice of a document, cut at a blank line so no block is split.
 * Front matter and fenced code are never cut in the middle.
 */
export function cutPrefix(src: string, target = PREVIEW_BYTES): string {
  if (src.length <= target * 1.5) return src
  let i = 0
  let fence: string | null = null
  if (src.startsWith('---\n') || src.startsWith('---\r\n')) {
    const end = src.indexOf('\n---', 3)
    if (end > 0) i = src.indexOf('\n', end + 4) + 1 || src.length
  }
  while (i < src.length) {
    const nl = src.indexOf('\n', i)
    const line = src.slice(i, nl < 0 ? src.length : nl)
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1]
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null
    } else if (!fence && i >= target && line.trim() === '') {
      return src.slice(0, i)
    }
    if (nl < 0) break
    i = nl + 1
  }
  return src
}

// The next screen refresh, or 100 ms, whichever comes first. WebKit stops
// refreshing a window that is hidden behind others, and loading must never
// stall on that.
const nextFrame = () => new Promise<void>((r) => {
  let done = false
  const go = () => { if (!done) { done = true; r() } }
  requestAnimationFrame(go)
  setTimeout(go, 100)
})
// A task boundary without setTimeout's minimum delay.
const channel = new MessageChannel()
const queue: (() => void)[] = []
channel.port1.onmessage = () => queue.shift()?.()
/**
 * Lay the page out now and report it as ready to show. Measured here rather
 * than at the next screen refresh, because WebKit stops refreshing windows
 * that are covered by others; on a visible window the screen picks the text
 * up within one refresh (8–16 ms).
 */
function laidOut(doc: HTMLElement, t0: number): number {
  void doc.offsetHeight // forces style and layout
  return performance.now() - t0
}

const yieldTask = () => new Promise<void>((r) => { queue.push(r); channel.port2.postMessage(0) })

// Leave a core for the main thread; more than four workers gains little.
export const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
const pool: Worker[] = []
/** Start the workers early (the app does this at launch) so their code is loaded before a file arrives. */
export function warmPool(): Worker[] {
  while (pool.length < POOL_SIZE) pool.push(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }))
  return pool
}

interface PieceResult extends RenderResult { index: number; ms: number; folded: { text: string; map: Int32Array } }

export class Reader {
  private gen = 0
  private pending: Block[] = []
  private nextIndex = 0
  private wake: (() => void) | null = null
  // Long documents are grouped into sections of ~60 blocks, cut at headings.
  // content-visibility applies per section: WebKit re-checks every skipped
  // element whenever focus or the selection moves, which costs ~0.5 s with
  // 12,000 blocks and ~5 ms with 200 sections.
  private sectioned = false
  private sections: HTMLElement[] = []
  private sectionStart: number[] = []
  private sectionCount = 0
  private sectionBytes = 0
  onBlocksAdded: (() => void) | null = null
  /** The first text of a document is on screen (ms since load began). */
  onFirstPaint: ((ms: number) => void) | null = null
  /** Search index for the current document; grows as pieces are parsed. */
  index = new SearchIndex()
  onIndexGrew: (() => void) | null = null

  constructor(public doc: HTMLElement) {}

  async load(src: string, opts: RenderOptions = {}): Promise<LoadResult | null> {
    const gen = ++this.gen
    const t0 = performance.now()
    this.index = new SearchIndex()
    this.sectioned = src.length > LARGE_DOC
    document.documentElement.dataset.large = String(this.sectioned)
    this.sections = []
    this.sectionStart = []
    const prefix = cutPrefix(src)

    if (prefix.length === src.length) {
      const r = renderMarkdown(src, opts)
      this.doc.innerHTML = r.blocks.map((b) => b.html).join('')
      this.index.add({ texts: r.blocks.map((b) => b.text) })
      this.onIndexGrew?.()
      this.pending = r.blocks
      this.nextIndex = r.blocks.length
      this.onBlocksAdded?.()
      const t = laidOut(this.doc, t0)
      this.onFirstPaint?.(t)
      await nextFrame()
      return { outline: r.outline, blocks: r.blocks, timings: { firstPaint: t, complete: t, blocks: r.blocks.length, bytes: src.length } }
    }

    // 1. Paint the opening straight away.
    const p0 = performance.now()
    const preview = renderMarkdown(prefix, opts)
    const previewParse = performance.now() - p0
    this.doc.innerHTML = preview.blocks.map((b) => b.html).join('')
    this.pending = []
    this.nextIndex = 0
    this.onBlocksAdded?.()
    const firstPaint = laidOut(this.doc, t0)
    this.onFirstPaint?.(firstPaint)
    await nextFrame()

    // 2. Parse the whole file in pieces, in parallel.
    const workers = warmPool()
    const chunks = splitForParallel(src, workers.length * 2)
    const defs = referenceDefinitions(src)
    const results: (PieceResult | undefined)[] = new Array(chunks.length)
    const outline: OutlineItem[] = []
    let flushed = 0
    let parsedAt = 0
    let previewChecked = false

    const flush = () => {
      // Hand finished pieces to the painter strictly in document order.
      while (flushed < chunks.length && results[flushed]) {
        const r = results[flushed]!
        const base = this.pending.length
        for (const item of r.outline) outline.push({ ...item, b: item.b + base })
        for (const b of r.blocks) this.pending.push(b)
        this.index.add({ texts: r.blocks.map((b) => b.text), folded: r.folded })
        results[flushed++] = undefined // free the memory
        if (!previewChecked) { previewChecked = true; this.reconcilePreview() }
      }
      this.onIndexGrew?.()
      this.wake?.()
    }

    const parsing = new Promise<void>((resolve) => {
      let next = 0
      let done = 0
      const send = (w: Worker) => {
        if (next >= chunks.length) return
        const index = next++
        const c = chunks[index]
        w.postMessage({ id: gen, index, piece: src.slice(c.start, c.end) + defs, base: c.start, opts })
      }
      for (const w of workers) {
        w.onmessage = (e: MessageEvent<PieceResult & { id: number }>) => {
          if (e.data.id !== gen) return
          results[e.data.index] = e.data
          send(w)
          flush()
          if (++done === chunks.length) { parsedAt = performance.now() - t0; resolve() }
        }
        send(w)
      }
    })

    // 3. Paint pieces as they arrive.
    await this.drain(gen, parsing)
    if (gen !== this.gen) return null
    // Assemble the search index in the next idle moment, not on the first keystroke.
    const index = this.index
    setTimeout(() => { if (index === this.index) index.prepare() }, 50)
    return {
      outline,
      blocks: this.pending,
      timings: {
        previewParse, firstPaint, pieces: chunks.length, parsed: parsedAt,
        complete: performance.now() - t0, blocks: this.pending.length, bytes: src.length,
      },
    }
  }

  /** Show text as-is, without Markdown (for .txt files the reader wants plain). */
  showPlain(src: string): LoadResult {
    ++this.gen
    const t0 = performance.now()
    this.sectioned = false
    document.documentElement.dataset.large = 'false'
    this.sections = []
    this.sectionStart = []
    const esc = src.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    const block = { html: `<pre class="plain" data-b="0" data-s="0" data-e="${src.length}">${esc}</pre>`, s: 0, e: src.length, text: src }
    this.doc.innerHTML = block.html
    this.pending = [block]
    this.nextIndex = 1
    this.index = new SearchIndex()
    this.index.add({ texts: [src] })
    this.onIndexGrew?.()
    const t = performance.now() - t0
    this.onFirstPaint?.(laidOut(this.doc, t0))
    return { outline: [], blocks: this.pending, timings: { firstPaint: t, complete: t, blocks: 1, bytes: src.length } }
  }

  /**
   * Keep the preview blocks the full parse agrees with (nearly all of them);
   * the last preview block may differ, because the slice ended there.
   */
  private reconcilePreview(): void {
    const kids = this.doc.children
    let keep = 0
    while (keep < kids.length - 1 && keep < this.pending.length && kids[keep].outerHTML === this.pending[keep].html) keep++
    while (kids.length > keep) kids[kids.length - 1].remove()
    this.nextIndex = keep
    if (this.sectioned) {
      // The kept preview becomes the first section.
      const sec = this.newSection()
      sec.append(...Array.from(kids).filter((k) => k !== sec))
      this.sectionCount = keep
    }
  }

  static SECTION_MIN = 40 // blocks before a section may close at a heading
  static SECTION_MAX = 200 // close regardless, for documents with few headings
  // Placeholder height per byte of HTML until a section is first laid out
  // (roughly right for body text; WebKit remembers the true height afterwards).
  static PX_PER_HTML_BYTE = 0.2

  private newSection(): HTMLElement {
    const prev = this.sections[this.sections.length - 1]
    if (prev) prev.style.setProperty('contain-intrinsic-size', `auto ${Math.round(this.sectionBytes * Reader.PX_PER_HTML_BYTE)}px`)
    const sec = document.createElement('section')
    sec.className = 'cv'
    this.doc.append(sec)
    this.sections.push(sec)
    this.sectionStart.push(this.nextIndex)
    this.sectionCount = 0
    this.sectionBytes = 0
    return sec
  }

  /** Append blocks in small slices, yielding to input and painting between, until parsing is done and all are in. */
  private async drain(gen: number, parsing: Promise<void>): Promise<void> {
    let parsed = false
    parsing.then(() => { parsed = true; this.wake?.() })
    while (gen === this.gen) {
      if (this.nextIndex < this.pending.length) {
        this.appendFor()
        this.onBlocksAdded?.()
        await yieldTask()
      } else if (parsed) {
        return
      } else {
        await new Promise<void>((r) => (this.wake = r))
        this.wake = null
      }
    }
  }

  // The cost of a slice is parsing its HTML, so slices are sized in bytes.
  // Measured in WebKit on the 5 MB file: see test/browser/bench.spec.ts.
  static SLICE_BYTES = 256_000

  private appendFor(until = -1): void {
    let html = ''
    let target: HTMLElement = this.sectioned ? (this.sections[this.sections.length - 1] ?? this.newSection()) : this.doc
    while (this.nextIndex < this.pending.length) {
      const block = this.pending[this.nextIndex]
      if (this.sectioned) {
        const heading = block.html.startsWith('<h')
        if ((heading && this.sectionCount >= Reader.SECTION_MIN) || this.sectionCount >= Reader.SECTION_MAX) {
          target.insertAdjacentHTML('beforeend', html)
          html = ''
          // Before a heading the last margin is dropped, so spacing matches an unsectioned page.
          if (heading) target.classList.add('hcut')
          target = this.newSection()
        }
        this.sectionCount++
        this.sectionBytes += block.html.length
      }
      html += block.html
      this.nextIndex++
      if (this.nextIndex <= until) continue // must reach block `until`, however long it takes
      if (html.length > Reader.SLICE_BYTES) break
    }
    target.insertAdjacentHTML('beforeend', html)
  }

  /** Make sure block `b` is in the page (outline or search jumping ahead of the painter). */
  ensureBlock(b: number): void {
    if (b < this.nextIndex) return
    this.appendFor(b)
    this.onBlocksAdded?.()
  }

  /** The element for block `b`; with `force`, paints up to it first if needed. */
  blockEl(b: number, force = true): HTMLElement | null {
    if (force) this.ensureBlock(b)
    if (!this.sectioned) return (this.doc.children[b] as HTMLElement) ?? null
    let lo = 0, hi = this.sectionStart.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.sectionStart[mid] <= b) lo = mid; else hi = mid - 1 }
    return (this.sections[lo]?.children[b - this.sectionStart[lo]] as HTMLElement) ?? null
  }

  // Cached block positions for scroll-bar ticks: one measurement per section
  // (or per block on short pages), reused until the layout changes.
  private geo: { tops: number[]; heights: number[] } | null = null

  invalidateGeometry(): void { this.geo = null }

  /** Approximate top of block `b` within the scroller; exact on short pages, interpolated within a section on long ones. */
  blockY(b: number, scroller: HTMLElement): number {
    const units: HTMLElement[] = this.sectioned ? this.sections : (Array.from(this.doc.children) as HTMLElement[])
    if (!this.geo) {
      // Offsets come from boxes WebKit already has, so this stays cheap.
      this.geo = { tops: units.map((u) => topIn(u, scroller)), heights: units.map((u) => u.offsetHeight) }
    }
    if (!this.sectioned) return this.geo.tops[b] ?? 0
    let lo = 0, hi = this.sectionStart.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.sectionStart[mid] <= b) lo = mid; else hi = mid - 1 }
    const start = this.sectionStart[lo]
    const end = this.sectionStart[lo + 1] ?? this.nextIndex
    return this.geo.tops[lo] + ((b - start) / Math.max(1, end - start)) * this.geo.heights[lo]
  }

  get complete(): boolean { return this.nextIndex >= this.pending.length }
}
