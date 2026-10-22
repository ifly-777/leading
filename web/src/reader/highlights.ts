// Highlighting while reading: the palette that appears over a selection (or
// over a highlight that is clicked), and the mapping from a place on the page
// back to the exact offset in the Markdown source.
//
// Every run of text on the page sits in a span carrying its source range
// (data-s, data-e). Within it, the offset aligner (sourcemap.ts) knows how
// each displayed character relates to the source: curly quotes, entities,
// escapes and line prefixes included. Code, wikilinks and images count as
// one piece each.

import { align } from '../core/sourcemap'
import { snapToWords, OBJECT } from '../core/snap'
import { SLOTS } from '../core/highlight-colors'
import type { HighlightSlot } from '../core/nodes'

export const SLOT_NAMES: Record<HighlightSlot, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink', orange: 'Orange' }

/** Five colour dots and a remove button; shared by the reading palette and edit mode's format bar. */
export function paletteButtons(onPick: (slot: HighlightSlot | null) => void): HTMLButtonElement[] {
  const make = (cls: string, label: string, title: string, pick: HighlightSlot | null) => {
    const b = document.createElement('button')
    b.className = cls
    b.title = title
    b.setAttribute('aria-label', label)
    // mousedown, not click: the selection must survive the press.
    b.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(pick) })
    // Keyboard users reach the buttons with Tab and press them with Space or Return.
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(pick) } })
    return b
  }
  const dots = SLOTS.map((s, i) => {
    const b = make('hl-dot', `${SLOT_NAMES[s]} highlight`, `${SLOT_NAMES[s]} (⌥⌘${i + 1})`, s)
    b.dataset.c = s
    return b
  })
  const remove = make('hl-remove', 'Remove highlight', 'Remove highlight (⌥⌘0)', null)
  remove.textContent = '⌫'
  return [...dots, remove]
}

/** Show which colours the target already has, and whether there is anything to remove. */
export function showCurrent(buttons: HTMLElement[], slots: Set<string>): void {
  for (const b of buttons) {
    if (b.classList.contains('hl-remove')) b.hidden = !slots.size
    else b.setAttribute('aria-pressed', String(slots.has(b.dataset.c!)))
  }
}

// ---------------------------------------------------------------------------
// Page → source

/** The first or last text node inside `n` (or `n` itself). */
function textEdge(n: Node, last: boolean): Text | null {
  if (n.nodeType === 3) return n as Text
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT)
  let t: Text | null = null
  if (!last) return w.nextNode() as Text | null
  while (w.nextNode()) t = w.currentNode as Text
  return t
}

/** A range end as (text node, offset), stepping into elements. */
function textPoint(node: Node, offset: number, end: boolean): [Text, number] | null {
  if (node.nodeType === 3) return [node as Text, offset]
  const kids = node.childNodes
  if (!end && offset < kids.length) { const t = textEdge(kids[offset], false); if (t) return [t, 0] }
  if (end && offset > 0) { const t = textEdge(kids[offset - 1], true); if (t) return [t, t.data.length] }
  const t = textEdge(node, end)
  return t ? [t, end ? t.data.length : 0] : null
}

export interface PagePoint { b: number; offset: number }

/**
 * Where a point on the page sits in the source: `end` for the end of a
 * selection. `correction` turns offsets written on the page into offsets in
 * the current text (see Reader.patch).
 */
export function pointToSource(node: Node, offset: number, end: boolean, text: string, correction: (b: number) => number): PagePoint | null {
  const tp = textPoint(node, offset, end)
  if (!tp) return null
  const [t, o] = tp
  const block = t.parentElement?.closest<HTMLElement>('[data-b]')
  const holder = t.parentElement?.closest<HTMLElement>('[data-s]')
  if (!block || !holder) return null
  const b = Number(block.dataset.b)
  const d = correction(b)
  const s = Number(holder.dataset.s) + d
  const e = Number(holder.dataset.e) + d
  // A text run (a span holding only this text): exact, character by character.
  if (holder.tagName === 'SPAN' && holder.childNodes.length === 1 && holder.firstChild === t && !holder.classList.contains('wikilink')) {
    const m = align(t.data, text, s, e)
    const n = t.data.length
    if (!n) return { b, offset: s }
    if (!end) return { b, offset: o < n ? m.from[o] : m.to[n - 1] }
    return { b, offset: o > 0 ? m.to[o - 1] : m.from[0] }
  }
  // Code, a wikilink, an image: one piece, taken whole.
  return { b, offset: end ? e : s }
}

