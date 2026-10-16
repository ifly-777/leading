// The language a note is written in, from its properties (`lang: de`, or
// `language: de`), so the page hyphenates it, and WebKit checks its spelling,
// by that language's rules. A note that names none, or names one that is not
// a language tag, is read as English, as every note was before.

export const DEFAULT_LANG = 'en'

/**
 * A language tag in its canonical form ("en-gb" → "en-GB"), or null.
 * Never throws: whatever a note's YAML holds arrives here.
 */
export function canonicalLang(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  let tag: string
  try {
    tag = Intl.getCanonicalLocales(v.trim())[0]
  } catch {
    return null
  }
  // BCP 47 also allows a 5–8 letter primary subtag for registered languages,
  // of which there are none, so "German" or "English" would otherwise pass as
  // tags that no hyphenation dictionary knows. Real ones are 2 or 3 letters.
  return tag && /^[a-z]{2,3}(?:-|$)/.test(tag) ? tag : null
}

/** The language named in parsed front matter: `lang` first, then `language`, either case. */
export function noteLang(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const keys = Object.keys(data)
  for (const want of ['lang', 'language']) {
    const k = keys.find((x) => x.toLowerCase() === want)
    if (k) return canonicalLang((data as Record<string, unknown>)[k])
  }
  return null
}
