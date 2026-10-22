// Read Aloud: the page from where the reader is (or from the selection) is
// handed to the app as passages, one per paragraph, heading or list item; the
// app speaks them in the reader's Spoken Content voice and reports each word
// as it goes. The word is marked with the CSS Custom Highlight API, which
// draws over the text without adding an element, so nothing on the page moves
// (docs/decisions.md, "A highlight must not move text"). The page follows
// the voice, keeping the word in view.
//
// Code, formulas, diagrams, embedded notes, properties and footnote numbers
// are not read: spoken, they are noise.

const UNIT = 'p, h1, h2, h3, h4, h5, h6, li, dt, dd, th, td, figcaption, summary'
const SKIP = 'pre, .math, figure.diagram, .note-embed, .props, sup, input, .footnotes, .page-break, script, style'

interface Passage { el: Element; text: string; nodes: Text[]; at: number[] }

/** The text a unit speaks: its own text nodes, not those of units inside it or of things never read. */
function passageOf(el: Element): Passage {
  const nodes: Text[] = []
  const at: number[] = []
  let text = ''
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        nodes.push(c as Text)
        at.push(text.length)
        text += (c as Text).data
      } else if (c.nodeType === 1) {
        const e = c as Element
        if (e.matches(SKIP) || e.matches(UNIT)) continue
        walk(e)
      }
    }
  }
  walk(el)
  return { el, text, nodes, at }
}

export class ReadAloud {
  private passages: Passage[] = []
  private highlight: unknown = null
  speaking = false
  /** Send the passages to the app (the host posts them). */
  onSpeak: (passages: string[], lang: string) => void = () => {}
  onStop: () => void = () => {}

  constructor(private doc: HTMLElement, private scroller: HTMLElement) {}

  /** Start at the selection, or else at the first unit at or below `from` (the block at the top of the window). */
  start(from: Element | null): boolean {
    this.stop()
    const sel = window.getSelection()
    const anchor = sel && !sel.isCollapsed && this.doc.contains(sel.anchorNode) ? sel.getRangeAt(0).startContainer : null
    const units = Array.from(this.doc.querySelectorAll(UNIT)).filter((u) => !u.closest(SKIP))
    let i = 0
    if (anchor) {
      // The unit holding the selection's start, or the first after it.
      i = units.findIndex((u) => u.contains(anchor) || !!(anchor.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING))
    } else if (from) {
      i = units.findIndex((u) => from.contains(u) || !!(from.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING))
    }
    if (i < 0) i = 0
    // A long file's worth is queued at once; a few thousand passages is hours of speech.
    this.passages = units.slice(i, i + 3000).map(passageOf).filter((p) => p.text.trim())
    if (!this.passages.length) return false
    this.speaking = true
    this.onSpeak(this.passages.map((p) => p.text.replace(/\s+/g, ' ')), this.doc.lang || 'en')
    return true
  }

  /** The app is speaking word [loc, loc+len) of passage `seg`. */
  word(seg: number, loc: number, len: number): void {
    const p = this.passages[seg]
    if (!p || !p.el.isConnected) return
    // Spoken text had its runs of white space folded to one: map back through the original.
    const range = rangeIn(p, ...unfold(p.text, loc, len))
    if (!range) return
    const reg = (globalThis as any).CSS?.highlights
    if (reg && typeof (globalThis as any).Highlight === 'function') {
      const h = new (globalThis as any).Highlight(range)
      this.highlight = h
      reg.set('read-aloud', h)
    }
    // Keep the word in view: once it nears the bottom, bring it up to a third of the way down.
    const r = range.getBoundingClientRect()
    const box = this.scroller.getBoundingClientRect()
    if (r.height && (r.bottom > box.bottom - box.height * 0.2 || r.top < box.top + 40)) {
      this.scroller.scrollTop += r.top - box.top - box.height * 0.3
    }
  }

  /** Reading ended (the app says so) or was stopped here. */
  ended(): void {
    this.speaking = false
    this.passages = []
    ;(globalThis as any).CSS?.highlights?.delete('read-aloud')
    this.highlight = null
  }

  stop(): void {
    if (!this.speaking) return
    this.onStop()
    this.ended()
  }
}

/** [loc, len] in the folded string (white space runs as one space) → the same span in the original. */
function unfold(text: string, loc: number, len: number): [number, number] {
  let o = 0 // index in the original
  let f = 0 // index in the folded
  let start = -1
  // Leading white space folds to one space too, so both strings start together.
  while (o < text.length) {
    if (f === loc && start < 0) start = o
    if (f === loc + len) return [start, o]
    if (/\s/.test(text[o])) { while (o + 1 < text.length && /\s/.test(text[o + 1])) o++ }
    o++
    f++
  }
  return [start < 0 ? o : start, o]
}

function rangeIn(p: Passage, s: number, e: number): Range | null {
  if (s < 0 || e <= s) return null
  const find = (i: number, end: boolean): [Text, number] | null => {
    for (let k = p.nodes.length - 1; k >= 0; k--) {
      if (end ? p.at[k] < i : p.at[k] <= i) return [p.nodes[k], Math.min(i - p.at[k], p.nodes[k].data.length)]
    }
    return null
  }
  const a = find(s, false), z = find(e, true)
  if (!a || !z) return null
  const r = document.createRange()
  r.setStart(...a)
  r.setEnd(...z)
  return r
}