// ---------------------------------------------------------------------------
// Snapping a selection to whole words

// Elements that start a new run of text: words never join across them.
const BLOCKISH = /^(?:P|LI|TD|TH|H[1-6]|DT|DD|DIV|BLOCKQUOTE|PRE|SUMMARY|DETAILS|UL|OL|TABLE|TR|FIGURE|FIGCAPTION|SECTION|BR)$/
// Things taken whole, whose own text (KaTeX's, a checkbox's) is not words in the line.
const WHOLE = '.math, img, input'

/**
 * The text of a block as one string, with each text node's place in it.
 * Line and cell boundaries become a newline, a formula or picture one
 * object character, so words are cut where the reader sees them cut.
 */
function flatten(block: Element): { text: string; nodes: Text[]; at: number[] } {
  let text = ''
  const nodes: Text[] = []
  const at: number[] = []
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { nodes.push(c as Text); at.push(text.length); text += (c as Text).data; continue }
      if (c.nodeType !== 1) continue
      const el = c as Element
      if (el.matches(WHOLE)) { text += OBJECT; continue }
      if (BLOCKISH.test(el.tagName)) text += '\n'
      walk(el)
    }
  }
  walk(block)
  return { text, nodes, at }
}

/**
 * A selection widened to word edges (see core/snap.ts), or the same Range
 * object, untouched, when its edges already sit where they should.
 */
export function snapRange(range: Range, lang: string): Range {
  const a = textPoint(range.startContainer, range.startOffset, false)
  const z = textPoint(range.endContainer, range.endOffset, true)
  if (!a || !z) return range
  // Each edge is snapped within its own block; a selection can span several.
  const blockOf = (t: Text) => t.parentElement?.closest('[data-b]') ?? null
  const ba = blockOf(a[0]), bz = blockOf(z[0])
  if (!ba || !bz) return range
  const fa = flatten(ba)
  const fz = bz === ba ? fa : flatten(bz)
  const ia = fa.nodes.indexOf(a[0]), iz = fz.nodes.indexOf(z[0])
  if (ia < 0 || iz < 0) return range // inside a formula: taken whole anyway
  const s0 = fa.at[ia] + a[1], e0 = fz.at[iz] + z[1]
  const s = ba === bz ? snapToWords(fa.text, s0, e0, lang)[0] : snapToWords(fa.text, s0, fa.text.length, lang)[0]
  const e = ba === bz ? snapToWords(fz.text, s0, e0, lang)[1] : snapToWords(fz.text, 0, e0, lang)[1]
  if (s === s0 && e === e0) return range
  // Back to (node, offset): a start goes in the node holding the character
  // after it, an end in the node holding the character before it.
  const place = (f: ReturnType<typeof flatten>, i: number, end: boolean): [Text, number] => {
    let k = f.nodes.length - 1
    while (k > 0 && (end ? f.at[k] >= i : f.at[k] > i)) k--
    return [f.nodes[k], Math.min(i - f.at[k], f.nodes[k].data.length)]
  }
  const r = range.cloneRange()
  if (s !== s0) r.setStart(...place(fa, s, false))
  if (e !== e0) r.setEnd(...place(fz, e, true))
  return r
}

// ---------------------------------------------------------------------------
// The palette

export type PaletteTarget = { kind: 'selection'; range: Range } | { kind: 'mark'; mark: HTMLElement }

export class ReaderPalette {
  readonly el: HTMLElement
  private buttons: HTMLButtonElement[]
  target: PaletteTarget | null = null
  /** The reader picked a colour (null: remove). */
  onPick: (slot: HighlightSlot | null, target: PaletteTarget) => void = () => {}
  /** The reader asked to write a note on a highlight. */
  onNote: (mark: HTMLElement) => void = () => {}
  /** The palette came up over a target (the view shows a highlight's note beside it). */
  onShow: (t: PaletteTarget) => void = () => {}
  private noteButton: HTMLButtonElement
  /** Only while reading. */
  active = () => true
  private pointerDown = false

