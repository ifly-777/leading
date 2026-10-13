// Headings straight from the Markdown source, for the outline while editing:
// a line scan (ATX "# " headings and setext underlines), skipping front matter
// and fenced code. Cheap enough to rerun a moment after each change, even at 5 MB.

import type { OutlineItem } from './pipeline'

export function scanHeadings(src: string): OutlineItem[] {
  const out: OutlineItem[] = []
  let i = 0
  let fence: string | null = null
  if (src.startsWith('---\n') || src.startsWith('---\r\n')) {
    const end = src.indexOf('\n---', 3)
    if (end > 0) i = src.indexOf('\n', end + 4) + 1 || src.length
  }
  let prev: { text: string; start: number } | null = null
  while (i < src.length) {
    const nl = src.indexOf('\n', i)
    const stop = nl < 0 ? src.length : nl
    const line = src.slice(i, stop)
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1]
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null
      prev = null
    } else if (!fence) {
      const atx = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(line)
      const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line)
      if (atx) out.push({ depth: atx[1].length, text: clean(atx[2]), id: '', s: i, b: -1 })
      else if (setext && prev && prev.text.trim() && !/^\s*[-*+>]/.test(prev.text)) {
        out.push({ depth: setext[1][0] === '=' ? 1 : 2, text: clean(prev.text), id: '', s: prev.start, b: -1 })
      }
      prev = line.trim() ? { text: line, start: i } : null
    }
    i = stop + 1
  }
  return out
}

/** Heading text without the most common inline markup, for display in the outline. */
function clean(t: string): string {
  return t.replace(/[*_~`]+/g, '').replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/==/g, '').trim()
}
