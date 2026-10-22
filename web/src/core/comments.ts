// Obsidian's comments: %%text%%, within a line or across several. They are
// part of the file but never part of the page.
//
// They are found before parsing and blanked out of the text the parser sees,
// character for character, so every offset still matches the file. A comment
// can span paragraphs, so this cannot wait for the tree: by then the parser
// would have cut it apart. What blanking leaves inside a line (spaces) is cut
// from the tree afterwards (plugins/inline.ts), so "a%%x%%b" reads "ab".
//
// A comment straight after a highlight is that highlight's note:
// ==words==%%note%%. Obsidian hides it, as it hides any comment.

export interface Comment {
  /** Source range, the %% markers included */
  s: number
  e: number
  /** The text between the markers */
  body: string
}

// Fences (``` ~~~ $$) and front matter hold literal text: a %% there is not a comment.
const FENCE = /^ {0,3}(`{3,}|~{3,}|\${2,})/
// Zero-width space: invisible, and not whitespace to the parser (see `blank`).
const ZWSP = '​'

/** Every comment in the file, in order. An opening %% with no closing one is left as text. */
export function findComments(src: string): Comment[] {
  const out: Comment[] = []
  if (!src.includes('%%')) return out
  let i = 0
  // Front matter is YAML, not Markdown.
  if (src.startsWith('---\n') || src.startsWith('---\r\n')) {
    const end = src.indexOf('\n---', 3)
    if (end > 0) i = src.indexOf('\n', end + 4) + 1 || src.length
  }
  let fence: string | null = null
  while (i < src.length) {
    // At the start of a line: fences open and close here.
    if (i === 0 || src[i - 1] === '\n') {
      const nl = src.indexOf('\n', i)
      const stop = nl < 0 ? src.length : nl
      const line = src.slice(i, stop)
      const f = FENCE.exec(line)
      if (fence) {
        // Inside a fence: only its closing line matters.
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null
        i = stop + 1
        continue
      }
      // "$$x$$" on one line is math within a paragraph, not the start of a block.
      if (f && !(f[1][0] === '$' && line.slice(f[0].length).includes('$'))) {
        fence = f[1]
        i = stop + 1
        continue
      }
    }
    const c = src[i]
    if (c === '\\') { i += 2; continue }
    if (c === '`') {
      // An inline code span: skip to its closing run of the same length, within the paragraph.
      let k = i
      while (src[k] === '`') k++
      const run = k - i
      const para = src.slice(k).search(/\n[ \t]*\n/)
      const limit = para < 0 ? src.length : k + para
      let close = src.indexOf('`'.repeat(run), k)
      while (close >= 0 && close < limit && (src[close - 1] === '`' || src[close + run] === '`')) close = src.indexOf('`'.repeat(run), close + 1)
      i = close >= 0 && close < limit ? close + run : k
      continue
    }
    if (c === '%' && src[i + 1] === '%') {
      const end = src.indexOf('%%', i + 2)
      if (end < 0) break // unclosed: the rest is text
      out.push({ s: i, e: end + 2, body: src.slice(i + 2, end) })
      // Scanning goes on after it, perhaps mid-way along a later line.
      i = end + 2
      continue
    }
    i++
  }
  return out
}

/**
 * The text with every comment blanked: each character becomes a space, line
 * breaks stay, so offsets and lines are unchanged. Where a comment opens a
 * line and text follows it on the line where it ends, the blank starts with a
 * zero-width space instead, or four spaces would turn the text into code.
 */
export function hideComments(src: string): { text: string; comments: Comment[] } {
  const comments = findComments(src)
  if (!comments.length) return { text: src, comments }
  let text = ''
  let last = 0
  for (const c of comments) {
    text += src.slice(last, c.s) + blank(src, c)
    last = c.e
  }
  text += src.slice(last)
  return { text, comments }
}

function blank(src: string, c: Comment): string {
  const chars = src.slice(c.s, c.e).replace(/[^\r\n]/g, ' ').split('')
  // The line the comment ends on: does it start blank (once blanked) and go on with text?
  const nl = src.lastIndexOf('\n', c.e - 1)
  const lineStart = nl + 1
  const from = Math.max(lineStart, c.s)
  const before = src.slice(lineStart, from)
  const lineEnd = src.indexOf('\n', c.e)
  const after = src.slice(c.e, lineEnd < 0 ? src.length : lineEnd)
  if (!before.trim() && after.trim()) chars[from - c.s] = ZWSP
  return chars.join('')
}

/** The comment containing source offset `at`, if any (comments sorted, as findComments gives them). */
export function commentAt(comments: Comment[], at: number): Comment | null {
  let lo = 0, hi = comments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = comments[mid]
    if (at < c.s) hi = mid - 1
    else if (at >= c.e) lo = mid + 1
    else return c
  }
  return null
}
