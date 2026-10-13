import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { toggleFormat, toggleLink, applyEdits, type Format } from '../../src/core/format'
import { alignTable, splitRow, displayWidth, cellIndexAt, cellStart } from '../../src/core/table-align'
import { fingerprint } from '../../src/core/hash'

// Apply a format to the text between « and » (the selection); return the result with the new selection marked.
function fmt(marked: string, f: Format | 'link'): string {
  const from = marked.indexOf('«'), to = marked.indexOf('»') - 1
  const doc = marked.replace('«', '').replace('»', '')
  const r = f === 'link' ? toggleLink(doc, from, to) : toggleFormat(doc, from, to, f)
  const out = applyEdits(doc, r.changes)
  const a = Math.min(r.anchor, r.head), b = Math.max(r.anchor, r.head)
  return out.slice(0, a) + '«' + out.slice(a, b) + '»' + out.slice(b)
}

describe('format toggles', () => {
  // « » mark the selection before and after; «» is a bare cursor.
  it.each([
    ['a «word» b', 'bold', 'a **«word»** b'],
    ['a **«word»** b', 'bold', 'a «word» b'],
    ['a «**word**» b', 'bold', 'a «word» b'],
    ['a «word» b', 'italic', 'a *«word»* b'],
    ['a *«word»* b', 'italic', 'a «word» b'],
    ['a **«word»** b', 'italic', 'a ***«word»*** b'], // italic on bold adds, never removes bold
    ['a ***«word»*** b', 'bold', 'a *«word»* b'],
    ['« spaced »', 'bold', ' **«spaced»** '], // markers hug the text
    ['a «word» b', 'underline', 'a <u>«word»</u> b'],
    ['a <u>«word»</u> b', 'underline', 'a «word» b'],
    ['a «word» b', 'strike', 'a ~~«word»~~ b'],
    ['a «x» b', 'code', 'a `«x»` b'],
  ] as const)('%s + %s → %s', (input, f, expected) => expect(fmt(input, f)).toBe(expected))

  it('formats the word under the cursor, or inserts an empty pair', () => {
    expect(fmt('a wo«»rd b', 'bold')).toBe('a **«word»** b')
    expect(fmt('a «»', 'bold')).toBe('a **«»**')
    expect(fmt('a **«»**', 'bold')).toBe('a «»')
  })

  it('formats each line of a multi-line selection, and toggles back', () => {
    const once = fmt('«one\ntwo»', 'bold')
    expect(once).toBe('«**one**\n**two**»')
    expect(fmt(once, 'bold')).toBe('«one\ntwo»')
  })

  it('links: text, a bare address, and unwrapping', () => {
    expect(fmt('see «docs» now', 'link')).toBe('see [docs](«») now')
    expect(fmt('«https://ex.com»', 'link')).toBe('[«»](https://ex.com)')
    expect(fmt('a «[x](https://e.com)» b', 'link')).toBe('a «x» b')
    expect(fmt('a [x](https://e«»x.com) b', 'link')).toBe('a «x» b')
  })

  it('applying any format twice restores the text exactly (random text and selections)', () => {
    const formats: Format[] = ['bold', 'italic', 'underline', 'strike', 'code']
    fc.assert(fc.property(fc.stringMatching(/^[a-z ]{1,30}$/), fc.nat(), fc.nat(), fc.constantFrom(...formats), (doc, x, y, f) => {
      let from = x % (doc.length + 1), to = y % (doc.length + 1)
      if (from > to) [from, to] = [to, from]
      const r1 = toggleFormat(doc, from, to, f)
      const d1 = applyEdits(doc, r1.changes)
      const r2 = toggleFormat(d1, Math.min(r1.anchor, r1.head), Math.max(r1.anchor, r1.head), f)
      const d2 = applyEdits(d1, r2.changes)
      // Removing the format must leave the text as it was (spaces trimmed out of the selection are untouched).
      expect(d2).toBe(doc)
    }), { numRuns: 500 })
  })
})

describe('table alignment', () => {
  it('aligns pipes, keeps alignment colons, pads to the widest cell', () => {
    const out = alignTable(['|a|b|c|', '|:-|:-:|-:|', '|long cell|x|1,200|'])
    expect(out).toEqual([
      '| a         |  b  |     c |',
      '| :-------- | :-: | ----: |',
      '| long cell |  x  | 1,200 |',
    ])
  })
  it('keeps escaped pipes and pipes in code inside their cell', () => {
    expect(splitRow('| a \\| b | `x|y` | c |').cells).toEqual(['a \\| b', '`x|y`', 'c'])
  })
  it('counts wide characters as two columns', () => {
    expect(displayWidth('行間')).toBe(4)
    expect(displayWidth('café')).toBe(4)
    const out = alignTable(['| 行間 | a |', '|---|---|', '| x | b |'])
    // The second column starts at the same display column on both rows.
    const col = (row: string, cell: string) => displayWidth(row.slice(0, row.indexOf(cell)))
    expect(col(out[0], '| a')).toBe(col(out[2], '| b'))
  })
  it('fills missing cells', () => {
    expect(alignTable(['| a | b |', '|---|---|', '| only |'])[2]).toBe('| only |     |')
  })
  it('finds cells for Tab navigation', () => {
    const line = '| one | two | three |'
    expect(cellIndexAt(line, 3)).toBe(0)
    expect(cellIndexAt(line, 9)).toBe(1)
    expect(line.slice(cellStart(line, 2))).toBe('three |')
    // An empty cell starts just inside it, never on the closing pipe.
    expect(cellStart('| a   |       |', 1)).toBe(8)
  })
})

describe('fingerprint', () => {
  it('matches the known FNV-1a values used by the Swift side', () => {
    expect(fingerprint('')).toBe(0x811c9dc5)
    expect(fingerprint('a')).toBe(0xe40c292c)
    expect(fingerprint('Café — “Leading”')).toBe(fingerprint('Café — “Leading”'))
  })
})
