import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { computeLayout } from '../../src/reader/layout'
import { classifyColumns } from '../../src/core/tables'
import { splitForParallel, referenceDefinitions } from '../../src/core/chunks'
import { renderMarkdown, renderPiece } from '../../src/core/pipeline'

describe('layout', () => {
  const base = { fontPx: 19, measureEm: 33, narrowEm: 27.5 }
  it('centres the column with no outline', () => {
    const r = computeLayout({ ...base, width: 1400, outlineOpen: false })
    expect(r.colLeft).toBeCloseTo((1400 - 33 * 19) / 2)
  })
  it('keeps the column centred when the outline fits in the margin', () => {
    const r = computeLayout({ ...base, width: 1800, outlineOpen: true })
    expect(r.outline).toBe('margin')
    expect(r.colLeft).toBeCloseTo((1800 - 33 * 19) / 2)
  })
  it('shifts left, then narrows to no less than Narrow, then becomes a popover', () => {
    const shifted = computeLayout({ ...base, width: 1150, outlineOpen: true })
    expect(shifted.outline).toBe('margin')
    expect(shifted.colLeft).toBeLessThan((1150 - 33 * 19) / 2)
    expect(shifted.outlineLeft).toBeGreaterThanOrEqual(shifted.colLeft + shifted.colW)
    const narrow = computeLayout({ ...base, width: 900, outlineOpen: true })
    if (narrow.outline === 'margin') expect(narrow.colW).toBeGreaterThanOrEqual(27.5 * 19 - 0.5)
    expect(computeLayout({ ...base, width: 640, outlineOpen: true }).outline).toBe('popover')
  })
  it('never lets the outline overlap the text', () => {
    for (let w = 500; w <= 2400; w += 25) {
      const r = computeLayout({ ...base, width: w, outlineOpen: true })
      if (r.outline === 'margin') expect(r.outlineLeft).toBeGreaterThan(r.colLeft + r.colW)
    }
  })
})

describe('table columns', () => {
  it('detects numbers, short and long columns', () => {
    const info = classifyColumns([
      ['Name', 'Amount', 'Notes'],
      ['a', '1,200', 'x'.repeat(60)],
      ['b', '(3.5%)', 'y'.repeat(50)],
      ['c', '—', 'z'.repeat(40)],
    ])
    expect(info.map((c) => c.numeric)).toEqual([false, true, false])
    expect(info[0].short).toBe(true)
    expect(info[2].long).toBe(true)
  })
})

describe('parallel pieces', () => {
  // Parses a large document twice (whole and in pieces): under a second here, but shared
  // CI runners are several times slower and once tipped it past the 5 s default.
  it('render exactly as the whole document does', { timeout: 20_000 }, () => {
    // Fixtures joined into a document big enough to split (prose.md and
    // obsidian.md use footnotes, which keep a document whole by design).
    const names = ['highlights.md', 'tables.md', 'torture.md']
    const one = names.map((n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')).join('\n\n')
    const src = Array.from({ length: 12 }, () => one).join('\n\n') + '\n\n[ref]: https://example.com\n'
    const chunks = splitForParallel(src, 6, 20_000)
    expect(chunks.length).toBeGreaterThan(3)
    const defs = referenceDefinitions(src)
    const pieces = chunks.flatMap((c) => renderPiece(src.slice(c.start, c.end) + defs, c.start).blocks)
    const whole = renderMarkdown(src).blocks
    // Heading ids may differ (duplicate-name suffixes are counted per piece); nothing else may.
    const norm = (h: string) => h.replace(/ id="[^"]*"/g, '').replace(/ data-b="\d+"/g, '')
    expect(pieces.map((b) => norm(b.html))).toEqual(whole.map((b) => norm(b.html)))
  })
  it('stays whole when footnotes are used', () => {
    expect(splitForParallel('# a\n\nx[^1]\n\n'.repeat(50000) + '[^1]: n', 8)).toHaveLength(1)
  })
})
