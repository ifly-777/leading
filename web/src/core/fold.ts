// "Folding" text for search: one canonical form for things a reader
// considers the same. Accents are dropped (café = cafe), case is ignored
// unless asked, and typography is undone, so a typed it's, "word", -- or ...
// finds it’s, “word”, – or … as displayed, and the reverse.

const EXPAND: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", 'ʼ': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
  '–': '--', '—': '---', '−': '-', '‐': '-', '‑': '-',
  '…': '...',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '­': '', // soft hyphen is invisible
}

const COMBINING = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g

export interface Folded {
  text: string
  /** map[i] = index in the original string of folded char i; map[text.length] = original length */
  map: Int32Array
}

export function fold(src: string, caseSensitive = false): Folded {
  let out = ''
  const map: number[] = []
  for (let i = 0; i < src.length; ) {
    const cp = src.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    let f = EXPAND[ch]
    if (f === undefined) {
      // Plain ASCII is by far the common case; skip normalisation for it.
      f = cp < 128 ? ch : ch.normalize('NFKD').replace(COMBINING, '')
      if (!caseSensitive) f = f.toLowerCase()
    }
    for (let k = 0; k < f.length; k++) map.push(i)
    out += f
    i += ch.length
  }
  map.push(src.length)
  return { text: out, map: Int32Array.from(map) }
}

/** Fold a query the same way, dropping the map. */
export function foldQuery(q: string, caseSensitive = false): string {
  return fold(q, caseSensitive).text
}

const WORD = /[\p{L}\p{N}_]/u

/** All matches of `query` in `hay`, as [start, end) in the ORIGINAL text. */
export function findAll(hay: Folded, original: string, query: string, opts: { caseSensitive?: boolean; wholeWord?: boolean } = {}): [number, number][] {
  const q = foldQuery(query, opts.caseSensitive)
  const out: [number, number][] = []
  if (!q) return out
  const t = hay.text
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) {
    const s = hay.map[i]
    // One original char may fold to several ("–" → "--"). A match ending part-way
    // through one still covers the whole character.
    let j = i + q.length
    while (j < t.length && hay.map[j] === hay.map[j - 1]) j++
    const e = hay.map[j]
    if (opts.wholeWord && ((s > 0 && WORD.test(original[s - 1])) || WORD.test(original[e] ?? ''))) continue
    out.push([s, e])
    // Do not count overlapping hits twice inside one original character.
    while (i + 1 < t.length && hay.map[i + 1] === hay.map[i]) i++
  }
  return out
}
