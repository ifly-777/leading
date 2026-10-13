// Writing highlights into the Markdown source.
//
// The reader selects rendered text; the caller maps the selection's two ends
// to source offsets (sourcemap.ts) and names the top-level blocks it touches.
// Here, each block is parsed on its own and the selection becomes highlight
// markers placed where Markdown allows them:
//
// - One highlight per paragraph, heading or table cell; markers never cross them.
// - A formatting run covered completely gets the markers outside it
//   (==**bold** idea==); one covered in part gets them inside (**bo==ld==**).
// - Code, wikilinks and images are never split: a partial selection takes them whole.
// - Existing highlights the selection touches are taken out and the parts
//   outside the selection are put back in their old colour and syntax, so a
//   new colour replaces only the overlap. Highlights it does not touch stay
//   byte for byte as they were.
//
// Every result is checked before it is returned: the edited block is parsed
// again, and its text must read exactly as before, with exactly the expected
// characters highlighted in the expected colours, and with the same structure
// (links, bold, lists) as before. If ==…== fails that check, <mark>…</mark>
// (which has no spacing rules) is tried; if that fails too, nothing is written.

import type { Root, Parent } from 'mdast'
import { parse } from './pipeline'
import { align } from './sourcemap'
import { STORED_HEX } from './highlight-colors'
import { textOf } from './text'
import type { Highlight, HighlightSlot } from './nodes'
import type { Edit } from './format'

export type HighlightResult =
  | { ok: true; edits: Edit[] }
  | { ok: false; reason: string }

export interface HighlightOptions {
  /** Applying the colour a selection already has removes it (keyboard shortcuts). */
  toggle?: boolean
  /** Reference-link definitions from the whole file, so [text][ref] parses as a link inside one block. */
  defs?: string
}

/** One rendered piece of a paragraph, heading or cell: a character of text, or a whole atomic item. */
interface Unit {
  /** Which phrasing container (paragraph, heading, cell) it belongs to */
  c: number
  s: number
  e: number
  ch: string
  ws: boolean
  /** Enclosing highlights, outermost first */
  hl: Highlight[]
}

const ATOMIC = new Set(['inlineCode', 'wikilink', 'image', 'imageReference', 'footnoteReference', 'inlineMath'])
const CONTAINERS = new Set(['paragraph', 'heading', 'tableCell'])
const SKIP = new Set(['code', 'yaml', 'html', 'math', 'definition', 'footnoteDefinition', 'thematicBreak'])
const WS = /\s/

function collect(tree: Root, src: string, limit: number): Unit[] {
  const units: Unit[] = []
  let c = -1
  const inline = (kids: any[], hl: Highlight[]) => {
    for (const k of kids) {
      const p = k.position
      if (k.type === 'text') {
        if (!p) continue
        const m = align(k.value, src, p.start.offset, p.end.offset)
        for (let i = 0; i < k.value.length; i++) {
          units.push({ c, s: m.from[i], e: m.to[i], ch: k.value[i], ws: WS.test(k.value[i]), hl })
        }
      } else if (k.type === 'highlight') {
        inline(k.children, [...hl, k])
      } else if (ATOMIC.has(k.type)) {
        if (p) units.push({ c, s: p.start.offset, e: p.end.offset, ch: textOf(k) || '￼', ws: false, hl })
      } else if (k.type === 'break') {
        if (p) units.push({ c, s: p.start.offset, e: p.end.offset, ch: '\n', ws: true, hl })
      } else if (Array.isArray(k.children)) {
        inline(k.children, hl)
      }
    }
  }
  const block = (n: any) => {
    if (SKIP.has(n.type)) return
    if (n.position && n.position.start.offset >= limit) return // the appended link definitions
    if (CONTAINERS.has(n.type)) { c++; inline(n.children, []); return }
    if (n.type === 'callout') { c++; inline(n.title, []) }
    if (Array.isArray(n.children)) for (const k of n.children) block(k)
  }
  block(tree)
  return units
}

// ---------------------------------------------------------------------------
// What to write

interface Spec { slot: HighlightSlot; open: string; close: string; eq: boolean }

