import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { highlightEdits, highlightAt, unitsForTest, shapeForTest } from '../../src/core/highlight-edit'
import { parse } from '../../src/core/pipeline'
import { applyEdits } from '../../src/core/format'
import type { HighlightSlot } from '../../src/core/nodes'

const GREEN = '<mark style="background: #BBFABBA6;">'

/** Top-level block ranges, as the reader's page reports them. */
const blocksOf = (src: string): [number, number][] =>
  parse(src).children.map((c) => [c.position!.start.offset!, c.position!.end.offset!])

/**
 * Write the selection into the source with « and »: they stand where the
 * rendered selection's two ends map to. Returns the file after highlighting.
 */
function run(marked: string, slot: HighlightSlot | null, toggle = false): string {
  const from = marked.indexOf('«')
  const to = marked.indexOf('»') - 1
  const src = marked.replace('«', '').replace('»', '')
  const r = highlightEdits(src, blocksOf(src), from, to, slot, { toggle })
  if (!r.ok) return 'REFUSED'
  return applyEdits(src, r.edits)
}

describe('placing highlights', () => {
  it('wraps a plain selection', () => {
    expect(run('A **bold** «idea» here', 'yellow')).toBe('A **bold** ==idea== here')
  })
  it('puts markers outside formatting that is wholly selected', () => {
    expect(run('A «**bold** idea» here', 'yellow')).toBe('A ==**bold** idea== here')
    expect(run('A «*it* and **b**» z', 'yellow')).toBe('A ==*it* and **b**== z')
  })
  it('puts markers inside formatting that is partly selected', () => {
    expect(run('A **bo«ld** id»ea', 'yellow')).toBe('A **bo==ld==** ==id==ea')
  })
  it('handles links wholly and partly selected', () => {
    expect(run('see «[the link](http://x.com) and» more', 'yellow')).toBe('see ==[the link](http://x.com) and== more')
    expect(run('[the «link](u) and» more', 'yellow')).toBe('[the ==link==](u) ==and== more')
  })
  it('splits across paragraphs, list items and table cells', () => {
    expect(run('one «two\n\nthree» four', 'yellow')).toBe('one ==two==\n\n==three== four')
    expect(run('- «one\n- two»', 'yellow')).toBe('- ==one==\n- ==two==')
    expect(run('| a | b |\n|---|---|\n| «x | y» |', 'yellow')).toBe('| a | b |\n|---|---|\n| ==x== | ==y== |')
  })
  it('keeps quote prefixes outside, across lines', () => {
    expect(run('> «line one\n> line two»', 'yellow')).toBe('> ==line one\n> line two==')
  })
  it('works in headings and callouts', () => {
    expect(run('## «Title»', 'yellow')).toBe('## ==Title==')
    expect(run('> [!note] «Heads up»\n> body', 'yellow')).toBe('> [!note] ==Heads up==\n> body')
  })
  it('never splits code, wikilinks or images', () => {
    expect(run('run `np«m run` now»', 'yellow')).toBe('run ==`npm run` now==')
    expect(run('see [[No«te]] he»re', 'yellow')).toBe('see ==[[Note]] he==re')
  })
  it('skips code blocks and front matter', () => {
    expect(run('«para\n\n```\ncode\n```\n\nend»', 'yellow')).toBe('==para==\n\n```\ncode\n```\n\n==end==')
    expect(run('«---\ntitle: x\n---\n\nbody»', 'yellow')).toBe('---\ntitle: x\n---\n\n==body==')
  })
  it('writes other colours as Highlightr marks', () => {
    expect(run('a «b» c', 'green')).toBe(`a ${GREEN}b</mark> c`)
  })
  it('falls back to <mark> where == would not open or close', () => {
    expect(run('foo«(bar)» baz', 'yellow')).toBe('foo<mark>(bar)</mark> baz')
    expect(run('==foo==«bar»', 'yellow')).toBe('==foo==<mark>bar</mark>')
  })
  it('keeps smart quotes, escapes, entities, emoji and CRLF intact', () => {
    expect(run('He said «"hi"» there', 'yellow')).toBe('He said =="hi"== there')
    expect(run('a «\\*b\\*» c', 'yellow')).toBe('a ==\\*b\\*== c')
    expect(run('«&amp; b»', 'yellow')).toBe('==&amp; b==')
    expect(run('a «😀 b»', 'yellow')).toBe('a ==😀 b==')
    expect(run('one «two»\r\nthree', 'yellow')).toBe('one ==two==\r\nthree')
  })
  it('keeps inline HTML pairs together', () => {
    expect(run('x «<u>under</u> y»', 'yellow')).toBe('x ==<u>under</u> y==')
    expect(run('<u>un«der</u> y»', 'yellow')).toBe('<u>un==der==</u> ==y==')
  })
  it('leaves spaces outside the markers', () => {
    expect(run('a« b »c', 'yellow')).toBe('a ==b== c')
  })
})

