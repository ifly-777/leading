import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Math and Mermaid in the app page, under the app's own Content-Security-Policy.
async function open(page: Page, text: string) {
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(String(e)))
  page.on('console', (m) => { if (/Refused|Content Security Policy|CSP/i.test(m.text())) problems.push(m.text()) })
  await page.setViewportSize({ width: 920, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  await page.evaluate(() => document.addEventListener('securitypolicyviolation', (e) => console.log('CSP ' + e.violatedDirective + ' ' + e.blockedURI)))
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, text)
  return problems
}

const flow = ['```mermaid', 'graph LR', '  A[Read] --> B{Highlight?}', '  B -->|yes| C[Write ==text==]', '  B -->|no| A', '```'].join('\n')
const seq = ['```mermaid', 'sequenceDiagram', '  Reader->>Leading: open file', '  Leading-->>Reader: the page', '```'].join('\n')

test('math is typeset with the first paint, in KaTeX fonts', async ({ page }) => {
  const problems = await open(page, 'Euler: $e^{i\\pi} + 1 = 0$.\n\n$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n$$\n\nCosts $5 and $10.')
  expect(await page.locator('#doc .math .katex').count()).toBe(2)
  expect(await page.locator('#doc .math.display .katex-display').count()).toBe(1)
  // Prices are prose.
  await expect(page.locator('#doc p').last()).toHaveText('Costs $5 and $10.')
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('20px KaTeX_Main'))).toBe(true)
  // Find does not see TeX, and the count matches what the page shows.
  await page.evaluate(() => (window as any).leading.command({ name: 'find' }))
  await page.keyboard.type('frac')
  await page.waitForTimeout(300)
  await expect(page.locator('.findbar .count')).toHaveText(/^(No matches|0)/)
  expect(problems).toEqual([])
})

test('a Mermaid diagram draws in the page\'s colours, and redraws with the theme', async ({ page }) => {
  const problems = await open(page, `# Diagrams\n\n${flow}\n\n${seq}\n\n\`\`\`mermaid\nnot a diagram at all\n\`\`\``)
  await page.evaluate(async () => { const d = (window as any).leading.view.diagrams; for (let i = 0; i < 20; i++) { await d.settled; await new Promise((r) => setTimeout(r, 100)) } })
  expect(await page.locator('#doc figure.diagram.drawn svg').count()).toBe(2)
  await expect(page.locator('#doc figure.diagram .diagram-error')).toHaveCount(1)
  // Fits the column.
  const fit = await page.evaluate(() => { const f = document.querySelector('#doc figure.diagram svg')!; return f.getBoundingClientRect().width <= document.getElementById('doc')!.getBoundingClientRect().width + 1 })
  expect(fit).toBe(true)
  const fill = () => page.evaluate(() => getComputedStyle(document.querySelector('#doc figure.diagram svg .node rect, #doc figure.diagram svg .node polygon')!).fill)
  const light = await fill()
  await page.evaluate(() => (window as any).leading.settings({ settings: { theme: 'dark' } }))
  await page.evaluate(async () => { const d = (window as any).leading.view.diagrams; for (let i = 0; i < 10; i++) { await d.settled; await new Promise((r) => setTimeout(r, 100)) } })
  expect(await fill()).not.toBe(light)
  expect(problems).toEqual([])
})

test('a diagram drawn above the window does not move the line being read', async ({ page }) => {
  const filler = Array(60).fill('A paragraph of filler to put distance between things.').join('\n\n')
  await open(page, `${flow}\n\n${filler}\n\n## Here\n\n${filler}`)
  // Jump past the diagram before Mermaid has finished, then let it draw.
  const before = await page.evaluate(() => {
    const h = document.getElementById('here')!; const s = document.getElementById('scroller')!
    s.scrollTop = h.offsetTop - 100
    return h.getBoundingClientRect().top
  })
  await page.evaluate(async () => { const d = (window as any).leading.view.diagrams; for (let i = 0; i < 20; i++) { await d.settled; await new Promise((r) => setTimeout(r, 100)) } })
  expect(await page.locator('#doc figure.diagram.drawn').count()).toBe(1)
  const after = await page.evaluate(() => document.getElementById('here')!.getBoundingClientRect().top)
  expect(Math.abs(after - before)).toBeLessThan(2)
})

test('highlighting beside a formula, or across one, writes the right source', async ({ page }) => {
  await open(page, 'Energy $E=mc^2$ here now.')
  const select = (from: string, to: string) => page.evaluate(([from, to]) => {
    const texts: Text[] = []
    const w = document.createTreeWalker(document.getElementById('doc')!, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) texts.push(w.currentNode as Text)
    const a = texts.find((t) => t.data.includes(from))!, z = texts.find((t) => t.data.includes(to))!
    const r = document.createRange()
    r.setStart(a, a.data.indexOf(from)); r.setEnd(z, z.data.indexOf(to) + to.length)
    getSelection()!.removeAllRanges(); getSelection()!.addRange(r)
  }, [from, to])
  await select('here', 'here')
  await page.evaluate(() => (window as any).leading.command({ name: 'highlightYellow' }))
  await expect.poll(() => page.evaluate(() => (window as any).leading.view.text)).toBe('Energy $E=mc^2$ ==here== now.')
  // A selection that starts before the formula takes the formula whole.
  await page.evaluate(() => (window as any).leading.command({ name: 'undo' }))
  await select('Energy', 'here')
  await page.evaluate(() => (window as any).leading.command({ name: 'highlightYellow' }))
  await expect.poll(() => page.evaluate(() => (window as any).leading.view.text)).toBe('==Energy $E=mc^2$ here== now.')
  expect(await page.locator('#doc mark .math .katex').count()).toBe(1)
})

test('every math and diagram example in the Leading Guide renders', async ({ page }) => {
  // The guide teaches by example, so a broken example is a broken lesson.
  const guide = readFileSync(new URL('../../../mac/Resources/Leading Guide.md', import.meta.url), 'utf8')
  const problems = await open(page, guide)
  const figures = await page.locator('#doc figure.diagram').count()
  expect(figures).toBeGreaterThanOrEqual(9)
  // Diagrams may draw only near the window, so walk the page down while they settle.
  await page.evaluate(async () => {
    const s = document.getElementById('scroller')!; const d = (window as any).leading.view.diagrams
    for (let y = 0; y <= s.scrollHeight; y += s.clientHeight / 2) {
      s.scrollTop = y
      await d.settled; await new Promise((r) => setTimeout(r, 50))
    }
    for (let i = 0; i < 20; i++) { await d.settled; await new Promise((r) => setTimeout(r, 100)) }
  })
  const errors = await page.locator('#doc figure.diagram .diagram-error').allTextContents()
  expect(errors).toEqual([])
  expect(await page.locator('#doc figure.diagram.drawn svg').count()).toBe(figures)
  // KaTeX, run with throwOnError off, marks a formula it cannot read with .katex-error.
  expect(await page.locator('#doc .katex-error').allTextContents()).toEqual([])
  expect(await page.locator('#doc .math .katex').count()).toBeGreaterThanOrEqual(30)
  expect(problems).toEqual([])
})