function newSpec(slot: HighlightSlot, forceMark: boolean): Spec {
  if (slot === 'yellow') return forceMark ? { slot, open: '<mark>', close: '</mark>', eq: false } : { slot, open: '==', close: '==', eq: true }
  return { slot, open: `<mark style="background: ${STORED_HEX[slot]};">`, close: '</mark>', eq: false }
}

/** The markers of an existing highlight: [open start, open end, close start, close end]. */
function markersOf(h: Highlight, src: string): [number, number, number, number] {
  const s = h.position!.start.offset!, e = h.position!.end.offset!
  if (h.syntax === 'eq') return [s, s + 2, e - 2, e]
  return [s, src.indexOf('>', s) + 1, src.lastIndexOf('<', e - 1), e]
}

/** How an existing highlight is put back around the parts of it that stay. */
function specOf(h: Highlight, src: string, forceMark: boolean): Spec {
  const [a, b, c, d] = markersOf(h, src)
  if (h.syntax === 'eq') return forceMark ? { slot: h.slot, open: '<mark>', close: '</mark>', eq: false } : { slot: h.slot, open: '==', close: '==', eq: true }
  return { slot: h.slot, open: src.slice(a, b), close: src.slice(c, d), eq: false }
}

// CommonMark's flanking rules, as Obsidian applies them to == like any other
// delimiter: an opener must be followed by text, a closer preceded by it, and
// punctuation next to a delimiter needs space or punctuation on its far side.
const PUNCT = /[\p{P}\p{S}]/u
const isWs = (ch: string) => ch === '' || WS.test(ch)
const isPunct = (ch: string) => PUNCT.test(ch)

function canOpen(prev: string, next: string): boolean {
  if (prev === '=' || next === '=') return false
  if (isWs(next)) return false
  return !isPunct(next) || isWs(prev) || isPunct(prev)
}
function canClose(prev: string, next: string): boolean {
  if (prev === '=' || next === '=') return false
  if (isWs(prev)) return false
  return !isPunct(prev) || isWs(next) || isPunct(next)
}

// ---------------------------------------------------------------------------
// Placing markers for one run of text, in a block with no highlights in the way

type Span = [number, number]

/** Units sorted by position; the ones inside [a, b). */
function unitsIn(units: Unit[], a: number, b: number): Unit[] {
  let lo = 0, hi = units.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (units[mid].s < a) lo = mid + 1; else hi = mid }
  const out: Unit[] = []
  for (let i = lo; i < units.length && units[i].e <= b; i++) out.push(units[i])
  return out
}

const HTML_OPEN = /^<([a-z][a-z0-9-]*)\b[^>]*>$/i
const HTML_CLOSE = /^<\/([a-z][a-z0-9-]*)\s*>$/i

/**
 * Children as placement sees them: caps runs (Leading's own, with no markup)
 * dissolve into their text, and inline HTML tag pairs such as <u>…</u>
 * become one node, so a run never takes an opening tag without its closing one.
 */
function expand(kids: any[]): any[] {
  const flat: any[] = []
  for (const k of kids) { if (k.type === 'caps') flat.push(...k.children); else flat.push(k) }
  const out: any[] = []
  const stack: { tag: string; at: number }[] = []
  for (const k of flat) {
    if (k.type === 'html') {
      const o = HTML_OPEN.exec(k.value.trim())
      const c = HTML_CLOSE.exec(k.value.trim())
      if (o && !k.value.trim().endsWith('/>')) { stack.push({ tag: o[1].toLowerCase(), at: out.length }); out.push(k); continue }
      if (c) {
        const i = stack.map((x) => x.tag).lastIndexOf(c[1].toLowerCase())
        if (i >= 0) {
          const { at } = stack[i]
          stack.length = i
          const open = out[at]
          const inner = out.splice(at)
          inner.shift()
          out.push({ type: 'htmlPair', children: inner, position: { start: open.position.start, end: k.position.end } })
          continue
        }
      }
    }
    out.push(k)
  }
  return out
}

