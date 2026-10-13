import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

// The Mac app's page (app.html), driven the way Swift drives it.
test('app page: find jumps to matches in a 5 MB document', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setViewportSize({ width: 920, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  const text = readFileSync(new URL('../fixtures/stress-5mb.md', import.meta.url), 'utf8')
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, text)
  await page.evaluate(() => (window as any).leading.command({ name: 'find' }))
  await page.keyboard.type('zurich')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const state = await page.evaluate(() => ({
    count: document.querySelector('.findbar .count')!.textContent,
    scrollTop: document.getElementById('scroller')!.scrollTop,
    marks: document.querySelectorAll('.search-layer .sm').length,
  }))
  console.log(JSON.stringify(state))
  // Every block must be reachable by number, including those in the opening section.
  const lookup = await page.evaluate(() => {
    const r = (window as any).leading.view.reader
    const bad: number[] = []
    for (let b = 0; b < r.index.blocks; b += 37) {
      const el = r.blockEl(b, false)
      if (!el || Number(el.dataset.b) !== b) bad.push(b)
    }
    return bad
  })
  expect(lookup).toEqual([])
  // Wrap backwards to the last match, at the far end of the file.
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(500)
  const deep = await page.evaluate(() => ({
    count: document.querySelector('.findbar .count')!.textContent,
    marks: document.querySelectorAll('.search-layer .sm.current').length,
    drift: (window as any).leading.view.find.driftNow(),
  }))
  console.log(JSON.stringify(deep))
  expect(deep.count).toBe('2,012 of 2,012')
  expect(deep.marks).toBeGreaterThan(0)
  expect(deep.drift).toBeLessThan(2)
  expect(errors).toEqual([])
  expect(state.scrollTop).toBeGreaterThan(0)
  expect(state.marks).toBeGreaterThan(0)
})
