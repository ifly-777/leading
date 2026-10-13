// Aligning GFM table source so the pipes line up, and finding cells for
// Tab / Shift-Tab. Pure string functions; the editor applies the result.

/**
 * Columns a string occupies in a monospaced grid: East Asian wide and
 * full-width characters and most emoji take two, combining marks none.
 * (Leading's editor uses a proportional face, so this is approximate there,
 * but it keeps the source tidy in any plain-text editor.)
 */
export function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (/\p{M}/u.test(ch) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) continue
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
    w += wide ? 2 : 1
  }
  return w
}

/** Split a table row into cells. Pipes inside `code` or escaped as \| belong to the cell. */
export function splitRow(line: string): { indent: string; cells: string[] } {
  const indent = /^\s*/.exec(line)![0]
  let body = line.slice(indent.length).trimEnd()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  let code = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\' && body[i + 1] === '|') { cur += '\\|'; i++; continue }
    if (c === '`') {
      let n = 1
      while (body[i + n] === '`') n++
      code = code === n ? 0 : code || n
      cur += '`'.repeat(n); i += n - 1; continue
    }
    if (c === '|' && !code) { cells.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  cells.push(cur.trim())
  return { indent, cells }
}

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

export function isDelimiterRow(line: string): boolean { return DELIMITER.test(line) && line.includes('-') }

type Align = 'left' | 'right' | 'center' | 'none'

/** Rewrite the lines of one table (header, delimiter, body rows) with aligned pipes. */
export function alignTable(lines: string[]): string[] {
  const rows = lines.map((l) => splitRow(l))
  const delimAt = lines.findIndex(isDelimiterRow)
  const cols = Math.max(...rows.map((r) => r.cells.length))
  const aligns: Align[] = Array.from({ length: cols }, (_, c) => {
    if (delimAt < 0) return 'none'
    const d = rows[delimAt].cells[c] ?? '-'
    const l = d.startsWith(':'), r = d.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : 'none'
  })
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(3, ...rows.map((r, i) => (i === delimAt ? 0 : displayWidth(r.cells[c] ?? '')))))
  const indent = rows[0]?.indent ?? ''
  return rows.map((r, i) => {
    const cells = Array.from({ length: cols }, (_, c) => {
      const w = widths[c]
      if (i === delimAt) {
        const a = aligns[c]
        const inner = '-'.repeat(w - (a === 'center' ? 2 : a === 'none' ? 0 : 1))
        return a === 'center' ? `:${inner}:` : a === 'left' ? `:${inner}` : a === 'right' ? `${inner}:` : inner
      }
      const text = r.cells[c] ?? ''
      const pad = w - displayWidth(text)
      if (aligns[c] === 'right') return ' '.repeat(pad) + text
      if (aligns[c] === 'center') return ' '.repeat(Math.floor(pad / 2)) + text + ' '.repeat(Math.ceil(pad / 2))
      return text + ' '.repeat(pad)
    })
    return `${indent}| ${cells.join(' | ')} |`
  })
}

/** Index of the cell containing column `ch` of an aligned or unaligned row. */
export function cellIndexAt(line: string, ch: number): number {
  let n = -1
  let code = 0
  const start = line.trimStart().startsWith('|') ? line.indexOf('|') : -1
  if (start < 0) n = 0
  for (let i = 0; i < Math.min(ch, line.length); i++) {
    const c = line[i]
    if (c === '\\' && line[i + 1] === '|') { i++; continue }
    if (c === '`') code = code ? 0 : 1
    if (c === '|' && !code) n++
  }
  return Math.max(0, n)
}

/** Character offset (within the line) where cell `index`'s text starts in an aligned row. */
export function cellStart(line: string, index: number): number {
  let n = -1
  let code = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && line[i + 1] === '|') { i++; continue }
    if (c === '`') code = code ? 0 : 1
    if (c === '|' && !code && ++n === index) {
      let j = i + 1
      while (line[j] === ' ') j++
      return j
    }
  }
  return line.length
}
