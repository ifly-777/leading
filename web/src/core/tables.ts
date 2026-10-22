// Classifies table columns so CSS can lay them out sensibly:
// numbers right-aligned on tabular figures, short columns never wrapping,
// long-text columns given a minimum width so they wrap instead of squeezing.

import type { Root, Table, Parent } from 'mdast'
import { textOf } from './text'

// Plain or formatted numbers: 1,234.5  −12%  (3.4)  $1.2  1e-3  ₹ 4,500
const NUMERIC = /^[(+\-−]?\s?[$€£¥₹]?\s?(?:\d{1,3}(?:[,   ]\d{3})+|\d+)?(?:\.\d+)?(?:e[+\-]?\d+)?\s?%?\)?$/i
const EMPTYISH = /^(?:|-|—|–|n\/a|na|nil|none|\?)$/i

export const SHORT_MAX = 24 // chars: columns whose longest cell fits this never wrap
export const LONG_AVG = 36 // chars: columns averaging more get a wrap-friendly minimum width

export interface ColumnInfo { numeric: boolean; short: boolean; long: boolean }

export function classifyColumns(rows: string[][]): ColumnInfo[] {
  const cols = Math.max(0, ...rows.map((r) => r.length))
  const out: ColumnInfo[] = []
  for (let c = 0; c < cols; c++) {
    const body = rows.slice(1).map((r) => (r[c] ?? '').trim())
    const filled = body.filter((v) => !EMPTYISH.test(v))
    const numeric = filled.length > 0 && filled.filter((v) => /\d/.test(v) && NUMERIC.test(v)).length / filled.length >= 0.8
    const all = rows.map((r) => (r[c] ?? '').trim())
    const max = Math.max(0, ...all.map((v) => v.length))
    const avg = filled.length ? filled.reduce((n, v) => n + v.length, 0) / filled.length : 0
    out.push({ numeric, short: max <= SHORT_MAX, long: avg > LONG_AVG })
  }
  return out
}

/** Writes column classes onto each cell as hast properties. */
export function classifyTables(root: Root): void {
  const walk = (node: Parent) => {
    for (const c of node.children) {
      if (c.type === 'table') annotate(c)
      else if ('children' in c) walk(c as Parent)
    }
  }
  walk(root)
}

function annotate(table: Table): void {
  const rows = table.children.map((r) => r.children.map((cell) => textOf(cell)))
  const info = classifyColumns(rows)
  table.children.forEach((row) => row.children.forEach((cell, c) => {
    const i = info[c]
    if (!i) return
    const cls: string[] = []
    // Explicit GFM alignment (:--- / :---: / ---:) always wins over detection.
    if (i.numeric && !table.align?.[c]) cls.push('num')
    else if (i.numeric) cls.push('num-figures')
    if (i.short) cls.push('short')
    else if (!i.numeric) cls.push(i.long ? 'long' : 'wrap') // wrapping text columns get a minimum width
    if (cls.length) cell.data = { ...cell.data, hProperties: { ...(cell.data as any)?.hProperties, className: cls } }
  }))
  // An empty first row is the usual way to write a table without a header in
  // Markdown (GFM requires one); show no header at all rather than an empty one.
  const headless = rows[0]?.every((c) => !c.trim())
  table.data = { ...table.data, hProperties: { ...(table.data as any)?.hProperties, className: ['cols-' + info.length, ...(headless ? ['headless'] : [])] } } as any
}
