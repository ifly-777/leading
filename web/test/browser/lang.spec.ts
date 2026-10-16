import { test, expect, type Page } from '@playwright/test'

// A note names its language in its properties (`lang: de`), and the page is
// set in it: hyphenation follows that language's rules, on screen, on paper
// and in Quick Look, which all show this page.

async function openApp(page: Page, text: string, imageBase: string | null = null) {
  await page.addInitScript(() => {
    ;(window as any).webkit = { messageHandlers: { leading: { postMessage: (m: any) => { if (m?.type === 'ready') (window as any).__ready = true } } } }
  })
  await page.setViewportSize({ width: 1100, height: 850 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).__ready)
  await page.evaluate(async ({ t, imageBase }) => { await (window as any).leading.load({ text: t, imageBase }) }, { t: text, imageBase })
  await page.evaluate(() => document.fonts.ready)
}

const GERMAN = 'Der Donaudampfschifffahrtsgesellschaftskapitän las die Rechtsschutzversicherungsgesellschaften vor, während die Kraftfahrzeughaftpflichtversicherung unbeantwortet blieb.'

test('a note set in German is marked as German, and its long words hyphenate when justified', async ({ page }) => {
  await openApp(page, `---\nlang: de\n---\n\n${GERMAN}\n`)
  await expect(page.locator('#doc')).toHaveAttribute('lang', 'de')
  await expect(page.locator('#editor')).toHaveAttribute('lang', 'de')

  // Which hyphenation rules WebKit applies, and whether it has a German
  // dictionary at all, depends on the platform: CoreText's on macOS, the
  // system's libhyphen data (if installed) on Linux. Leading ships on macOS.
  test.skip(process.platform !== 'darwin', 'hyphenation dictionaries are platform data; Leading ships on macOS WebKit')
  const split = await page.evaluate(() => {
    document.documentElement.dataset.align = 'justify'
    const doc = document.querySelector<HTMLElement>('#doc')!
    const p = doc.querySelector<HTMLElement>('p')!
    const r = document.createRange()
    const words = () => {
      const out: { t: Text; i: number; n: number }[] = []
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) for (const m of (w.currentNode as Text).data.matchAll(/\p{L}{12,}/gu)) out.push({ t: w.currentNode as Text, i: m.index!, n: m[0].length })
      return out
    }
    // Wide enough for the longest word, so only hyphenation can split one
    // (never overflow-wrap's emergency break), and narrow enough to need it.
    let widest = 0
    for (const { t, i, n } of words()) { r.setStart(t, i); r.setEnd(t, i + n); widest = Math.max(widest, r.getBoundingClientRect().width) }
    p.style.width = Math.ceil(widest + 8) + 'px'
    // A word is hyphenated when its letters sit on more than one line.
    const hyphenated = () => words().filter(({ t, i, n }) => {
      const tops = new Set<number>()
      for (let k = i; k < i + n; k++) { r.setStart(t, k); r.setEnd(t, k + 1); tops.add(Math.round(r.getClientRects()[0].top)) }
      return tops.size > 1
    }).length
    const de = hyphenated()
    // The control: the same text marked as having no language breaks no word.
    doc.lang = 'zxx'
    const none = hyphenated()
    doc.lang = 'de'
    return { de, none }
  })
  expect(split.none).toBe(0)
  expect(split.de).toBeGreaterThan(0)
})

test('a note that names no language, or an invalid one, is read as English', async ({ page }) => {
  await openApp(page, 'Plain text.\n')
  await expect(page.locator('#doc')).toHaveAttribute('lang', 'en')
  await page.evaluate(async () => { await (window as any).leading.load({ text: '---\nlang: Klingon please\n---\n\nText.\n', imageBase: null }) })
  await expect(page.locator('#doc')).toHaveAttribute('lang', 'en')
  // A note in one language, then another without: the first does not linger.
  await page.evaluate(async () => { await (window as any).leading.load({ text: '---\nlanguage: fr\n---\n\nTexte.\n', imageBase: null }) })
  await expect(page.locator('#doc')).toHaveAttribute('lang', 'fr')
  await page.evaluate(async () => { await (window as any).leading.load({ text: 'Text.\n', imageBase: null }) })
  await expect(page.locator('#doc')).toHaveAttribute('lang', 'en')
})

test('an embedded note keeps the language it names', async ({ page }) => {
  await page.route('**/__wiki/abc/Notiz', (r) => r.fulfill({ body: `---\nlang: de\n---\n\n${GERMAN}\n`, contentType: 'text/plain' }))
  await page.route('**/__wiki/abc/Plain', (r) => r.fulfill({ body: 'No language named here.\n', contentType: 'text/plain' }))
  await openApp(page, '---\nlang: en-GB\n---\n\n![[Notiz]]\n\n![[Plain]]\n', '/doc/abc/')
  await expect(page.locator('#doc')).toHaveAttribute('lang', 'en-GB')
  const [de, plain] = [page.locator('#doc .note-embed').nth(0), page.locator('#doc .note-embed').nth(1)]
  await expect(de).toHaveAttribute('data-filled', 'yes')
  await expect(plain).toHaveAttribute('data-filled', 'yes')
  await expect(de).toHaveAttribute('lang', 'de')
  // One that names none reads as the page around it does.
  expect(await plain.getAttribute('lang')).toBeNull()
})
