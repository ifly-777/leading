import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 }) // narrow enough that the weather table scrolls
  await page.goto('/prototype.html')
  await page.waitForFunction(() => (window as any).leading && document.querySelector('#doc h1'))
  await page.keyboard.press('Backslash')
  await page.evaluate(() => (window as any).leading.openFixture('tables.md'))
})

test('a sideways-scrolling table gets a floating header that tracks it', async ({ page }) => {
  const wide = page.locator('.table-scroll.scrolls').first()
  await expect(wide).toHaveCount(1)
  // Scroll so the table's own header is above the window but its rows are on screen.
  await page.evaluate(() => {
    const sc = document.getElementById('scroller')!
    const t = document.querySelector('.table-scroll.scrolls') as HTMLElement
    sc.scrollTop += t.getBoundingClientRect().top - sc.getBoundingClientRect().top + 90
    t.scrollLeft = 120
  })
  await page.waitForTimeout(150)
  const fh = page.locator('.float-head')
  await expect(fh).toBeVisible()
  const sync = await page.evaluate(() => ({
    float: (document.querySelector('.float-head .table-scroll') as HTMLElement).scrollLeft,
    table: (document.querySelector('.doc .table-scroll.scrolls') as HTMLElement).scrollLeft,
    labels: [...document.querySelectorAll('.float-head th')].map((th) => th.textContent).slice(0, 3),
  }))
  expect(sync.float).toBe(sync.table)
  expect(sync.labels).toEqual(['Station', 'Wind', 'Visibility'])
  // Back above the table: the floating header goes away.
  await page.evaluate(() => { document.getElementById('scroller')!.scrollTop = 0 })
  await page.waitForTimeout(150)
  await expect(fh).toBeHidden()
})

test('double-click opens the focus view; Esc closes it; CSV is correct', async ({ page }) => {
  await page.locator('.doc table').first().dblclick()
  await expect(page.locator('.table-focus')).toBeVisible()
  const csv = await page.evaluate(async () => {
    // Served by Vite at run time; the path is not resolvable by the type checker.
    const { tableToCSV } = await import(/* @vite-ignore */ '/src/reader/tables.ts' as string)
    return tableToCSV(document.querySelectorAll('.doc table')[3] as HTMLTableElement)
  })
  // The inline-formatting table: escaped pipe stays in one field, empties stay empty.
  expect(csv.split('\n')[0]).toBe('Feature,Example,Notes')
  expect(csv).toContain('Escaped pipe,a | b,"One cell, not two"')
  expect(csv).toContain('Empty,,Left blank')
  await page.keyboard.press('Escape')
  await expect(page.locator('.table-focus')).toHaveCount(0)
})
