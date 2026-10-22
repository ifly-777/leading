// Inline transforms on the mdast tree: Obsidian highlights (==text== and
// <mark …>), wikilinks, all-caps runs, what is left of comments, and block
// ids (^id).
//
// These run on the parsed tree instead of inside the tokenizer, which keeps
// them small. Every node they create gets exact source positions through the
// offset aligner, so highlights can later be mapped back to the file.

import type { Parent, PhrasingContent, Text, Html, Root } from 'mdast'
import { align, sourceRange, type OffsetMap } from '../sourcemap'
import { colorFromMarkTag, slotForColor } from '../highlight-colors'
import type { Highlight, HighlightSlot, WikiLink } from '../nodes'
import { commentAt, type Comment } from '../comments'

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
// Obsidian's tags: #word after a space or at the start, letters, digits, _ - and /
// for nesting, but not digits alone ("#1" is a number, not a tag).
const TAG = /(?<=^|\s)#(?![\p{N}]+(?![\p{L}\p{N}_\-\/]))[\p{L}\p{N}_\-\/]+/gu
const CAPS = /\b[A-Z0-9]*[A-Z][A-Z0-9]*[A-Z][A-Z0-9]*(?:[ \-][A-Z0-9]*[A-Z][A-Z0-9]*[A-Z][A-Z0-9]*)*\b/g

function makeWikiLink(t: Text, a: number, b: number, embed: boolean, inner: string, src: string): WikiLink {
  const [s, e] = sourceRange(textMap(t, src), a, b)
  const bar = inner.indexOf('|')
  const ref = bar >= 0 ? inner.slice(0, bar) : inner
  const alias = bar >= 0 ? inner.slice(bar + 1).trim() : undefined
  const hash = ref.indexOf('#')
  const target = (hash >= 0 ? ref.slice(0, hash) : ref).trim()
  // A block reference keeps its caret ([[Note#^id]]), so it is never taken for a heading.
  const heading = hash >= 0 ? ref.slice(hash + 1).trim() : undefined
  const display = alias || [target, heading?.replace(/^\^/, '')].filter(Boolean).join(' › ')
  return { type: 'wikilink', target, heading, alias, embed, display, position: { start: point(s), end: point(e) } }
}

function splitText(parent: Parent, src: string): void {
  if (parent.type === 'caps' || (parent.type as string) === 'tag' || parent.type === 'link' || parent.type === 'linkReference') return
  const kids = parent.children as PhrasingContent[]
  if (!kids.some((k) => k.type === 'text' && k.position && (k.value.includes('[[') || k.value.includes('#') || /[A-Z].*[A-Z]/.test(k.value)))) return
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
    for (const m of v.matchAll(TAG)) {
      const a = m.index!, b = a + m[0].length
      if (hits.some((h) => a < h.b && b > h.a)) continue
      hits.push({ a, b, make: () => ({ type: 'tag', children: [sliceText(k, a, b, src)], position: sliceText(k, a, b, src).position } as any) })
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

export function transformInline(root: Root, src: string, comments: Comment[] = []): void {
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
  if (comments.length) {
    dropComments(root, src, comments)
    attachNotes(root, comments)
  }
  if (src.includes('^')) blockIds(root, src)
}

// ---------------------------------------------------------------------------
// Comments: blanked before parsing (comments.ts); the blanks are cut out here.

function dropComments(node: Parent, src: string, comments: Comment[]): void {
  if (LITERAL.has(node.type)) return
  const out: any[] = []
  let changed = false
  for (const k of node.children as any[]) {
    if (k.type === 'text' && k.position) {
      const p = k.position
      // Only text that overlaps a comment is cut.
      const first = commentAt(comments, p.start.offset) ?? comments.find((c) => c.s >= p.start.offset && c.s < p.end.offset)
      if (first) {
        changed = true
        const m = textMap(k, src)
        let a = -1
        for (let i = 0; i <= k.value.length; i++) {
          const inside = i < k.value.length && commentAt(comments, m.from[i]) !== null
          if (!inside && i < k.value.length) { if (a < 0) a = i; continue }
          if (a >= 0) { out.push(sliceText(k, a, i, src)); a = -1 }
        }
        continue
      }
    }
    if ('children' in k) dropComments(k, src, comments)
    // A paragraph that held nothing but a comment goes.
    if (k.type === 'paragraph' && !k.children.length) { changed = true; continue }
    out.push(k)
  }
  if (changed) node.children = out
  if ((node as any).type === 'callout') {
    const holder = { type: 'paragraph', children: (node as any).title } as Parent
    dropComments(holder, src, comments)
    ;(node as any).title = holder.children
  }
}

/** A comment written straight after a highlight is its note. */
function attachNotes(root: Parent, comments: Comment[]): void {
  const byStart = new Map(comments.map((c) => [c.s, c]))
  const walk = (node: any) => {
    if (node.type === 'highlight') {
      const c = byStart.get(node.position?.end.offset)
      if (c) node.note = { text: c.body.trim(), s: c.s, e: c.e }
    }
    if (node.children) for (const k of node.children) walk(k)
    if (node.title) for (const k of node.title) walk(k)
  }
  walk(root)
}

// ---------------------------------------------------------------------------
// Block ids: "^id" at the end of a block names it, so [[Note#^id]] can link to
// it and ![[Note#^id]] embed it. A table, quotation or list is named by a
// "^id" on its own line just after it. The id becomes the element's id on the
// page, caret and all, and is not shown.

const BLOCK_ID = /(^|\s)\^([A-Za-z0-9-]+)[ \t]*$/

function setId(node: any, id: string): void {
  node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: '^' + id } }
}

function blockIds(node: Parent, src: string): void {
  if (LITERAL.has(node.type)) return
  const kids = node.children as any[]
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    if (k.type !== 'paragraph') { if ('children' in k) blockIds(k, src); continue }
    const last = k.children[k.children.length - 1]
    if (last?.type !== 'text') continue
    const m = BLOCK_ID.exec(last.value)
    if (!m) continue
    if (m.index === 0 && !m[1] && k.children.length === 1) {
      // "^id" alone: it names the block before it.
      if (i > 0 && kids[i - 1].type !== 'heading') { setId(kids[i - 1], m[2]); kids.splice(i--, 1) }
      continue
    }
    // The text before it, without the space that separated them.
    const cut = last.value.slice(0, m.index).replace(/\s+$/, '').length
    if (cut && last.position) k.children[k.children.length - 1] = sliceText(last, 0, cut, src)
    else if (cut) last.value = last.value.slice(0, cut)
    else k.children.pop()
    // In a list, the item is the block Obsidian names.
    setId(node.type === 'listItem' ? node : k, m[2])
  }
}