describe('changing and removing highlights', () => {
  it('recolours only the overlap', () => {
    expect(run('==alpha «beta» gamma==', 'green')).toBe(`==alpha== ${GREEN}beta</mark> ==gamma==`)
  })
  it('removes part or all of a highlight', () => {
    expect(run('==alpha «beta» gamma==', null)).toBe('==alpha== beta ==gamma==')
    expect(run('«==alpha==»', null)).toBe('alpha')
    expect(run(`x ${GREEN}«one two»</mark> y`, null)).toBe('x one two y')
  })
  it('keeps a foreign colour and syntax on what remains', () => {
    const red = '<mark style="background: #FF5582A6;">'
    expect(run(`${red}one «two»</mark>`, null)).toBe(`${red}one</mark> two`)
  })
  it('extends a highlight of the same colour instead of nesting', () => {
    expect(run('==alpha== «beta»', 'yellow')).toBe('==alpha== ==beta==')
    expect(run('==al«pha== beta»', 'yellow')).toBe('==alpha beta==')
  })
  it('toggles off when the selection already has the colour', () => {
    expect(run('«==foo==»', 'yellow', true)).toBe('foo')
    expect(run('«==foo==»', 'green', true)).toBe(`${GREEN}foo</mark>`)
  })
  it('leaves untouched highlights byte for byte', () => {
    const src = '==keep==  and <mark class="hltr-pink">this</mark> «new»'
    expect(run(src, 'yellow')).toBe('==keep==  and <mark class="hltr-pink">this</mark> ==new==')
  })
  it('finds the highlight around a position', () => {
    const src = 'a ==bc== d'
    expect(highlightAt(src, [0, src.length], 4)).toEqual([2, 8])
    expect(highlightAt(src, [0, src.length], 0)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Random documents and selections. For every one: the text reads exactly as
// before, exactly the selected characters carry the new colour, every other
// character keeps its colour, and the structure (links, bold, lists…) is the same.

const word = fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'Ünïcode', 'it’s', "don't", '"quoted"', 'x--y', 'end...', '😀', 'NASA', 'a&amp;b', 'c\\*d', '(paren)', 'one.')
const inline: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: word },
  { weight: 1, arbitrary: word.map((w) => `**${w} ${w}**`) },
  { weight: 1, arbitrary: word.map((w) => `*${w}*`) },
  { weight: 1, arbitrary: word.map((w) => `[${w} link](https://e.com/${w.length})`) },
  { weight: 1, arbitrary: word.map((w) => `\`${w} code\``) },
  { weight: 1, arbitrary: word.map((w) => `==${w} hl==`) },
  { weight: 1, arbitrary: word.map((w) => `${GREEN}${w} g</mark>`) },
  { weight: 1, arbitrary: word.map((w) => `[[${w}]]`) },
  { weight: 1, arbitrary: word.map((w) => `<u>${w}</u>`) },
  { weight: 1, arbitrary: word.map((w) => `~~${w}~~`) },
)
const line = fc.array(inline, { minLength: 1, maxLength: 8 }).map((ws) => ws.join(' '))
const block = fc.oneof(
  { weight: 4, arbitrary: line },
  { weight: 1, arbitrary: line.map((l) => '## ' + l) },
  { weight: 1, arbitrary: fc.array(line, { minLength: 1, maxLength: 3 }).map((ls) => ls.map((l) => '- ' + l).join('\n')) },
  { weight: 1, arbitrary: fc.array(line, { minLength: 1, maxLength: 2 }).map((ls) => ls.map((l) => '> ' + l).join('\n')) },
  { weight: 1, arbitrary: fc.tuple(line, line).map(([a, b]) => `| h | i |\n|---|---|\n| ${a.replace(/\|/g, '')} | ${b.replace(/\|/g, '')} |`) },
  { weight: 1, arbitrary: line.map((l) => '> [!tip] ' + l + '\n> ' + l) },
  { weight: 1, arbitrary: fc.constant('```\ncode ==not==\n```') },
)
const doc = fc.array(block, { minLength: 1, maxLength: 5 }).map((bs) => bs.join('\n\n'))
const slot = fc.constantFrom<HighlightSlot | null>('yellow', 'green', 'blue', 'pink', 'orange', null)

describe('random documents and selections', () => {
  it('highlight exactly what was selected, and change nothing else', () => {
    let refused = 0
    let total = 0
    fc.assert(
      fc.property(doc, fc.nat(), fc.nat(), slot, (src, i, j, sl) => {
        const units = unitsForTest(src)
        fc.pre(units.length > 0)
        let a = i % units.length, b = j % units.length
        if (a > b) [a, b] = [b, a]
        const from = units[a].s, to = units[b].e
        total++
        const r = highlightEdits(src, blocksOf(src), from, to, sl)
        if (!r.ok) { refused++; return }
        const out = applyEdits(src, r.edits)
        // The same structure and text…
        expect(shapeForTest(out)).toBe(shapeForTest(src))
        const before = units.filter((u) => !u.ws)
        const after = unitsForTest(out).filter((u) => !u.ws)
        expect(after.map((u) => u.ch).join('')).toBe(before.map((u) => u.ch).join(''))
        // …and the colours intended, character by character.
        const want = before.map((u) => (u.s < to && u.e > from ? sl : u.slot))
        expect(after.map((u) => u.slot)).toEqual(want)
      }),
      { numRuns: 3000, seed: 20261013 },
    )
    // A refusal is safe but should be rare.
    expect(refused / total).toBeLessThan(0.01)
  }, 120_000)
})