function place(kids: any[], units: Unit[], rx: number, ry: number, out: Span[]): void {
  const sel = (u: Unit) => u.s < ry && u.e > rx
  let start = -1, end = -1
  const close = () => { if (start >= 0 && end > start) out.push([start, end]); start = -1; end = -1 }
  for (const k of expand(kids)) {
    const p = k.position
    if (!p || k.type === 'html' || k.type === 'break') continue // no text of its own: neither starts nor ends a run
    const ks = p.start.offset, ke = p.end.offset
    const inside = unitsIn(units, ks, ke)
    if (k.type === 'text') {
      const hit = inside.filter((u) => sel(u) && !u.ws)
      if (!hit.length) {
        if (inside.some((u) => !u.ws)) close() // uncovered text: the run cannot pass it
        continue
      }
      const solid = inside.filter((u) => !u.ws)
      if (start >= 0 && hit[0] !== solid[0]) close() // text skipped before this part: a new run
      if (start < 0) start = hit[0].s
      end = hit[hit.length - 1].e
      if (hit[hit.length - 1] !== solid[solid.length - 1]) close() // text left over after the run
      continue
    }
    const solid = inside.filter((u) => !u.ws)
    const covered = solid.filter(sel)
    if (!covered.length) { if (solid.length) close(); continue }
    if (covered.length === solid.length || ATOMIC.has(k.type)) {
      if (start < 0) start = ks
      end = ke
      continue
    }
    // Partly covered formatting: the markers go inside it.
    close()
    place(k.children ?? [], units, rx, ry, out)
  }
  close()
}

/** The phrasing containers of a tree, in the same order collect() numbers them. */
function containers(tree: Root, limit: number): any[][] {
  const out: any[][] = []
  const block = (n: any) => {
    if (SKIP.has(n.type)) return
    if (n.position && n.position.start.offset >= limit) return
    if (CONTAINERS.has(n.type)) { out.push(n.children); return }
    if (n.type === 'callout') out.push(n.title)
    if (Array.isArray(n.children)) for (const k of n.children) block(k)
  }
  block(tree)
  return out
}

// ---------------------------------------------------------------------------
// Checking a result

/** The tree's structure with highlights and caps dissolved, for comparing before and after. */
function shape(n: any): string {
  if (n.type === 'highlight' || n.type === 'caps') return n.children.map(shape).join('')
  if (n.type === 'text') return n.value.replace(/[<>]/g, (c: string) => (c === '<' ? '\u0001' : '\u0002'))
  const attrs = [n.url, n.depth, n.ordered, n.checked, n.align?.join(), n.display, n.alt, n.calloutType,
    n.type === 'inlineCode' || n.type === 'code' || n.type === 'html' ? n.value : undefined].filter((x) => x !== undefined && x !== null).join('|')
  const kids = (n.title ? n.title.map(shape).join('') + '¦' : '') + (Array.isArray(n.children) ? n.children.map(shape).join('') : '')
  return `<${n.type} ${attrs}>${kids}</${n.type}>`
}

function blockShape(tree: Root, limit: number): string {
  return tree.children.filter((c) => (c.position?.start.offset ?? 0) < limit).map(shape).join('')
}

const colourOf = (u: Unit): HighlightSlot | null => (u.hl.length ? u.hl[u.hl.length - 1].slot : null)

// ---------------------------------------------------------------------------

function parseBlock(text: string, defs: string): Root {
  return parse(defs ? text + '\n\n' + defs : text)
}

