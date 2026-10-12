import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/core/pipeline'

const html = (md: string) => renderMarkdown(md).blocks.map((b) => b.html).join('\n')
const marks = (md: string) => [...html(md).matchAll(/<mark class="hl" data-c="(\w+)"[^>]*data-s="(\d+)" data-e="(\d+)"/g)].map((m) => ({ slot: m[1], src: md.slice(+m[2], +m[3]) }))

describe('highlights', () => {
  it('==text== becomes a yellow mark covering its exact source', () => {
    expect(marks('a ==b c== d')).toEqual([{ slot: 'yellow', src: '==b c==' }])
  })
  it('spans formatting', () => {
    expect(marks('==x **y** z==')).toEqual([{ slot: 'yellow', src: '==x **y** z==' }])
    expect(marks('**a ==b==**')).toEqual([{ slot: 'yellow', src: '==b==' }])
  })
  it('reads Highlightr style and class forms', () => {
    const md = '<mark style="background: #BBFABBA6;">g</mark> <mark class="hltr-pink">p</mark> <mark>y</mark>'
    expect(marks(md).map((m) => m.slot)).toEqual(['green', 'pink', 'yellow'])
  })
  it('maps foreign colours to the nearest slot', () => {
    expect(marks('<mark style="background: #FF5582A6;">r</mark>')[0].slot).toBe('pink')
  })
  it('ignores escaped, tripled and code equals signs', () => {
    expect(marks('\\==no\\== a==b==c? ===no=== `==no==`')).toHaveLength(1) // only a==b==c-style intraword pair
    expect(marks('\\==no\\==')).toHaveLength(0)
    expect(marks('===no===')).toHaveLength(0)
    expect(marks('`==no==`')).toHaveLength(0)
  })
  it('needs non-space inside the markers', () => {
    expect(marks('== no ==')).toHaveLength(0)
  })
})

describe('wikilinks', () => {
  it('shows alias, or target › heading', () => {
    const h = html('[[Note]] [[Note|Alias]] [[Note#Head]] ![[img.png]]')
    expect(h).toContain('>Note</span>')
    expect(h).toContain('>Alias</span>')
    expect(h).toContain('>Note › Head</span>')
    expect(h).toContain('class="wikilink embed"')
  })
  it('records the whole [[…]] as its source range', () => {
    const md = 'x [[Note|Alias]] y'
    const m = /class="wikilink"[^>]*data-s="(\d+)" data-e="(\d+)"/.exec(html(md))!
    expect(md.slice(+m[1], +m[2])).toBe('[[Note|Alias]]')
  })
})

describe('caps', () => {
  it('tracks runs of capitals but not single capitals or mixed case', () => {
    const h = html('NASA and ICAO METAR, but not I or Boeing or B777')
    expect(h.match(/class="caps"/g)).toHaveLength(2)
  })
})

describe('callouts', () => {
  it('renders type, title and body', () => {
    const h = html('> [!warning] Mind the gap\n> Body text')
    expect(h).toContain('data-callout="warning"')
    expect(h).toMatch(/callout-title[^>]*>.*Mind the gap/)
    expect(h).toContain('Body text')
  })
  it('folds with - and +, and maps aliases', () => {
    expect(html('> [!tip]- T\n> b')).toMatch(/<details class="callout" data-callout="tip"/)
    expect(html('> [!tip]+ T\n> b')).toMatch(/<details class="callout"[^>]* open/)
    expect(html('> [!error]\n> b')).toContain('data-callout="danger"')
  })
  it('uses the type as title when none is given', () => {
    expect(html('> [!note]\n> b')).toMatch(/callout-title[^>]*>Note</)
  })
  it('leaves plain blockquotes alone', () => {
    expect(html('> just a quote')).toContain('<blockquote')
  })
})

describe('safety', () => {
  it('strips scripts, handlers and styles from raw HTML', () => {
    const h = html('<script>alert(1)</script>\n\n<div onclick="x()" style="color:red">hi</div>')
    expect(h).not.toMatch(/script|onclick|style=/)
    expect(h).toContain('hi')
  })
  it('never loads remote images', () => {
    expect(html('![p](https://ex.com/a.jpg)')).not.toContain('<img')
  })
  it('drops javascript: links', () => {
    expect(html('[x](javascript:alert(1))')).not.toContain('href')
  })
  it('keeps one element per top-level block', () => {
    const r = renderMarkdown('<div>a</div>\n<p>b</p>\n\n<script>x</script>\n\npara')
    for (const b of r.blocks) expect(b.html.match(/ data-b="/g)).toHaveLength(1)
  })
})
