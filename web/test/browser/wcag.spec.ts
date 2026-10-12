import { test, expect } from '@playwright/test'

// WCAG 1.4.12 Text Spacing: with line height 1.5, paragraph spacing 2×,
// letter spacing 0.12× and word spacing 0.16× the font size, no content may
// be clipped or overlap, at desktop and narrow window widths.
for (const width of [1440, 820]) {
  test(`text spacing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/prototype.html')
    await page.waitForFunction(() => (window as any).leading && document.querySelector('#doc h1'))
    for (const f of ['prose.md', 'highlights.md', 'obsidian.md', 'tables.md', 'torture.md']) {
      const problems = await page.evaluate(async (f) => {
        const L = (window as any).leading
        await L.openFixture(f)
        await L.setWcag(true)
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        const out: string[] = []
        const sc = document.getElementById('scroller')!
        if (sc.scrollWidth > sc.clientWidth + 1) out.push(`${f}: page scrolls sideways (${sc.scrollWidth} > ${sc.clientWidth})`)
        // Text blocks must never overflow their own box. Allowed: tables and code
        // (they scroll by design), screen-reader-only text, and up to half an em
        // of hanging punctuation, which sits in the margin on purpose.
        document.querySelectorAll<HTMLElement>('#doc :is(p, li, h1, h2, h3, h4, dd, summary, .callout-title)').forEach((el) => {
          if (el.closest('.table-scroll, pre, .sr-only')) return
          const halfEm = parseFloat(getComputedStyle(el).fontSize) / 2
          // Compare the text's real right edge with the box (WebKit's scrollWidth
          // also counts a quote hanging into the LEFT margin, which is not overflow).
          const range = document.createRange()
          range.selectNodeContents(el)
          if (range.getBoundingClientRect().right > el.getBoundingClientRect().right + halfEm) out.push(`${f}: <${el.tagName.toLowerCase()}> overflows: ${el.textContent!.slice(0, 40)}`)
        })
        await L.setWcag(false)
        return out
      }, f)
      expect(problems).toEqual([])
    }
  })
}

test('screenshots for review', async ({ page }) => {
  test.skip(!process.env.SHOTS)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/prototype.html')
  await page.waitForFunction(() => (window as any).leading && document.querySelector('#doc h1'))
  const L = 'window.leading'
  await page.keyboard.press('Backslash') // hide the rail
  await page.evaluate(`(async () => { const s = ${L}.settings(); s.theme = 'dark'; s.outlineOpen = true; await ${L}.refresh(); await ${L}.openFixture('prose.md') })()`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${process.env.SHOTS}/dark-outline.png` })
  await page.locator('#outline').hover()
  await page.screenshot({ path: `${process.env.SHOTS}/dark-outline-hover.png` })
  await page.evaluate(`(async () => { const s = ${L}.settings(); s.theme = 'sepia'; await ${L}.refresh(); await ${L}.openFixture('tables.md') })()`)
  await page.evaluate(() => document.querySelectorAll('.table-bleed')[4].scrollIntoView())
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${process.env.SHOTS}/sepia-wide-table.png` })
  await page.evaluate(`(async () => { const s = ${L}.settings(); s.theme = 'light'; s.outlineOpen = false; s.highlightStyle = 'lowlight'; await ${L}.refresh(); await ${L}.openFixture('highlights.md') })()`)
  await page.keyboard.press('Meta+f')
  await page.keyboard.type('the')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${process.env.SHOTS}/find-lowlight.png` })
  await page.setViewportSize({ width: 760, height: 900 })
  await page.evaluate(`(async () => { const s = ${L}.settings(); s.outlineOpen = true; s.highlightStyle = 'marker'; await ${L}.refresh() })()`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${process.env.SHOTS}/narrow-popover.png` })
})
