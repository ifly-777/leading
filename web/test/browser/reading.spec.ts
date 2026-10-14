import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Reader-first features of 1.1: resume, progress, footnotes, links.
const prose = readFileSync(new URL('../fixtures/prose.md', import.meta.url), 'utf8')

async function open(page: Page, text: string, extra: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 920, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  await page.evaluate(async ([t, x]) => { await (window as any).leading.load({ text: t, imageBase: null, ...x }) }, [text, extra] as const)
}

test('a file opens at the place the host remembered', async ({ page }) => {
  await open(page, prose)
  const mark = await page.evaluate(async () => {
    const s = document.getElementById('scroller')!
    s.scrollTop = s.scrollHeight * 0.6
    await new Promise((r) => setTimeout(r, 50))
    return (window as any).leading.view['placeMark']()
  })
  expect(mark.s).toBeGreaterThan(0)
  await open(page, prose, { resume: mark })
  const again = await page.evaluate(() => (window as any).leading.view['placeMark']())
  expect(again.s).toBe(mark.s)
  expect(Math.abs(again.dy - mark.dy)).toBeLessThan(2)
})

test('the progress mark follows the reader and stays off by default', async ({ page }) => {
  await open(page, prose)
  expect(await page.locator('.progress-rule').isVisible()).toBe(false)
  await page.evaluate(() => (window as any).leading.settings({ settings: { progress: true } }))
  const at = async (f: number) => page.evaluate(async (f) => {
    const s = document.getElementById('scroller')!
    s.scrollTop = (s.scrollHeight - s.clientHeight) * f
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const rule = document.querySelector<HTMLElement>('.progress-rule')!
    return { read: Number(rule.style.getPropertyValue('--read')), label: document.querySelector('.progress-left')!.textContent, shown: !rule.hidden }
  }, f)
  const top = await at(0)
  expect(top.shown).toBe(true)
  expect(top.read).toBeLessThan(0.02)
  const mid = await at(0.5)
  expect(mid.read).toBeGreaterThan(0.3)
  expect(mid.read).toBeLessThan(0.7)
  expect(mid.label).toMatch(/min left|minute left/)
  const end = await at(1)
  expect(end.read).toBe(1)
  expect(end.label).toBe('The end')
  // Edit mode hides it.
  await page.evaluate(() => (window as any).leading.command({ name: 'toggleEdit' }))
  expect(await page.locator('.progress-rule').isVisible()).toBe(false)
})