/** One block: the new text of it, or null if it cannot be done safely. */
function editBlock(B: string, x: number, y: number, slot: HighlightSlot | null, defs: string, forceMark: boolean): string | null {
  const T = parseBlock(B, defs)
  const units = collect(T, B, B.length)
  const sel = (u: Unit) => u.s < y && u.e > x
  if (!units.some((u) => sel(u) && !u.ws)) return B

  // 1. Take out every highlight the selection touches.
  const strip = new Set<Highlight>()
  for (const u of units) if (sel(u)) for (const h of u.hl) strip.add(h)
  const cuts: Span[] = []
  for (const h of strip) { const [a, b, c, d] = markersOf(h, B); cuts.push([a, b], [c, d]) }
  cuts.sort((p, q) => p[0] - q[0])
  let B1 = ''
  let last = 0
  for (const [a, b] of cuts) { B1 += B.slice(last, a); last = b }
  B1 += B.slice(last)
  const map1 = (pos: number) => { let d = 0; for (const [a, b] of cuts) { if (b <= pos) d += b - a; else if (a < pos) d += pos - a } return pos - d }

  // 2. Decide what each character should be: the new colour inside the
  //    selection, the old highlight's colour in what remains of it.
  const fresh = slot ? newSpec(slot, forceMark) : null
  const specs = new Map<Highlight, Spec>()
  const specFor = (u: Unit): Spec | null => {
    if (sel(u)) return fresh
    for (let i = u.hl.length - 1; i >= 0; i--) {
      const h = u.hl[i]
      if (strip.has(h)) {
        if (!specs.has(h)) specs.set(h, specOf(h, B, forceMark))
        return specs.get(h)!
      }
    }
    return null
  }
  // Runs of consecutive characters written the same way, within one container.
  const runs: { c: number; spec: Spec; a: number; b: number }[] = []
  let cur: (typeof runs)[number] | null = null
  for (const u of units) {
    const spec = specFor(u)
    const key = spec && spec.open + '\0' + spec.close
    if (cur && spec && u.c === cur.c && key === cur.spec.open + '\0' + cur.spec.close) { if (!u.ws) cur.b = u.e; continue }
    if (cur) { runs.push(cur); cur = null }
    if (spec && !u.ws) cur = { c: u.c, spec, a: u.s, b: u.e }
  }
  if (cur) runs.push(cur)

  // 3. Place the markers for each run in the text without the old highlights.
  const T1 = parseBlock(B1, defs)
  const units1 = collect(T1, B1, B1.length)
  const conts = containers(T1, B1.length)
  const inserts: { at: number; text: string; order: number }[] = []
  let order = 0
  for (const r of runs) {
    const rx = map1(r.a), ry = map1(r.b)
    const kids = conts[r.c]
    if (!kids) return null
    const spans: Span[] = []
    place(kids, units1, rx, ry, spans)
    for (const [a, b] of spans) {
      let spec = r.spec
      if (spec.eq && !(canOpen(B1[a - 1] ?? '', B1[a] ?? '') && canClose(B1[b - 1] ?? '', B1[b] ?? ''))) {
        spec = { ...spec, open: '<mark>', close: '</mark>', eq: false }
      }
      inserts.push({ at: a, text: spec.open, order: order++ }, { at: b, text: spec.close, order: order++ })
    }
  }
  // Write them in; at the same spot, a closing marker goes before the next opening one.
  inserts.sort((p, q) => p.at - q.at || p.order - q.order)
  let B2 = ''
  let from1 = 0
  const eqAt: { at: number; open: boolean }[] = []
  for (const ins of inserts) {
    B2 += B1.slice(from1, ins.at)
    from1 = ins.at
    if (ins.text === '==') eqAt.push({ at: B2.length, open: ins.order % 2 === 0 })
    B2 += ins.text
  }
  B2 += B1.slice(from1)
  // == must also suit its final neighbours (another highlight's markers may now touch it).
  for (const { at, open } of eqAt) {
    const prev = B2[at - 1] ?? '', next = B2[at + 2] ?? ''
    if (open ? !canOpen(prev, next) : !canClose(prev, next)) return null
  }

  // 4. Check: same text, same structure, and exactly the colours intended.
  const T2 = parseBlock(B2, defs)
  if (blockShape(T2, B2.length) !== blockShape(T, B.length)) return null
  const want = units.filter((u) => !u.ws).map((u) => [u.ch, sel(u) ? slot : colourOf(u)] as const)
  const got = collect(T2, B2, B2.length).filter((u) => !u.ws).map((u) => [u.ch, colourOf(u)] as const)
  if (want.length !== got.length) return null
  for (let i = 0; i < want.length; i++) if (want[i][0] !== got[i][0] || want[i][1] !== got[i][1]) return null
  return B2
}

