import { describe, it, expect } from 'vitest'
import { fold, findAll } from '../../src/core/fold'

const find = (hay: string, q: string, o = {}) => findAll(fold(hay, (o as any).caseSensitive), hay, q, o).map(([s, e]) => hay.slice(s, e))

describe('search folding', () => {
  it('ignores case and accents', () => {
    expect(find('Café CAFE cafe', 'cafe')).toEqual(['Café', 'CAFE', 'cafe'])
    expect(find('Zürich', 'zurich')).toEqual(['Zürich'])
  })
  it('is typography-insensitive both ways', () => {
    expect(find('it’s', "it's")).toEqual(['it’s'])
    expect(find('“word”', '"word"')).toEqual(['“word”'])
    expect(find('10–20', '10--20')).toEqual(['10–20'])
    expect(find('a—b', 'a---b')).toEqual(['a—b'])
    expect(find('wait…', 'wait...')).toEqual(['wait…'])
    expect(find("it's", 'it’s')).toEqual(["it's"])
  })
  it('honours Match Case and Whole Word', () => {
    expect(find('Lead lead', 'Lead', { caseSensitive: true })).toEqual(['Lead'])
    expect(find('lead leading mislead', 'lead', { wholeWord: true })).toEqual(['lead'])
  })
  it('handles astral characters', () => {
    expect(find('a 📖 b 📖', '📖')).toHaveLength(2)
  })
})
