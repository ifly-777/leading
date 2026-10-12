// Splitting a long document so several workers can parse it in parallel.
//
// remark parses about 1–2 MB a second, so a 5 MB file would take several
// seconds on one core. Cutting the file just before a top-level heading is
// safe: a non-indented "#" line after a blank line always ends every list,
// quote and paragraph, so each piece parses exactly as it would in place.

import { containerDepth } from './pipeline'

export interface Chunk { start: number; end: number }

const HEADING = /^#{1,6}(?:[ \t]|$)/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const DEFINITION = /^ {0,3}\[(?!\^)[^\]\n]+\]:.*$/gm

/** Offsets where the document may be cut, in order. */
function cutPoints(src: string): number[] {
  const cuts: number[] = []
  let i = 0
  let fence: string | null = null
  let prevBlank = true
  let html = 0 // open HTML containers (<details>…), which must not be cut apart
  if (src.startsWith('---\n') || src.startsWith('---\r\n')) {
    const end = src.indexOf('\n---', 3)
    if (end > 0) i = src.indexOf('\n', end + 4) + 1 || src.length
  }
  while (i < src.length) {
    const nl = src.indexOf('\n', i)
    const stop = nl < 0 ? src.length : nl
    const line = src.slice(i, stop)
    const f = FENCE.exec(line)
    if (f) {
      if (!fence) fence = f[1]
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null
    } else if (!fence && /^ {0,3}</.test(line)) {
      html = Math.max(0, html + containerDepth(line))
    } else if (!fence && !html && prevBlank && HEADING.test(line)) {
      cuts.push(i)
    }
    prevBlank = line.trim() === ''
    i = stop + 1
  }
  return cuts
}

/**
 * Pieces of at least `minBytes`, cut only at safe points. Returns a single
 * chunk when the document is short, has no headings, or uses footnotes
 * (their numbering runs across the whole document).
 */
export function splitForParallel(src: string, pieces: number, minBytes = 150_000): Chunk[] {
  const whole = [{ start: 0, end: src.length }]
  if (pieces < 2 || src.length < 2 * minBytes || /\[\^[^\]\n]+\]/.test(src)) return whole
  const target = Math.max(minBytes, Math.ceil(src.length / pieces))
  const chunks: Chunk[] = []
  let start = 0
  for (const c of cutPoints(src)) {
    if (c - start >= target && src.length - c >= minBytes / 2) {
      chunks.push({ start, end: c })
      start = c
    }
  }
  chunks.push({ start, end: src.length })
  return chunks
}

/**
 * Reference-link definitions ("[id]: url") can sit anywhere, so every piece
 * gets a copy of them appended. They render nothing themselves.
 */
export function referenceDefinitions(src: string): string {
  const defs = src.match(DEFINITION)
  return defs ? '\n\n' + defs.join('\n') + '\n' : ''
}
