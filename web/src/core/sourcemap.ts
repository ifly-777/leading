// Maps rendered text back to exact positions in the Markdown source.
//
// Rendered text is almost a subsequence of its source: the differences are
// syntax the parser consumed (escapes, entities, line prefixes such as "> ")
// and substitutions we made ourselves (smart punctuation). Walking both
// strings with knowledge of those differences gives an exact map without
// storing anything at render time. All offsets are UTF-16 code units, the
// same unit Swift's NSString and CodeMirror use.

import { decodeNamedCharacterReference } from 'decode-named-character-reference'

export interface OffsetMap {
  /** from[i] = source offset where rendered char i begins */
  from: Int32Array
  /** to[i] = source offset just after rendered char i */
  to: Int32Array
}

// Rendered characters that smart punctuation produces, and the source text
// each may have come from. Longest source first so "---" wins over "--".
const SUBSTITUTIONS: Record<string, string[]> = {
  '‘': ["'"], '’': ["'"],
  '“': ['"'], '”': ['"'],
  '—': ['---'], '–': ['--'],
  '…': ['...'],
}

const ASCII_PUNCT = /[!-\/:-@\[-`{-~]/

/** Length of a character reference (&amp; &#38; &#x26;) at src[j], and its decoded value. */
function entityAt(src: string, j: number, end: number): { len: number; value: string } | null {
  if (src.charCodeAt(j) !== 38 /* & */) return null
  const semi = src.indexOf(';', j)
  if (semi < 0 || semi >= end || semi - j > 32) return null
  const body = src.slice(j + 1, semi)
  let value: string | false = false
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) value = String.fromCodePoint(code)
  } else {
    value = decodeNamedCharacterReference(body)
  }
  return value === false ? null : { len: semi - j + 1, value }
}

/**
 * Align `rendered` against src[start, end). Unmatched source characters are
 * skipped; that is how Markdown syntax (**, [, ](url), "> ") drops out.
 */
export function align(rendered: string, src: string, start: number, end: number): OffsetMap {
  const n = rendered.length
  const from = new Int32Array(n)
  const to = new Int32Array(n)
  let i = 0
  let j = start
  while (i < n) {
    if (j >= end) {
      // Source exhausted (should not happen for well-formed input): pin to the end.
      from[i] = end; to[i] = end; i++; continue
    }
    const r = rendered[i]
    const s = src[j]
    // Backslash escape: "\*" renders as "*". The escaped char maps to itself,
    // but the span starts at the backslash so highlights never split the pair.
    if (s === '\\' && j + 1 < end && ASCII_PUNCT.test(src[j + 1]) && src[j + 1] === r) {
      from[i] = j; to[i] = j + 2; i++; j += 2; continue
    }
    // Entities first: "&amp;" must map as one unit, not as a literal "&" plus syntax.
    const ent = s === '&' ? entityAt(src, j, end) : null
    if (ent && rendered.startsWith(ent.value, i)) {
      // One entity can decode to two UTF-16 units (astral chars); both map to it.
      for (let k = 0; k < ent.value.length; k++) { from[i + k] = j; to[i + k] = j + ent.len }
      i += ent.value.length; j += ent.len; continue
    }
    if (r === s) { from[i] = j; to[i] = j + 1; i++; j++; continue }
    const subs = SUBSTITUTIONS[r]
    if (subs) {
      const hit = subs.find((t) => src.startsWith(t, j))
      if (hit) { from[i] = j; to[i] = j + hit.length; i++; j += hit.length; continue }
    }
    j++ // syntax the parser consumed
  }
  return { from, to }
}

/** Source range [s, e) covering rendered chars [a, b). */
export function sourceRange(map: OffsetMap, a: number, b: number): [number, number] {
  if (b <= a) {
    const at = a < map.from.length ? map.from[a] : (map.to.length ? map.to[map.to.length - 1] : 0)
    return [at, at]
  }
  return [map.from[a], map.to[b - 1]]
}
