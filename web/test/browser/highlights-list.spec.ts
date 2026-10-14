import { test, expect } from '@playwright/test'

const DOC = ['# Walden', 'Opening ==first idea== here.', '## Economy', 'Simplify, <mark style="background: #BBFABBA6;">simplify</mark>.',
  ...Array(40).fill('Filler paragraph to push things down the page.'), '## Solitude', 'Late ==second\nthought== and more.'].join('\n\n')

test('the margin lists every highlight by section; a click goes there, Copy gives Markdown', async ({ page }) => {
  const copied: string[] = []
  await page.exposeFunction('capture', (m: any) => { if (m?.type === 'copy') copied.push(m.text) })
  await page.addInitScript(() => { ;(window as any).webkit = { messageHandlers: { leading: { postMessage: (m: any) => (window as any).capture(m) } } } })
  await page.setViewportSize({ width: 1300, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, DOC)
  await page.evaluate(() => (window as any).leading.command({ name: 'showHighlights' }))
  const items = page.locator('#outline .hl-item')
  await expect(items).toHaveText(['first idea', 'simplify', 'second thought'])
  await expect(page.locator('#outline .hl-heading')).toHaveText(['Walden', 'Economy', 'Solitude'])
  // Filter by colour: only green.
  await page.locator('#outline .hl-chip[data-c="green"]').click()
  await expect(items).toHaveText(['simplify'])
  await page.locator('#outline .hl-chip[data-c="green"]').click()
  // A click goes there, and Back returns.
  await items.nth(2).click()
  const at = () => page.evaluate(() => document.querySelectorAll('#doc mark.hl')[2].getBoundingClientRect().top)
  expect(await at()).toBeGreaterThan(0)
  expect(await at()).toBeLessThan(870)
  expect(await page.evaluate(() => document.getElementById('scroller')!.scrollTop)).toBeGreaterThan(0)
  await page.evaluate(() => (window as any).leading.command({ name: 'back' }))
  expect(await page.evaluate(() => document.getElementById('scroller')!.scrollTop)).toBe(0)
  // A new highlight appears in the list.
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('#doc p span')).find((s) => s.textContent!.includes('Opening'))!.firstChild as Text
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 7)
    getSelection()!.removeAllRanges(); getSelection()!.addRange(r)
  })
  await page.evaluate(() => (window as any).leading.command({ name: 'highlightBlue' }))
  await expect(items).toHaveText(['Opening', 'first idea', 'simplify', 'second thought'])
  // Copy: the file's own syntax, grouped under headings, one line each.
  await page.locator('#outline .hl-copy').click()
  expect(copied.at(-1)).toBe([
    '# Highlights from Walden', '', '## Walden', '', '- <mark style="background: #ADCCFFA6;">Opening</mark>', '- ==first idea==',
    '', '## Economy', '', '- <mark style="background: #BBFABBA6;">simplify</mark>', '', '## Solitude', '', '- ==second thought==', '',
  ].join('\n'))
  // ⌥⌘O turns the margin back to the outline.
  await page.evaluate(() => (window as any).leading.command({ name: 'toggleOutline' }))
  await expect(page.locator('#outline')).toHaveAttribute('data-tab', 'outline')
  await expect(page.locator('#outline > ol')).toBeVisible()
})