  constructor(win: HTMLElement, private frame: HTMLElement, scroller: HTMLElement, private doc: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'format-popover hl-palette'
    this.el.hidden = true
    this.el.setAttribute('role', 'toolbar')
    this.el.setAttribute('aria-label', 'Highlight')
    this.buttons = paletteButtons((slot) => { if (this.target) this.onPick(slot, this.target) })
    // A note belongs to a highlight that exists, so the pencil shows over highlights only.
    this.noteButton = document.createElement('button')
    this.noteButton.className = 'hl-note-btn'
    this.noteButton.textContent = '✎'
    const pickNote = (e: Event) => {
      e.preventDefault()
      const t = this.target
      if (t?.kind !== 'mark') return
      this.hide()
      this.onNote(t.mark)
    }
    this.noteButton.addEventListener('mousedown', pickNote)
    this.noteButton.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') pickNote(e) })
    this.el.append(...this.buttons, this.noteButton)
    win.append(this.el)

    document.addEventListener('pointerdown', (e) => {
      if (this.el.contains(e.target as Node)) return
      this.pointerDown = true
      this.hide()
    })
    document.addEventListener('pointerup', (e) => {
      this.pointerDown = false
      if (!this.active() || !doc.contains(e.target as Node)) return
      // After the browser has finished extending the selection.
      setTimeout(() => this.fromSelection(e.target as Element), 0)
    })
    document.addEventListener('keydown', (e) => {
      if (['Meta', 'Shift', 'Alt', 'Control'].includes(e.key)) return
      if (this.el.contains(e.target as Node)) { if (e.key === 'Escape') this.hide(); return }
      this.hide()
    }, true)
    document.addEventListener('selectionchange', () => {
      if (this.target?.kind === 'selection' && !this.pointerDown && window.getSelection()?.isCollapsed) this.hide()
    })
    scroller.addEventListener('scroll', () => this.hide(), { passive: true })
  }

  private fromSelection(clicked: Element): void {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const range = sel.getRangeAt(0)
      if (!this.doc.contains(range.commonAncestorContainer)) return
      if (!range.toString().trim()) return
      this.show({ kind: 'selection', range: range.cloneRange() })
      return
    }
    // A plain click on a highlight offers to change or remove it.
    const mark = clicked.closest?.('.doc mark.hl') as HTMLElement | null
    if (mark && !clicked.closest('a[href]')) this.show({ kind: 'mark', mark })
  }

  /** The colours already on the target. */
  private slotsOf(t: PaletteTarget): Set<string> {
    if (t.kind === 'mark') return new Set([t.mark.dataset.c!])
    const out = new Set<string>()
    const root = t.range.commonAncestorContainer
    const scope = root.nodeType === 1 ? (root as Element) : root.parentElement!
    const up = scope.closest('mark.hl')
    if (up) out.add((up as HTMLElement).dataset.c!)
    scope.querySelectorAll<HTMLElement>('mark.hl').forEach((m) => { if (t.range.intersectsNode(m)) out.add(m.dataset.c!) })
    return out
  }

  show(t: PaletteTarget): void {
    this.target = t
    showCurrent(this.buttons, this.slotsOf(t))
    this.noteButton.hidden = t.kind !== 'mark'
    if (t.kind === 'mark') {
      const label = t.mark.dataset.note ? 'Change note' : 'Add a note'
      this.noteButton.title = label
      this.noteButton.setAttribute('aria-label', label)
    }
    const rect = (t.kind === 'mark' ? t.mark.getClientRects()[0] : t.range.getClientRects()[0]) ?? (t.kind === 'mark' ? t.mark : t.range).getBoundingClientRect()
    const box = this.frame.getBoundingClientRect()
    this.el.hidden = false
    const w = this.el.offsetWidth
    const left = Math.min(Math.max(8, rect.left - box.left - 12), box.width - w - 8)
    const top = rect.top - box.top - this.el.offsetHeight - 8
    this.el.style.left = left + 'px'
    // Below the line if there is no room above (under the title bar).
    this.el.style.top = (top < 44 ? rect.bottom - box.top + 8 : top) + 'px'
    this.onShow(t)
  }

  hide(): void {
    this.el.hidden = true
    this.target = null
  }
}

/** A quiet message near the bottom of the window that fades on its own. */
export function notice(win: HTMLElement, text: string): void {
  let el = win.querySelector<HTMLElement>('.notice')
  if (!el) {
    el = document.createElement('div')
    el.className = 'notice'
    el.setAttribute('role', 'status')
    win.append(el)
  }
  el.textContent = text
  el.hidden = false
  clearTimeout(Number(el.dataset.t))
  el.dataset.t = String(window.setTimeout(() => { el!.hidden = true }, 4000))
}
