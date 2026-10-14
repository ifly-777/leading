// The search index: the displayed text of every block, folded for
// case-, accent- and typography-insensitive matching. Built by the parsing
// workers as a document opens, so Find covers the whole file even before
// every block has been painted.
//
// A match is reported as (block, ordinal): "the k-th hit inside block b".
// The page locates it by searching that one block's text, which keeps the
// two sides in step even if their whitespace differs slightly.

import { fold, findAll, type Folded } from './fold'

/** Elements that start a new line of text. A break between them stops matches running across cells or paragraphs. */
export const TEXT_BREAK_TAGS = new Set([
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'pre', 'dt', 'dd', 'summary',
  'tr', 'blockquote', 'div', 'figcaption', 'details', 'section', 'ul', 'ol', 'table', 'dl',
])

/**
 * Formulas and diagrams are left out of Find: their source is not what the
 * page shows, and what KaTeX and Mermaid draw is not text a reader searches.
 * Embedded notes too: their text belongs to another file, and arrives later.
 */
export const UNSEARCHED_CLASSES = ['math', 'diagram', 'note-embed']
/** For a hast className (array or string) or a DOM classList. */
export function isUnsearched(className: unknown): boolean {
  if (!className) return false
  const has: (c: string) => boolean = typeof (className as DOMTokenList).contains === 'function'
    ? (c) => (className as DOMTokenList).contains(c)
    : (c) => (typeof className === 'string' ? className.split(' ') : (className as string[])).includes(c)
  return UNSEARCHED_CLASSES.some(has)
}

/**
 * Concatenated text of a tree, with "\n" wherever the nearest text-breaking
 * ancestor changes. Works on hast (in workers) and, via `kids`/`tag`/`value`
 * accessors, on the DOM, so both sides follow exactly the same rule.
 */
export function blockText<N>(root: N, kids: (n: N) => ArrayLike<N> | null, tag: (n: N) => string | null, value: (n: N) => string | null,
                              onText?: (n: N, start: number) => void): string {
  let out = ''
  let lastBreak: N | null = null
  const walk = (n: N, brk: N | null) => {
    const v = value(n)
    if (v !== null) {
      if (brk !== lastBreak && out) out += '\n'
      lastBreak = brk
      onText?.(n, out.length)
      out += v
      return
    }
    const t = tag(n)
    const next = t && TEXT_BREAK_TAGS.has(t) ? n : brk
    const ks = kids(n)
    if (ks) for (let i = 0; i < ks.length; i++) walk(ks[i], next)
  }
  walk(root, null)
  return out
}

export interface IndexPiece {
  /** Text of each block, in order */
  texts: string[]
  /** fold(texts.join('\n')), computed in the worker */
  folded?: { text: string; map: Int32Array }
}

export interface Match { b: number; k: number }
export interface SearchOptions { caseSensitive?: boolean; wholeWord?: boolean }

export class SearchIndex {
  private pieces: IndexPiece[] = []
  private joined: { text: string; folded: Folded; starts: Int32Array } | null = null
  private foldedCase: Folded | null = null
  blocks = 0

  add(piece: IndexPiece): void {
    this.pieces.push(piece)
    this.blocks += piece.texts.length
    this.joined = null
    this.foldedCase = null
  }

  /** Assemble now (call when idle) so the first keystroke does not pay for it. */
  prepare(): void {
    this.build()
    // Run one throwaway search so the engine has compiled the matching code
    // before the reader's first real keystroke (it otherwise only ran in workers).
    this.find('e')
  }

  /** Concatenate the pieces (cheap: the folding was done in the workers). */
  private build() {
    if (this.joined) return this.joined
    const texts: string[] = []
    const starts = new Int32Array(this.blocks + 1)
    let off = 0
    let b = 0
    for (const p of this.pieces) for (const t of p.texts) { starts[b++] = off; texts.push(t); off += t.length + 1 }
    starts[b] = off
    const text = texts.join('\n')
    // Join the per-piece folds, shifting each piece's map by its offset.
    const parts: string[] = []
    let flen = 0
    for (const p of this.pieces) { p.folded ??= fold(p.texts.join('\n')); flen += p.folded.text.length + 1 }
    const map = new Int32Array(Math.max(1, flen))
    let fo = 0
    let base = 0
    this.pieces.forEach((p, i) => {
      const f = p.folded!
      parts.push(f.text)
      for (let k = 0; k < f.text.length; k++) map[fo + k] = f.map[k] + base
      fo += f.text.length
      const pieceLen = p.texts.reduce((n, t) => n + t.length, 0) + Math.max(0, p.texts.length - 1)
      base += pieceLen
      if (i < this.pieces.length - 1) { map[fo++] = base; base += 1 } // the '\n' between pieces
    })
    map[fo] = base
    this.joined = { text, folded: { text: parts.join('\n'), map }, starts }
    return this.joined
  }

  /** All matches, in document order. */
  find(query: string, opts: SearchOptions = {}): Match[] {
    if (!query || !this.blocks) return []
    const j = this.build()
    const hay = opts.caseSensitive ? (this.foldedCase ??= fold(j.text, true)) : j.folded
    const out: Match[] = []
    let b = 0
    for (const [s] of findAll(hay, j.text, query, opts)) {
      // Matches come in order, so the block pointer only moves forward.
      while (b + 1 < this.blocks && j.starts[b + 1] <= s) b++
      const prev = out[out.length - 1]
      out.push({ b, k: prev && prev.b === b ? prev.k + 1 : 0 })
    }
    return out
  }
}
