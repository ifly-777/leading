// Line-level formatting: turning lines into a list and back, and starting a
// table. Pure functions over the text and a selection, like format.ts; the
// editor turns the result into one undoable transaction.

import { alignTable } from './table-align'
import type { Edit, FormatResult } from './format'

export type ListKind = 'bullet' | 'number'

// Indent, then a bullet (-, *, +) or a number (1. or 1)), then its spaces.
// A task box after the marker stays with the text, so it survives a toggle.
const MARKER = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+|$)/
// "- - -" and "* * *" are rules, not lists.
const RULE = /^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/

/** The lines a selection touches. A selection ending at the very start of a line leaves that line out. */
function lineSpan(doc: string, from: number, to: number): { start: number; end: number } {
  const start = doc.lastIndexOf('\n', from - 1) + 1
  const last = to > from && doc[to - 1] === '\n' ? to - 1 : to
  const nl = doc.indexOf('\n', last)
  return { start, end: nl < 0 ? doc.length : nl }
}

/**
 * Make the selected lines a bulleted or numbered list, or, if they all are one
 * already, plain lines again. Blank lines are left alone; a list of the other
 * kind is switched over; nested lines keep their indent and number on their own.
 */
export function toggleList(doc: string, from: number, to: number, kind: ListKind): FormatResult {
  const { start, end } = lineSpan(doc, from, to)
  const lines = doc.slice(start, end).split('\n')
  const parsed = lines.map((text) => {
    const m = RULE.test(text) ? null : MARKER.exec(text)
    return {
      text,
      indent: m ? m[1] : /^[ \t]*/.exec(text)![0],
      marker: m ? m[0].length - m[1].length : 0, // marker and its spaces, after the indent
      kind: m ? (m[2] ? 'bullet' : 'number') : null,
      blank: !text.trim(),
    }
  })
  // A lone blank line (a cursor on an empty line) still becomes a list item.
  const targets = parsed.filter((p) => !p.blank).length ? parsed.filter((p) => !p.blank) : parsed
  const remove = targets.every((p) => p.kind === kind)

  const counters = new Map<string, number>() // next number at each indent
  const changes: Edit[] = []
  let lineFrom = start
  let cursor = from // where a bare cursor lands
  for (const p of parsed) {
    if (targets.includes(p)) {
      // A shallower line restarts the numbering of everything nested deeper.
      for (const k of [...counters.keys()]) if (k.length > p.indent.length) counters.delete(k)
      let insert = ''
      if (!remove) {
        const n = counters.get(p.indent) ?? 1
        counters.set(p.indent, n + 1)
        insert = kind === 'bullet' ? '- ' : `${n}. `
      }
      const at = lineFrom + p.indent.length
      if (p.text.slice(p.indent.length, p.indent.length + p.marker) !== insert) {
        changes.push({ from: at, to: at + p.marker, insert })
      }
      if (from === to) {
        // Keep the cursor on the same character, or just after the new marker if it was inside the old one.
        const textStart = at + p.marker
        cursor = from < textStart ? at + insert.length : from + insert.length - p.marker
      }
    }
    lineFrom += p.text.length + 1
  }

  if (from === to) return { changes, anchor: cursor, head: cursor }
  const delta = changes.reduce((d, c) => d + c.insert.length - (c.to - c.from), 0)
  // Select the whole of the changed lines, so the next toggle covers the same ones.
  return { changes, anchor: start, head: end + delta }
}

/**
 * Start a table at the cursor. With lines selected, those lines become the
 * table: the first is the header, and tabs (as copied from a spreadsheet)
 * split cells. The first cell's text is selected, so typing replaces it and
 * Tab moves on. A blank line is kept on either side, as Markdown needs.
 */
export function insertTable(doc: string, from: number, to: number): FormatResult {
  let rows: string[][]
  let start: number, end: number
  if (from === to) {
    rows = [['Column 1', 'Column 2'], ['', '']]
    // On a line with text, the table goes after that line.
    const { start: ls, end: le } = lineSpan(doc, from, to)
    const blank = !doc.slice(ls, le).trim()
    start = blank ? ls : le
    end = le
  } else {
    ;({ start, end } = lineSpan(doc, from, to))
    rows = doc.slice(start, end).split('\n').filter((l) => l.trim()).map((l) => l.split('\t').map((c) => c.trim().replace(/\|/g, '\\|')))
    if (rows.length === 1) rows.push(rows[0].map(() => ''))
  }
  const cols = Math.max(...rows.map((r) => r.length))
  const row = (cells: string[]) => '| ' + Array.from({ length: cols }, (_, i) => cells[i] ?? '').join(' | ') + ' |'
  const table = alignTable([row(rows[0]), row(Array(cols).fill('---')), ...rows.slice(1).map(row)]).join('\n')

  // A blank line before and after, unless the document edge or one is already there.
  const before = doc.slice(0, start)
  const after = doc.slice(end)
  const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trail = !after ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const insert = lead + table + trail
  const cell = start + lead.length + 2 // after "| "
  return { changes: [{ from: start, to: end, insert }], anchor: cell, head: cell + rows[0][0].length }
}
