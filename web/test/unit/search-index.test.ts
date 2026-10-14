import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SearchIndex } from '../../src/core/search-index'
import { fold } from '../../src/core/fold'
import { renderMarkdown, renderPiece } from '../../src/core/pipeline'
import { splitForParallel } from '../../src/core/chunks'

describe('search index', () => {
  it('reports block and ordinal for each match', () => {
    const ix = new SearchIndex()
    ix.add({ texts: ['the cat', 'no', 'the the'] })
    expect(ix.find('the')).toEqual([{ b: 0, k: 0 }, { b: 2, k: 0 }, { b: 2, k: 1 }])
  })
  it('never matches across blocks', () => {
    const ix = new SearchIndex()
    ix.add({ texts: ['ends with lead', 'ing starts'] })
    expect(ix.find('leading')).toEqual([])
  })
  it('gives the same answers whether built whole or from pre-folded pieces', () => {
    const texts = ['Café “quoted”', 'it’s 10–20…', 'CAFE', 'plain', 'cafe again']
    const whole = new SearchIndex()
    whole.add({ texts })
    const parts = new SearchIndex()
    for (const chunk of [texts.slice(0, 2), texts.slice(2, 3), texts.slice(3)]) parts.add({ texts: chunk, folded: fold(chunk.join('\n')) })
    for (const q of ['cafe', '"quoted"', "it's", '10--20', '...', 'again', 'e']) {
      expect(parts.find(q), q).toEqual(whole.find(q))
      expect(parts.find(q, { caseSensitive: true }), q).toEqual(whole.find(q, { caseSensitive: true }))
    }
  })
  // Parses a large document twice (whole and in pieces): under a second here, but shared
  // CI runners are several times slower and once tipped it past the 5 s default.
  it('counts the same hits in a parallel-parsed document as in a whole one', { timeout: 20_000 }, () => {
    const one = ['highlights.md', 'tables.md', 'torture.md'].map((n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')).join('\n\n')
    const src = Array.from({ length: 8 }, () => one).join('\n\n')
    const whole = new SearchIndex()
    whole.add({ texts: renderMarkdown(src).blocks.map((b) => b.text) })
    const parts = new SearchIndex()
    for (const c of splitForParallel(src, 6, 20_000)) {
      const texts = renderPiece(src.slice(c.start, c.end), c.start).blocks.map((b) => b.text)
      parts.add({ texts, folded: fold(texts.join('\n')) })
    }
    for (const q of ['the', 'highlight', "it's", 'EGLL', 'zürich', '--']) expect(parts.find(q), q).toEqual(whole.find(q))
  })
})
