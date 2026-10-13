import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { toggleList, insertTable, type ListKind } from '../../src/core/blocks'
import { applyEdits, type FormatResult } from '../../src/core/format'

// « and » mark the selection before and after, as in editor-core.test.ts; «» is a bare cursor.
function run(marked: string, f: (doc: string, from: number, to: number) => FormatResult): string {
  const from = marked.indexOf('«'), to = marked.indexOf('»') - 1
  const doc = marked.replace('«', '').replace('»', '')
  const r = f(doc, from, to)
  const out = applyEdits(doc, r.changes)
  const a = Math.min(r.anchor, r.head), b = Math.max(r.anchor, r.head)
  return out.slice(0, a) + '«' + out.slice(a, b) + '»' + out.slice(b)
}
const list = (marked: string, kind: ListKind) => run(marked, (d, a, b) => toggleList(d, a, b, kind))

describe('lists', () => {
  it.each([
    ['«one\ntwo\nthree»', 'bullet', '«- one\n- two\n- three»'],
    ['«- one\n- two»', 'bullet', '«one\ntwo»'],
    ['«one\n\ntwo»', 'bullet', '«- one\n\n- two»'], // blank lines stay blank
    ['«one\ntwo»', 'number', '«1. one\n2. two»'],
    ['«- one\n- two»', 'number', '«1. one\n2. two»'], // the other kind switches over
    ['«1. one\n2. two»', 'number', '«one\ntwo»'],
    ['«a\n  b\n  c\nd»', 'number', '«1. a\n  1. b\n  2. c\n2. d»'], // nested lines number on their own
    ['«- [ ] task\nnote»', 'bullet', '«- [ ] task\n- note»'], // task boxes are kept
    ['«---\ntext»', 'bullet', '«- ---\n- text»'], // a rule is text, not a list item
  ] as const)('%j + %s → %j', (input, kind, expected) => expect(list(input, kind)).toBe(expected))

  it('a selection ending at the start of a line leaves that line alone', () => {
    expect(list('«one\n»two', 'bullet')).toBe('«- one»\ntwo')
  })

  it('with a bare cursor, changes only its line and keeps the cursor on its character', () => {
    expect(list('one\ntw«»o\nthree', 'bullet')).toBe('one\n- tw«»o\nthree')
    expect(list('one\n- tw«»o', 'bullet')).toBe('one\ntw«»o')
    expect(list('«»', 'bullet')).toBe('- «»')
    expect(list('-«» x', 'number')).toBe('1. «»x')
  })

  it('toggling twice restores the text exactly (random plain lines)', () => {
    fc.assert(fc.property(fc.array(fc.stringMatching(/^[a-z ]{0,12}$/), { minLength: 1, maxLength: 6 }), fc.constantFrom<ListKind>('bullet', 'number'), (lines, kind) => {
      const doc = lines.map((l) => l.trim()).join('\n')
      const r1 = toggleList(doc, 0, doc.length, kind)
      const d1 = applyEdits(doc, r1.changes)
      const r2 = toggleList(d1, Math.min(r1.anchor, r1.head), Math.max(r1.anchor, r1.head), kind)
      expect(applyEdits(d1, r2.changes)).toBe(doc)
    }))
  })
})

describe('tables', () => {
  const table = (marked: string) => run(marked, insertTable)

  it('starts an empty table with the first header selected', () => {
    expect(table('«»')).toBe('| «Column 1» | Column 2 |\n| -------- | -------- |\n|          |          |')
  })

  it('goes after a line of text, with blank lines around it', () => {
    expect(table('Intro«»\nNext')).toBe('Intro\n\n| «Column 1» | Column 2 |\n| -------- | -------- |\n|          |          |\n\nNext')
  })

  it('turns selected lines into rows, splitting cells on tabs', () => {
    expect(table('«Name\tAge\nAsha\t7»')).toBe('| «Name» | Age |\n| ---- | --- |\n| Asha | 7   |')
  })
})
