import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { align, sourceRange } from '../../src/core/sourcemap'
import { parse } from '../../src/core/pipeline'
import { textOf } from '../../src/core/text'

describe('align', () => {
  it('maps escapes, entities and smart punctuation back to source', () => {
    const src = 'a \\* b &amp; "c" -- d...'
    const rendered = 'a * b & “c” – d…'
    const m = align(rendered, src, 0, src.length)
    const at = (ch: string) => { const i = rendered.indexOf(ch); return src.slice(m.from[i], m.to[i]) }
    expect(at('*')).toBe('\\*')
    expect(at('&')).toBe('&amp;')
    expect(at('“')).toBe('"')
    expect(at('–')).toBe('--')
    expect(at('…')).toBe('...')
    expect(sourceRange(m, 0, rendered.length)).toEqual([0, src.length])
  })

  it('skips line prefixes in block quotes', () => {
    const src = '> one\n> two'
    const tree = parse(src)
    const t = (tree.children[0] as any).children[0].children[0]
    const m = align(t.value, src, t.position.start.offset, t.position.end.offset)
    const i = t.value.indexOf('two')
    expect(src.slice(m.from[i], m.to[i + 2])).toBe('two')
  })

  // Every rendered character of every text node must map onto a source
  // character that "is" that character, for arbitrary inline Markdown.
  const word = fc.stringMatching(/^[a-z]{1,6}$/)
  const piece = fc.oneof(
    word, word.map((w) => `**${w}**`), word.map((w) => `*${w}*`), word.map((w) => `[${w}](http://x.y/${w})`),
    word.map((w) => `"${w}"`), word.map((w) => `${w}'s`), fc.constant('--'), fc.constant('...'),
    fc.constant('\\*'), fc.constant('&amp;'), word.map((w) => `==${w}==`), word.map((w) => `[[${w}]]`),
  )
  const SAME: Record<string, string[]> = { '‘': ["'"], '’': ["'"], '“': ['"'], '”': ['"'], '–': ['--'], '—': ['---'], '…': ['...'], '&': ['&amp;'], '*': ['\\*'] }
  it('maps every rendered character to a matching source character (random documents)', () => {
    fc.assert(fc.property(fc.array(piece, { minLength: 1, maxLength: 12 }), (pieces) => {
      const src = pieces.join(' ')
      const tree = parse(src)
      const visit = (n: any) => {
        if (n.type === 'text' && n.position) {
          const m = align(n.value, src, n.position.start.offset, n.position.end.offset)
          for (let i = 0; i < n.value.length; i++) {
            const got = src.slice(m.from[i], m.to[i])
            expect(got === n.value[i] || (SAME[n.value[i]] ?? []).includes(got), `${JSON.stringify(src)}: ${n.value[i]} ↦ ${got}`).toBe(true)
          }
        }
        n.children?.forEach(visit)
      }
      visit(tree)
    }), { numRuns: 400 })
  })
})
