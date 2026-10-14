import { test, expect, type Page } from '@playwright/test'

async function open(page: Page, text: string) {
  await page.setViewportSize({ width: 920, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, text)
}
const text = () => (window as any).leading.view.text

test('ticking a task while reading writes [x] into the file, and ⌘Z takes it back', async ({ page }) => {
  await open(page, '# Today\n\n- [ ] Walkaround\n- [x] Briefing\n  1. [ ] Nested NOTAMs\n\nLoose:\n\n* [ ] One\n\n* [ ] Two\n')
  const boxes = page.locator('#doc li.task-list-item input[type=checkbox]')
  await expect(boxes).toHaveCount(5)
  await boxes.nth(0).click()
  await expect.poll(() => page.evaluate(text)).toContain('- [x] Walkaround')
  await expect(boxes.nth(0)).toBeChecked()
  await boxes.nth(1).click()
  await expect.poll(() => page.evaluate(text)).toContain('- [ ] Briefing')
  await boxes.nth(2).click()
  await expect.poll(() => page.evaluate(text)).toContain('  1. [x] Nested NOTAMs')
  await boxes.nth(4).click() // in a loose list, the box sits inside a paragraph
  await expect.poll(() => page.evaluate(text)).toContain('* [x] Two')
  await page.evaluate(() => (window as any).leading.command({ name: 'undo' }))
  await expect.poll(() => page.evaluate(text)).toContain('* [ ] Two')
  // Everything else is as it was.
  expect(await page.evaluate(text)).toBe('# Today\n\n- [x] Walkaround\n- [ ] Briefing\n  1. [x] Nested NOTAMs\n\nLoose:\n\n* [ ] One\n\n* [ ] Two\n')
})
