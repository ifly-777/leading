// Smart punctuation, applied to the rendered text only; the file never changes.
// Curly quotes and apostrophes, -- to en dash, --- to em dash, ... to ellipsis.
// Code, HTML, front matter and anything that looks like a URL are left alone.
//
// Every substitution here must have a matching entry in sourcemap.ts, or
// highlight mapping will drift.

import type { Parent, Root, Nodes } from 'mdast'

// URL-ish tokens: scheme://…, www.…, or domain.tld/path.
const URLISH = /(?:[a-z][a-z0-9+.\-]*:\/\/|www\.)[^\s<>]+|[^\s<>()]+\.[a-z]{2,}\/[^\s<>]*/gi

// After these characters a quote opens rather than closes.
const OPENS_AFTER = /[\s(\[{—–\-\/“‘"']/
// Words that start with an elided letter take an apostrophe, not an opening quote.
const ELISION = /^'(?:\d\ds?\b|tis\b|twas\b|em\b|cause\b|n'|n\b)/i

function opensAfter(prev: string): boolean {
  return prev === '' || OPENS_AFTER.test(prev)
}

export function smartenText(value: string, prev: string): string {
  if (!/['"]|--|\.\.\./.test(value)) return value
  // Mark URL ranges so they are copied verbatim.
  const keep: [number, number][] = []
  for (const m of value.matchAll(URLISH)) keep.push([m.index!, m.index! + m[0].length])
  let out = ''
  let p = prev
  let k = 0
  let kp = 0
  while (k < value.length) {
    while (kp < keep.length && keep[kp][1] <= k) kp++
    if (kp < keep.length && keep[kp][0] <= k) {
      out += value.slice(k, keep[kp][1]); k = keep[kp][1]; p = out.slice(-1); continue
    }
    const c = value[k]
    let r = c
    let len = 1
    if (c === '.' && value.startsWith('...', k)) { r = '…'; len = 3 }
    else if (c === '-' && value.startsWith('---', k)) { r = '—'; len = 3 }
    else if (c === '-' && value.startsWith('--', k)) { r = '–'; len = 2 }
    else if (c === '"') r = opensAfter(p) ? '“' : '”'
    else if (c === "'") {
      if (!opensAfter(p)) r = '’'
      else r = ELISION.test(value.slice(k, k + 6)) ? '’' : '‘'
    }
    out += r; p = r; k += len
  }
  return out
}

const BLOCK_RESET = new Set(['paragraph', 'heading', 'tableCell', 'listItem', 'blockquote', 'callout', 'root'])

function linkShowsUrl(node: any): boolean {
  const text = (node.children ?? []).map((c: any) => c.value ?? '').join('')
  return /:\/\/|^www\.|^mailto:/i.test(text) || text === node.url
}

export function smarten(root: Root): void {
  let prev = ''
  const visit = (node: Nodes | any) => {
    switch (node.type) {
      case 'text': node.value = smartenText(node.value, prev); prev = node.value.slice(-1) || prev; return
      case 'inlineCode': prev = node.value.slice(-1) || prev; return
      case 'break': prev = '\n'; return
      case 'html': prev = ' '; return
      case 'wikilink': prev = node.display.slice(-1) || prev; return
      case 'code': case 'yaml': case 'math': case 'image': case 'imageReference': return
      case 'link': if (linkShowsUrl(node)) { prev = 'x'; return } break
    }
    if (BLOCK_RESET.has(node.type)) prev = ''
    if (node.type === 'callout') { for (const c of node.title) visit(c); prev = '' }
    if ('children' in node) for (const c of (node as Parent).children) visit(c)
  }
  visit(root)
}
