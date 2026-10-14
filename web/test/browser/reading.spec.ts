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

const notes = ['# Notes', 'A claim that needs support.[^a] Another.[^b]', ...Array(30).fill('Filler paragraph to give the page some length, so the endnotes sit well below the fold.'),
  '[^a]: The **support**, with [a link](https://example.com).', '[^b]: Second note.'].join('\n\n')

test('a footnote number shows its note beside it, and Esc closes it', async ({ page }) => {
  await open(page, notes)
  const ref = page.locator('#doc a[data-footnote-ref]').first()
  await ref.click()
  const pop = page.locator('.fn-pop')
  await expect(pop).toBeVisible()
  await expect(pop).toContainText('The support, with a link.')
  // A copy: no back-link, no ids, nothing that maps into the file.
  expect(await pop.evaluate((el) => el.querySelectorAll('[id], [data-s], [data-footnote-backref]').length)).toBe(0)
  // The page did not jump to the endnotes.
  expect(await page.evaluate(() => document.getElementById('scroller')!.scrollTop)).toBe(0)
  // Under the reference, within the column.
  const [r, p] = await Promise.all([ref.boundingBox(), pop.boundingBox()])
  expect(p!.y).toBeGreaterThan(r!.y)
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  // The second number replaces the first; a click elsewhere closes it.
  await ref.click()
  await page.locator('#doc a[data-footnote-ref]').nth(1).click()
  await expect(pop).toContainText('Second note.')
  await page.mouse.click(5, 400)
  await expect(pop).toBeHidden()
  // ⌥-click still jumps to the endnotes.
  await ref.click({ modifiers: ['Alt'] })
  await expect(pop).toBeHidden()
  expect(await page.evaluate(() => document.getElementById('scroller')!.scrollTop)).toBeGreaterThan(0)
})

const linked = ['# Contents', 'See [[#Second part]] and [the end](#the-end), or [[Other note#Its heading|elsewhere]].',
  ...Array(25).fill('A paragraph of filler so the headings sit well apart on the page.'), '## Second part', ...Array(25).fill('More filler.'), '## The end', 'Done.'].join('\n\n')

test('links to headings jump within the page, and Back returns', async ({ page }) => {
  await open(page, linked)
  const posted: unknown[] = []
  await page.exposeFunction('capture', (m: unknown) => posted.push(m))
  await page.evaluate(() => {
    ;(window as any).webkit = { messageHandlers: { leading: { postMessage: (m: any) => (window as any).capture(m) } } }
  })
  const top = () => page.evaluate(() => document.getElementById('scroller')!.scrollTop)
  const headingTop = (id: string) => page.evaluate((id) => document.getElementById(id)!.getBoundingClientRect().top, id)
  await page.locator('#doc .wikilink').first().click()
  expect(await top()).toBeGreaterThan(0)
  expect(await headingTop('second-part')).toBeLessThan(300)
  const before = await top()
  // A script click: Playwright would scroll the link (at the top) into view first.
  await page.evaluate(() => document.querySelector<HTMLElement>('#doc a[href="#the-end"]')!.click())
  // The last heading cannot reach the top of the window; it is at least on screen, further down.
  expect(await top()).toBeGreaterThan(before)
  expect(await headingTop('the-end')).toBeLessThan(870)
  // Back twice: to the second part, then to the very top.
  await page.evaluate(() => (window as any).leading.command({ name: 'back' }))
  expect(await headingTop('second-part')).toBeLessThan(300)
  await page.evaluate(() => (window as any).leading.command({ name: 'back' }))
  expect(await top()).toBe(0)
  // A wikilink to another note goes to Swift with its heading.
  await page.locator('#doc .wikilink', { hasText: 'elsewhere' }).click()
  expect(posted).toContainEqual({ type: 'openWiki', target: 'Other note', heading: 'Its heading' })
  expect(posted.filter((m: any) => m.type === 'canGoBack').map((m: any) => m.can)).toEqual([true, false])
  // Swift's heading jump for a just-opened document waits for it, by text or slug.
  expect(await page.evaluate(() => (window as any).leading.jumpToHeading({ text: 'the-end' }))).toBe(true)
  expect(await page.evaluate(() => (window as any).leading.jumpToHeading({ text: 'No such heading' }))).toBe(false)
})
