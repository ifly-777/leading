import { test, expect } from '@playwright/test'

// Search marks must stay on their text while the reader scrolls through parts
// of a long document that have never been laid out, and after jumps.
test('search marks stay on their text', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/prototype.html')
  await page.waitForFunction(() => (window as any).leading && document.querySelector('#doc h1'))
  await page.evaluate(() => (window as any).leading.openFixture('stress-5mb.md'))
  await page.keyboard.press('Meta+f')
  await page.keyboard.type('the')
  const drift: number[] = []
  const measure = async () => { await page.waitForTimeout(400); drift.push(await page.evaluate(() => (window as any).leading.find.driftNow())) }
  await page.mouse.move(900, 450)
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 20000 + i * 15000); await measure() }
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -9000); await measure() }
  await page.keyboard.press('Meta+g'); await measure()
  console.log('drift (px):', drift.map((n) => n.toFixed(0)).join(' '))
  for (const d of drift) expect(d).toBeLessThan(2)
})
