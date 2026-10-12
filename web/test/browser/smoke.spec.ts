import { test, expect } from '@playwright/test'

const FIXTURES = ['prose.md', 'highlights.md', 'obsidian.md', 'tables.md', 'torture.md']

// Every test document renders in WebKit without a single console error.
test('fixtures render cleanly', async ({ page }, info) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/prototype.html')
  await page.waitForFunction(() => (window as any).leading && document.querySelector('#doc h1'))
  for (const f of FIXTURES) {
    await page.evaluate((f) => (window as any).leading.openFixture(f), f)
    await expect(page.locator('#doc > *').first()).toBeVisible()
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${f}.png` })
  }
  expect(errors).toEqual([])
})
