import { describe, it, expect } from 'vitest'
import { canonicalLang, noteLang } from '../../src/core/lang'
import { renderMarkdown, renderPiece } from '../../src/core/pipeline'

describe('a note’s language', () => {
  it('is a language tag, put in canonical form', () => {
    expect(canonicalLang('de')).toBe('de')
    expect(canonicalLang('DE')).toBe('de')
    expect(canonicalLang('en-gb')).toBe('en-GB')
    expect(canonicalLang(' pt-BR ')).toBe('pt-BR')
    expect(canonicalLang('zh-hant-tw')).toBe('zh-Hant-TW')
    expect(canonicalLang('sr-Latn')).toBe('sr-Latn')
  })

  it('is nothing at all when the value is not a tag, and never throws', () => {
    for (const bad of ['', '  ', 'en_GB!', 'de-', '--', 'x', 'German', 'english', '12', 'en GB']) expect(canonicalLang(bad)).toBeNull()
    for (const bad of [12, true, null, undefined, ['de'], { de: 1 }, new Date(0)]) expect(canonicalLang(bad)).toBeNull()
  })

  it('is read from lang, then language, in either case', () => {
    expect(noteLang({ lang: 'de' })).toBe('de')
    expect(noteLang({ language: 'fr-CA' })).toBe('fr-CA')
    expect(noteLang({ Language: 'it' })).toBe('it')
    expect(noteLang({ language: 'fr', lang: 'de' })).toBe('de')
    expect(noteLang({ title: 'x' })).toBeNull()
    expect(noteLang(null)).toBeNull()
    expect(noteLang('lang: de')).toBeNull()
    expect(noteLang(['de'])).toBeNull()
  })

  const lang = (src: string) => renderMarkdown(src).lang
  it('comes from the front matter the page already parses', () => {
    expect(lang('---\nlang: de\n---\n\nText.')).toBe('de')
    expect(lang('---\ntitle: Notes\nlanguage: en-gb\n---\n\nText.')).toBe('en-GB')
    // YAML 1.2: "no" is Norwegian, not false.
    expect(lang('---\nlang: no\n---\n\nText.')).toBe('no')
  })

  it('falls back to the default when missing, invalid or not a string', () => {
    expect(lang('Text with no properties.')).toBeUndefined()
    expect(lang('---\ntitle: Notes\n---\n\nText.')).toBeUndefined()
    expect(lang('---\nlang: German\n---\n\nText.')).toBeUndefined()
    expect(lang('---\nlang: 42\n---\n\nText.')).toBeUndefined()
    expect(lang('---\nlang: [de, fr]\n---\n\nText.')).toBeUndefined()
    expect(lang('---\nlang: { code: de }\n---\n\nText.')).toBeUndefined()
    expect(lang('---\nlang:\n---\n\nText.')).toBeUndefined()
    // YAML that does not parse still shows as text, and names no language.
    expect(lang('---\nlang: [de\n---\n\nText.')).toBeUndefined()
  })

  it('is not taken from YAML-looking text later in the note', () => {
    expect(lang('Text.\n\n---\nlang: de\n---\n')).toBeUndefined()
    // A piece of a long file after the first holds no front matter.
    expect(renderPiece('# Later\n\nlang: de\n', 5000).lang).toBeUndefined()
  })
})
