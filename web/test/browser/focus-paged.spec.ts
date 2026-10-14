import { test, expect, type Page } from '@playwright/test'

const DOC = ['# Focus', ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}. ` + 'Words to give it a couple of lines in the column. '.repeat(3)),
  '- item one\n- item two\n- item three', ...Array.from({ length: 30 }, (_, i) => `Later ${i + 1}. ` + 'More words here to fill the line out. '.repeat(3))].join('\n\n')

async function open(page: Page, settings: Record<string, unknown>) {
  await page.setViewportSize({ width: 920, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, DOC)
  await page.evaluate((s) => (window as any).leading.settings({ settings: s }), settings)
}

test('focus lights only the paragraph at the reading line, or the list item', async ({ page }) => {
  await open(page, { focus: true })
  const lit = () => page.evaluate(() => Array.from(document.querySelectorAll('.focus-current')).map((e) => e.textContent!.slice(0, 14)))
  const at = (text: string) => page.evaluate(async (text) => {
    const s = document.getElementById('scroller')!
    const el = Array.from(document.querySelectorAll('#doc p, #doc li')).find((e) => e.textContent!.startsWith(text)) as HTMLElement
    s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top - s.clientHeight * 0.33 + 5
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  }, text)
  await at('Paragraph 10.')
  expect(await lit()).toEqual(['Paragraph 10. '])
  const op = (sel: string) => page.evaluate((sel) => Number(getComputedStyle(document.querySelector(sel)!).opacity), sel)
  await page.waitForTimeout(400)
  expect(await op('.focus-current')).toBe(1)
  expect(await op('#doc [data-b="2"]')).toBeLessThan(0.5)
  await at('item two')
  expect(await lit()).toEqual(['item two'])
  // Off: nothing dimmed.
  await page.evaluate(() => (window as any).leading.settings({ settings: { focus: false } }))
  expect(await lit()).toEqual([])
  await page.waitForTimeout(400)
  expect(await op('#doc [data-b="2"]')).toBe(1)
})

test('page by page moves a screen less a line, and never starts on half a line', async ({ page }) => {
  await open(page, { paged: true })
  await page.locator('#scroller').focus()
  const state = () => page.evaluate(() => {
    const s = document.getElementById('scroller')!
    const band = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top')) || 0
    const lh = parseFloat(getComputedStyle(document.getElementById('doc')!).lineHeight)
    const x = s.getBoundingClientRect().left + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col-left')) + 20
    const r = (document as any).caretRangeFromPoint(x, band + 1).getBoundingClientRect()
    return { top: s.scrollTop, page: s.clientHeight - band - lh, cut: r.height > 0 && r.top < band - 0.5, lh }
  })
  const a = await state()
  await page.keyboard.press('Space')
  const b = await state()
  // One screen, less a line (minus at most one line, to start on a whole one).
  expect(b.top - a.top).toBeGreaterThan(a.page - a.lh - 1)
  expect(b.top - a.top).toBeLessThanOrEqual(a.page + 0.5)
  expect(b.cut).toBe(false)
  await page.keyboard.press('ArrowRight')
  const c = await state()
  expect(c.top).toBeGreaterThan(b.top)
  expect(c.cut).toBe(false)
  await page.keyboard.press('Shift+Space')
  await page.keyboard.press('ArrowLeft')
  expect((await state()).top).toBeLessThan(b.top)
  // Off: Space is the browser's own scroll again (not a page minus a line).
  await page.evaluate(() => (window as any).leading.settings({ settings: { paged: false } }))
})
