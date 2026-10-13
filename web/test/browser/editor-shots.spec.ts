import { test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Screenshots of edit mode for review (run with SHOTS=dir).
test('edit mode screenshots', async ({ page }) => {
  test.skip(!process.env.SHOTS)
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  const text = readFileSync(new URL('../fixtures/highlights.md', import.meta.url), 'utf8')
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, text)
  await page.evaluate(() => (window as any).leading.command({ name: 'toggleEdit' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${process.env.SHOTS}/edit-light.png` })
  // Select a word with the mouse to show the formatting bar.
  const box = await page.locator('.cm-line').nth(6).boundingBox()
  await page.mouse.move(box!.x + 40, box!.y + 10); await page.mouse.down(); await page.mouse.move(box!.x + 160, box!.y + 10); await page.mouse.up()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${process.env.SHOTS}/edit-popover.png` })
  await page.evaluate(() => (window as any).leading.settings({ settings: { theme: 'dark' } }))
  await page.evaluate(() => (window as any).leading.command({ name: 'findReplace' }))
  await page.keyboard.type('highlight')
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${process.env.SHOTS}/edit-dark-find.png` })
})
