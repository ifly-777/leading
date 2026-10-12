// Inline transforms on the mdast tree: Obsidian highlights (==text== and
// <mark …>), wikilinks and all-caps runs.
//
// These run on the parsed tree instead of inside the tokenizer, which keeps
// them small. Every node they create gets exact source positions through the
// offset aligner, so highlights can later be mapped back to the file.

import type { Parent, PhrasingContent, Text, Html, Root } from 'mdast'
import { align, sourceRange, type OffsetMap } from '../sourcemap'
import { colorFromMarkTag, slotForColor } from '../highlight-colors'
import type { Highlight, HighlightSlot, WikiLink } from '../nodes'

const maps = new WeakMap<Text, OffsetMap>()

export function textMap(node: Text, src: string): OffsetMap {
  let m = maps.get(node)
  if (!m) {
    m = align(node.value, src, node.position!.start.offset!, node.position!.end.offset!)
    maps.set(node, m)
  }
  return m
}

function point(offset: number) {
  // Line/column are not used downstream; offsets are what Leading relies on.
  return { line: 1, column: offset + 1, offset }
}

/** A new text node for rendered chars [a, b) of `node`, with exact source positions. */
export function sliceText(node: Text, a: number, b: number, src: string): Text {
  const [s, e] = sourceRange(textMap(node, src), a, b)
  return { type: 'text', value: node.value.slice(a, b), position: { start: point(s), end: point(e) } }
}

// ---------------------------------------------------------------------------
// Pairing: both ==…== and <mark>…</mark> reduce to "open/close markers in a
// flat list of siblings", which are then folded into nested Highlight nodes.

type OpenMarker = { marker: 'open'; slot: HighlightSlot; syntax: 'eq' | 'mark'; hex?: string; start: number }
type CloseMarker = { marker: 'close'; end: number }
type Item = PhrasingContent | OpenMarker | CloseMarker

function nest(items: Item[]): PhrasingContent[] {
  const root: PhrasingContent[] = []
  const stack: { children: PhrasingContent[]; node?: Highlight }[] = [{ children: root }]
  for (const it of items) {
    if ('marker' in it) {
      if (it.marker === 'open') {
        const node: Highlight = {
          type: 'highlight', slot: it.slot, syntax: it.syntax, hex: it.hex, children: [],
          position: { start: point(it.start), end: point(it.start) },
        }
        stack[stack.length - 1].children.push(node)
        stack.push({ children: node.children, node })
      } else {
        const top = stack.pop()!
        top.node!.position!.end = point(it.end)
      }
    } else {
      stack[stack.length - 1].children.push(it)
    }
  }
  return root
}

const MARK_OPEN = /^<mark\b[^>]*>$/i
const MARK_CLOSE = /^<\/mark\s*>$/i

function pairMarkHtml(parent: Parent): void {
  const kids = parent.children as PhrasingContent[]
  if (!kids.some((k) => k.type === 'html' && MARK_OPEN.test((k as Html).value))) return
  const openIdx: number[] = []
  const pairs = new Map<number, number>() // open index → close index
  kids.forEach((k, i) => {
    if (k.type !== 'html') return
    if (MARK_OPEN.test(k.value)) openIdx.push(i)
    else if (MARK_CLOSE.test(k.value) && openIdx.length) pairs.set(openIdx.pop()!, i)
  })
  if (!pairs.size) return
  const closes = new Set(pairs.values())
  const items: Item[] = kids.map((k, i) => {
    if (pairs.has(i)) {
      const color = colorFromMarkTag((k as Html).value)
      const hex = color && /^#/.test(color) ? color : undefined
      return { marker: 'open', slot: slotForColor(color), syntax: 'mark', hex, start: k.position!.start.offset! } as OpenMarker
    }
    if (closes.has(i)) return { marker: 'close', end: k.position!.end.offset! } as CloseMarker
    return k
  })
  parent.children = nest(items) as typeof parent.children
}

/** The rendered character just outside child i (at its start or end), across siblings. */
function neighbour(kids: PhrasingContent[], i: number, dir: -1 | 1): string {
  const k = kids[i + dir]
  if (!k) return ''
  if (k.type === 'text') return dir < 0 ? k.value.slice(-1) : k.value.slice(0, 1)
  if (k.type === 'break') return '\n'
  return 'x' // any other inline node (strong, code, link…) counts as non-space
}

const SPACE = /\s/

