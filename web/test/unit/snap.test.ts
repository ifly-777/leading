import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { snapToWords, OBJECT } from '../../src/core/snap'

// Select `sel` (its first occurrence, or the one after `after`) and return what the selection becomes.
function snapped(text: string, sel: string, lang = 'en', after = 0): string {
  const s = text.indexOf(sel, after)
  if (s < 0) throw new Error(`"${sel}" not in "${text}"`)
  const [a, z] = snapToWords(text, s, s + sel.length, lang)
  return text.slice(a, z)
}

describe('snapping a selection to words', () => {
  const t = 'The office opened its doors at nine'
  it('widens a start inside a word to the word’s start', () => {
    expect(snapped(t, 'ffice opened')).toBe('office opened')
  })
  it('widens an end inside a word to the word’s end', () => {
    expect(snapped(t, 'office ope')).toBe('office opened')
  })
  it('widens both ends', () => {
    expect(snapped(t, 'ice opened its do')).toBe('office opened its doors')
  })
  it('takes the whole word for a selection inside one word', () => {
    expect(snapped(t, 'ffi')).toBe('office')
    expect(snapped(t, 'o', 'en', 5)).toBe('opened')
  })
  it('leaves a selection already on word edges exactly as it was', () => {
    for (const sel of ['office', 'office opened', 'The', 'nine', 'its doors at', t]) {
      const s = t.indexOf(sel)
      expect(snapToWords(t, s, s + sel.length)).toEqual([s, s + sel.length])
    }
    // Spaces selected at either end stay selected; nothing shrinks.
    expect(snapped(t, ' office ')).toBe(' office ')
  })
  it('never moves an edge inward', () => {
    fc.assert(fc.property(fc.string({ maxLength: 40 }), fc.nat(40), fc.nat(40), (text, x, y) => {
      const s = Math.min(x, y, text.length), e = Math.min(Math.max(x, y), text.length)
      const [a, z] = snapToWords(text, s, e)
      return a <= s && z >= e
    }))
  })

  it('takes in punctuation that clings to the word, as far as a space', () => {
    expect(snapped('Into the office, then out.', 'offi')).toBe('office,')
    expect(snapped('Into the office, then out.', 'the office')).toBe('the office,')
    expect(snapped('He said “So it goes” and left.', 'So it')).toBe('“So it')
    expect(snapped('He said “So it goes” and left.', 'it go')).toBe('it goes”')
    expect(snapped('Ends here.', 'here')).toBe('here.')
    expect(snapped('(see above) then', 'see')).toBe('(see')
  })
  it('stops at a word when the punctuation leads to another word', () => {
    expect(snapped('the office—that one', 'office')).toBe('office')
    expect(snapped('a long-term view', 'term')).toBe('term')
    expect(snapped('a long-term view', 'ter')).toBe('term')
  })

  it('keeps apostrophes and accents inside the word', () => {
    expect(snapped('They don’t know.', 'don')).toBe('don’t')
    expect(snapped('They don\'t know.', 'n\'t')).toBe('don\'t')
    expect(snapped('Ein schönes Café am Fluss', 'öne', 'de')).toBe('schönes')
    expect(snapped('Ein schönes Café am Fluss', 'af', 'de')).toBe('Café')
    expect(snapped('The readers’ notes', 'ader')).toBe('readers’')
  })

  it('treats inline formatting and links as the text the reader sees', () => {
    // The page flattens **of**fice and [off](x)ice to the same characters.
    expect(snapped('an office here', 'fice')).toBe('office')
    expect(snapped('an office here', 'an of')).toBe('an office')
  })

  it('never crosses a formula or a picture', () => {
    const f = `energy ${OBJECT}, and mass`
    expect(snapped(f, 'ergy')).toBe('energy')
    expect(snapped(f, 'and ma')).toBe('and mass')
    expect(snapped(`x${OBJECT}yz`, 'y')).toBe('yz')
  })

  it('cuts scripts without spaces where their language does', () => {
    // Japanese: 日本語 (Japanese) and 勉強 (study) are words; the selection widens to them.
    const ja = '私は日本語を勉強しています'
    expect(snapped(ja, '本語', 'ja')).toBe('日本語')
    expect(snapped(ja, '強し', 'ja').startsWith('勉強')).toBe(true)
    // Chinese: 图书馆 (library) is one word.
    expect(snapped('我去图书馆看书', '书馆', 'zh')).toBe('图书馆')
    // A selection already on a word's edges in Chinese stays put.
    const zh = '我去图书馆看书'
    const s = zh.indexOf('图书馆')
    expect(snapToWords(zh, s, s + 3, 'zh')).toEqual([s, s + 3])
  })

  it('accepts any language tag, falling back if the runtime has no rules for it', () => {
    expect(snapped(t, 'ffice', 'de-CH')).toBe('office')
    expect(snapped(t, 'ffice', 'zxx')).toBe('office')
  })
})
