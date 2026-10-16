// Where a new highlight's edges go. WebKit shapes the text on each side of an
// inline element apart, so an edge inside a word loses the kerning and
// ligatures across it ("of|fice"), and now and then moves a line break. An
// edge at a space moves nothing (docs/decisions.md). So a selection that
// starts or ends inside a word is widened to the whole word, and to any
// punctuation clinging to it, before it becomes a highlight.
//
// Words are found with Intl.Segmenter in the note's language, not a pattern,
// so accented letters, apostrophes inside words ("don’t") and scripts written
// without spaces (Chinese, Japanese, Thai) are cut where that language cuts
// them.

/** Stands for something taken whole (a formula, a picture): an edge never moves across it. */
export const OBJECT = '￼'

const SPACE = /\s/

const segmenters = new Map<string, Intl.Segmenter>()
function segmenter(lang: string): Intl.Segmenter {
  let s = segmenters.get(lang)
  if (!s) {
    try { s = new Intl.Segmenter(lang, { granularity: 'word' }) } catch { s = new Intl.Segmenter('en', { granularity: 'word' }) }
    segmenters.set(lang, s)
  }
  return s
}

/**
 * The selection [start, end) of `text` with each edge moved out to a word's
 * edge if it falls inside one, then past punctuation that clings to that word
 * ("office," or "“So") when the punctuation reaches a space or the end of the
 * text. Edges only ever move outward; a selection whose edges already sit at
 * spaces comes back as it was.
 */
export function snapToWords(text: string, start: number, end: number, lang = 'en'): [number, number] {
  if (end <= start) return [start, end]
  // Which characters belong to a word, and where each word starts and ends.
  const wordStart = new Int32Array(text.length).fill(-1)
  const wordEnd = new Int32Array(text.length).fill(-1)
  for (const seg of segmenter(lang).segment(text)) {
    if (!seg.isWordLike) continue
    const z = seg.index + seg.segment.length
    for (let i = seg.index; i < z; i++) { wordStart[i] = seg.index; wordEnd[i] = z }
  }
  const inWord = (i: number) => i >= 0 && i < text.length && wordStart[i] >= 0
  // Punctuation and symbols: neither space, nor word, nor something taken whole.
  const clings = (i: number) => !inWord(i) && !SPACE.test(text[i]) && text[i] !== OBJECT

  let s = start, e = end
  // Inside a word: the character before the edge and the one after it share a word.
  if (inWord(s) && wordStart[s] < s) s = wordStart[s]
  if (inWord(e - 1) && wordEnd[e - 1] > e) e = wordEnd[e - 1]

  // A cut between a letter and the punctuation beside it loses kerning too
  // ("y|," and "“|A" both move), so take the punctuation in, but only as far
  // as a space. "office—that" keeps its edge at the word: the dash leads to
  // another word, not a space.
  if (inWord(s) && s > 0 && clings(s - 1)) {
    let k = s
    while (k > 0 && clings(k - 1)) k--
    if (k === 0 || SPACE.test(text[k - 1])) s = k
  }
  if (inWord(e - 1) && e < text.length && clings(e)) {
    let k = e
    while (k < text.length && clings(k)) k++
    if (k === text.length || SPACE.test(text[k])) e = k
  }
  return [s, e]
}