/** The smallest single edit turning `a` into `b`, at offset `base`. */
function diff(a: string, b: string, base: number): Edit | null {
  if (a === b) return null
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let q = 0
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++
  return { from: base + p, to: base + a.length - q, insert: b.slice(p, b.length - q) }
}

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

/**
 * Highlight source range [from, to) in `slot`, or remove highlights there
 * (`slot` null). `blocks` are the source ranges of the top-level blocks the
 * selection touches, as rendered (or as the editor's parser sees them).
 */
export function highlightEdits(src: string, blocks: Span[], from: number, to: number, slot: HighlightSlot | null, opts: HighlightOptions = {}): HighlightResult {
  const fm = FRONT_MATTER.exec(src)
  if (fm) from = Math.max(from, fm[0].length)
  if (to <= from) return { ok: true, edits: [] }
  const pieces = blocks
    .filter(([s, e]) => s >= 0 && e > s && s < to && e > from)
    .map(([s, e]) => {
      const s0 = src.lastIndexOf('\n', s - 1) + 1 // from the start of its line, so indentation parses the same
      return { s: s0, B: src.slice(s0, e), x: Math.max(from, s0) - s0, y: Math.min(to, e) - s0 }
    })
  const defs = opts.defs ?? ''

  if (opts.toggle && slot) {
    // Already all this colour? Then the shortcut takes it off instead.
    let any = false
    const all = pieces.every(({ B, x, y }) => {
      const us = collect(parseBlock(B, defs), B, B.length).filter((u) => u.s < y && u.e > x && !u.ws)
      if (us.length) any = true
      return us.every((u) => colourOf(u) === slot)
    })
    if (any && all) slot = null
  }

  const edits: Edit[] = []
  for (const { s, B, x, y } of pieces) {
    const B2 = editBlock(B, x, y, slot, defs, false) ?? editBlock(B, x, y, slot, defs, true)
    if (B2 === null) return { ok: false, reason: 'Leading could not place this highlight without changing how the text reads, so nothing was written.' }
    const e = diff(B, B2, s)
    if (e) edits.push(e)
  }
  return { ok: true, edits }
}

/** The highlight around source offset `pos`, as [start, end) including its markers, if there is one. */
export function highlightAt(src: string, block: Span, pos: number, defs = ''): Span | null {
  const s0 = src.lastIndexOf('\n', block[0] - 1) + 1
  const B = src.slice(s0, block[1])
  const x = pos - s0
  let best: Span | null = null
  for (const u of collect(parseBlock(B, defs), B, B.length)) {
    const h = u.hl[u.hl.length - 1]
    if (!h) continue
    const a = h.position!.start.offset!, b = h.position!.end.offset!
    if (a <= x && x <= b && (!best || b - a < best[1] - best[0])) best = [a + s0, b + s0]
  }
  return best
}

/** The slots used in source range [from, to), for showing the current colour in the palette. */
export function slotsIn(src: string, blocks: Span[], from: number, to: number, defs = ''): Set<HighlightSlot> {
  const out = new Set<HighlightSlot>()
  for (const [s, e] of blocks) {
    if (s < 0 || e <= from || s >= to) continue
    const s0 = src.lastIndexOf('\n', s - 1) + 1
    const B = src.slice(s0, e)
    for (const u of collect(parseBlock(B, defs), B, B.length)) {
      if (u.s + s0 < to && u.e + s0 > from && !u.ws) { const c = colourOf(u); if (c) out.add(c) }
    }
  }
  return out
}

/** For tests: the rendered pieces of a document with their source ranges and colours. */
export function unitsForTest(src: string): { s: number; e: number; ch: string; ws: boolean; slot: HighlightSlot | null }[] {
  return collect(parse(src), src, src.length).map((u) => ({ s: u.s, e: u.e, ch: u.ch, ws: u.ws, slot: colourOf(u) }))
}

/** For tests: the document's structure with highlights dissolved. */
export function shapeForTest(src: string): string {
  return blockShape(parse(src), src.length)
}