function pairEquals(parent: Parent, src: string): void {
  const kids = parent.children as PhrasingContent[]
  type Delim = { child: number; at: number; canOpen: boolean; canClose: boolean }
  const delims: Delim[] = []
  kids.forEach((k, ci) => {
    if (k.type !== 'text' || !k.position || !k.value.includes('==')) return
    const v = k.value
    for (let at = v.indexOf('=='); at >= 0; at = v.indexOf('==', at + 1)) {
      // Exactly two: "===" or "====" are not highlight markers.
      if (v[at - 1] === '=' || v[at + 2] === '=') continue
      const m = textMap(k, src)
      // An escaped "\=" maps back to its backslash.
      if (src[m.from[at]] === '\\' || src[m.from[at + 1]] === '\\') continue
      const before = at > 0 ? v[at - 1] : neighbour(kids, ci, -1)
      const after = at + 2 < v.length ? v[at + 2] : neighbour(kids, ci, 1)
      delims.push({ child: ci, at, canOpen: after !== '' && !SPACE.test(after), canClose: before !== '' && !SPACE.test(before) })
    }
  })
  if (delims.length < 2) return
  // Pair like emphasis: a closer takes the most recent unmatched opener.
  const stack: Delim[] = []
  const paired = new Map<Delim, 'open' | 'close'>()
  for (const d of delims) {
    if (d.canClose && stack.length) { paired.set(stack.pop()!, 'open'); paired.set(d, 'close') }
    else if (d.canOpen) stack.push(d)
  }
  if (!paired.size) return
  const items: Item[] = []
  kids.forEach((k, ci) => {
    const here = delims.filter((d) => d.child === ci && paired.has(d))
    if (!here.length) { items.push(k); return }
    const t = k as Text
    const m = textMap(t, src)
    let last = 0
    for (const d of here) {
      if (d.at > last) items.push(sliceText(t, last, d.at, src))
      items.push(paired.get(d) === 'open'
        ? { marker: 'open', slot: 'yellow', syntax: 'eq', start: m.from[d.at] }
        : { marker: 'close', end: m.to[d.at + 1] })
      last = d.at + 2
    }
    if (last < t.value.length) items.push(sliceText(t, last, t.value.length, src))
  })
  parent.children = nest(items) as typeof parent.children
}

// ---------------------------------------------------------------------------
// Wikilinks and caps both split a text node around regex matches.

const WIKILINK = /(!?)\[\[([^\[\]\n]+?)\]\]/g
// A run of words with at least two capitals each, e.g. "NASA", "ICAO METAR".
const CAPS = /\b[A-Z0-9]*[A-Z][A-Z0-9]*[A-Z][A-Z0-9]*(?:[ \-][A-Z0-9]*[A-Z][A-Z0-9]*[A-Z][A-Z0-9]*)*\b/g

function makeWikiLink(t: Text, a: number, b: number, embed: boolean, inner: string, src: string): WikiLink {
  const [s, e] = sourceRange(textMap(t, src), a, b)
  const bar = inner.indexOf('|')
  const ref = bar >= 0 ? inner.slice(0, bar) : inner
  const alias = bar >= 0 ? inner.slice(bar + 1).trim() : undefined
  const hash = ref.indexOf('#')
  const target = (hash >= 0 ? ref.slice(0, hash) : ref).trim()
  const heading = hash >= 0 ? ref.slice(hash + 1).replace(/^\^/, '').trim() : undefined
  const display = alias || [target, heading].filter(Boolean).join(' › ')
  return { type: 'wikilink', target, heading, alias, embed, display, position: { start: point(s), end: point(e) } }
}

function splitText(parent: Parent, src: string): void {
  if (parent.type === 'caps' || parent.type === 'link' || parent.type === 'linkReference') return
  const kids = parent.children as PhrasingContent[]
  if (!kids.some((k) => k.type === 'text' && k.position && (k.value.includes('[[') || /[A-Z].*[A-Z]/.test(k.value)))) return
  const out: PhrasingContent[] = []
  for (const k of kids) {
    if (k.type !== 'text' || !k.position) { out.push(k); continue }
    const v = k.value
    // Collect matches from both patterns, wikilinks first so their text is never caps-wrapped.
    const hits: { a: number; b: number; make: () => PhrasingContent }[] = []
    for (const m of v.matchAll(WIKILINK)) {
      const a = m.index!, b = a + m[0].length
      hits.push({ a, b, make: () => makeWikiLink(k, a, b, m[1] === '!', m[2], src) })
    }
    for (const m of v.matchAll(CAPS)) {
      const a = m.index!, b = a + m[0].length
      if (hits.some((h) => a < h.b && b > h.a)) continue
      hits.push({ a, b, make: () => ({ type: 'caps', children: [sliceText(k, a, b, src)], position: sliceText(k, a, b, src).position }) })
    }
    if (!hits.length) { out.push(k); continue }
    hits.sort((x, y) => x.a - y.a)
    let last = 0
    for (const h of hits) {
      if (h.a > last) out.push(sliceText(k, last, h.a, src))
      out.push(h.make())
      last = h.b
    }
    if (last < v.length) out.push(sliceText(k, last, v.length, src))
  }
  parent.children = out as typeof parent.children
}

// Nodes whose content is literal and must never be transformed.
const LITERAL = new Set(['code', 'inlineCode', 'html', 'yaml', 'math', 'inlineMath'])

export function transformInline(root: Root, src: string): void {
  const walk = (node: Parent) => {
    if (LITERAL.has(node.type)) return
    pairMarkHtml(node)
    pairEquals(node, src)
    splitText(node, src)
    for (const c of node.children) if ('children' in c) walk(c as Parent)
    // Callout titles live outside `children`.
    if (node.type === 'callout') {
      const holder = { type: 'paragraph', children: (node as any).title } as Parent
      walk(holder)
      ;(node as any).title = holder.children
    }
  }
  walk(root)
}
