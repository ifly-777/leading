import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'

// Speed on the 5 MB stress file, in WebKit. Prints the numbers and fails if
// the Stage 1 gate (everything parsed within 3 s) or the search target is missed.
test('5 MB stress file: open and search', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/prototype.html')
  await page.waitForFunction(() => (window as any).leading && document.querySelector('#doc h1'))
  const t = await page.evaluate(async () => {
    const L = (window as any).leading
    await L.openFixture('stress-5mb.md')
    await new Promise((r) => setTimeout(r, 1500)) // let the idle warm-up run, as a reader would
    return L.timings()
  })
  // Typing "leading" one key at a time, then a single common letter.
  const search = await page.evaluate(async () => {
    const f = (window as any).leading.find
    f.open()
    const input = document.querySelector('.findbar input') as HTMLInputElement
    const times: Record<string, number> = {}
    for (const q of ['l', 'le', 'lea', 'lead', 'leadi', 'leadin', 'leading', 'e', 'cafe', "it's"]) {
      input.value = q
      const t0 = performance.now()
      input.dispatchEvent(new Event('input'))
      times[q] = Math.round(performance.now() - t0)
      times[q + ' (match only)'] = Math.round(f.lastSearchMs)
    }
    return { times, count: document.querySelector('.findbar .count')!.textContent }
  })
  const report = { open: t, search }
  console.log(JSON.stringify(report, null, 2))
  if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(report, null, 2))
  expect(t.parsed).toBeLessThan(3000)
  // Every keystroke, including very common letters, within 100 ms.
  for (const [q, ms] of Object.entries(search.times)) if (!q.includes('(')) expect(ms, q).toBeLessThan(100)
})
