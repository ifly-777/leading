// Inline formatting that toggles: applying a format twice removes it.
// Pure functions over the document text and a selection, so they can be
// tested without an editor; the editor turns the result into a transaction.

export interface Edit { from: number; to: number; insert: string }
export interface FormatResult { changes: Edit[]; anchor: number; head: number }

export type Format = 'bold' | 'italic' | 'underline' | 'strike' | 'code'

const MARKERS: Record<Format, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
}

const WORD = /[\p{L}\p{N}_'’]/u

/** How many times `ch` repeats going left from `at` (exclusive) or right from `at` (inclusive). */
function run(doc: string, at: number, ch: string, dir: -1 | 1): number {
  let n = 0
  for (let i = dir < 0 ? at - 1 : at; i >= 0 && i < doc.length && doc[i] === ch; i += dir) n++
  return n
}

/**
 * Is the format's marker present on both sides at these positions?
 * Asterisks need care: "*" (italic) is present in runs of 1 or 3,
 * "**" (bold) in runs of 2 or 3, so italic never mistakes bold for itself.
 */
function markedAt(doc: string, left: number, right: number, f: Format): boolean {
  const [open, close] = MARKERS[f]
  if (f === 'italic' || f === 'bold') {
    const l = run(doc, left, '*', -1)
    const r = run(doc, right, '*', 1)
    const ok = (n: number) => (f === 'italic' ? n === 1 || n === 3 : n === 2 || n === 3)
    return ok(l) && ok(r)
  }
  return doc.slice(left - open.length, left) === open && doc.slice(right, right + close.length) === close
}

/** Same check for markers just inside the selection's edges. */
function markedInside(doc: string, from: number, to: number, f: Format): boolean {
  const [open, close] = MARKERS[f]
  if (to - from < open.length + close.length) return false
  return markedAt(doc, from + open.length, to - close.length, f) &&
    doc.slice(from, from + open.length) === open && doc.slice(to - close.length, to) === close
}

export function toggleFormat(doc: string, from: number, to: number, f: Format): FormatResult {
  const [open, close] = MARKERS[f]

  // Several lines: format each non-empty line on its own; inline markers cannot span paragraphs.
  if (doc.slice(from, to).includes('\n')) {
    const changes: Edit[] = []
    let lineStart = from
    const lines = doc.slice(from, to).split('\n')
    const allMarked = lines.every((l, i) => {
      const s = i === 0 ? from : lineStart
      lineStart = s + l.length + 1
      const t = l.trim()
      if (!t) return true
      const a = s + l.indexOf(t)
      return markedInside(doc, a, a + t.length, f) || markedAt(doc, a, a + t.length, f)
    })
    lineStart = from
    lines.forEach((l) => {
      const s = lineStart
      lineStart += l.length + 1
      const t = l.trim()
      if (!t) return
      const a = s + l.indexOf(t)
      const b = a + t.length
      if (allMarked) {
        if (markedInside(doc, a, b, f)) changes.push({ from: a, to: a + open.length, insert: '' }, { from: b - close.length, to: b, insert: '' })
        else changes.push({ from: a - open.length, to: a, insert: '' }, { from: b, to: b + close.length, insert: '' })
      } else {
        changes.push({ from: a, to: a, insert: open }, { from: b, to: b, insert: close })
      }
    })
    const delta = changes.reduce((n, c) => n + c.insert.length - (c.to - c.from), 0)
    return { changes, anchor: from, head: to + delta }
  }

  // An empty selection inside a word formats the whole word.
  if (from === to) {
    if (markedAt(doc, from, from, f)) {
      // Cursor between an empty pair of markers: remove them.
      return { changes: [{ from: from - open.length, to: from + close.length, insert: '' }], anchor: from - open.length, head: from - open.length }
    }
    let a = from, b = to
    while (a > 0 && WORD.test(doc[a - 1])) a--
    while (b < doc.length && WORD.test(doc[b])) b++
    if (a === b) {
      // Not in a word: insert an empty pair and type between them.
      return { changes: [{ from, to, insert: open + close }], anchor: from + open.length, head: from + open.length }
    }
    from = a
    to = b
  }

  // Markers hug the text: leave surrounding spaces outside.
  while (from < to && /\s/.test(doc[from])) from++
  while (to > from && /\s/.test(doc[to - 1])) to--
  // A selection of only spaces leaves nothing to format: treat it as a cursor.
  if (from === to) return toggleFormat(doc, from, to, f)

  if (markedInside(doc, from, to, f)) {
    return {
      changes: [{ from, to: from + open.length, insert: '' }, { from: to - close.length, to, insert: '' }],
      anchor: from, head: to - open.length - close.length,
    }
  }
  if (markedAt(doc, from, to, f)) {
    return {
      changes: [{ from: from - open.length, to: from, insert: '' }, { from: to, to: to + close.length, insert: '' }],
      anchor: from - open.length, head: to - open.length,
    }
  }
  return {
    changes: [{ from, to: from, insert: open }, { from: to, to, insert: close }],
    anchor: from + open.length, head: to + open.length,
  }
}

const LINK = /^\[([^\]\n]*)\]\(([^)\n]*)\)$/
const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)\S+$/i

/**
 * ⌘K. Selected text becomes [text](|) with the cursor in the address;
 * a selected address becomes [|](address); a link (selected, or the cursor
 * inside one) is unwrapped back to its text.
 */
export function toggleLink(doc: string, from: number, to: number): FormatResult {
  // Find a link around the cursor or selection on this line.
  const lineStart = doc.lastIndexOf('\n', from - 1) + 1
  const lineEnd = doc.indexOf('\n', to) < 0 ? doc.length : doc.indexOf('\n', to)
  const line = doc.slice(lineStart, lineEnd)
  for (const m of line.matchAll(/\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const a = lineStart + m.index!
    const b = a + m[0].length
    if (from >= a && to <= b) {
      return { changes: [{ from: a, to: b, insert: m[1] }], anchor: a, head: a + m[1].length }
    }
  }
  const sel = doc.slice(from, to)
  const lm = LINK.exec(sel)
  if (lm) return { changes: [{ from, to, insert: lm[1] }], anchor: from, head: from + lm[1].length }
  if (URLISH.test(sel)) {
    return { changes: [{ from, to, insert: `[](${sel})` }], anchor: from + 1, head: from + 1 }
  }
  const text = `[${sel}]()`
  return { changes: [{ from, to, insert: text }], anchor: from + text.length - 1, head: from + text.length - 1 }
}

/** Apply edits (in original-document coordinates) to a string. */
export function applyEdits(doc: string, changes: Edit[]): string {
  const sorted = [...changes].sort((x, y) => y.from - x.from)
  for (const c of sorted) doc = doc.slice(0, c.from) + c.insert + doc.slice(c.to)
  return doc
}
