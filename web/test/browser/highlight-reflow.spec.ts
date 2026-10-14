import { test, expect, type Page } from '@playwright/test'

// Adding a highlight must not move any text: every line of the paragraph has
// to break exactly where it did before. WebKit drops `text-wrap: pretty` for a
// whole paragraph as soon as it holds an inline box with
// `box-decoration-break: clone`, so a cloned marker reflowed the paragraph.

async function openApp(page: Page, text: string) {
  await page.addInitScript(() => {
    ;(window as any).webkit = { messageHandlers: { leading: { postMessage: (m: any) => { if (m?.type === 'ready') (window as any).__ready = true } } } }
  })
  await page.setViewportSize({ width: 1100, height: 850 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).__ready)
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, text)
  await page.evaluate(() => document.fonts.ready)
}

const PARAS = [
  'Long-term meditators describe attention as a muscle that tires and recovers; the difficulty is that the effort to sustain it is itself a distraction, and the practitioner who strains after stillness finds only the straining. Traditions differ in how they handle this paradox, but most of them converge on an instruction that sounds deceptively simple: notice, release, and return, without commentary or self-reproach, as often as necessary, for as long as it takes.',
  'The aircraft was established on the localiser with the autothrottle engaged, but the glideslope capture was delayed because the controller had vectored the crew inside the final approach fix at a higher altitude than published. Configuration was therefore late, and the stabilisation criteria at one thousand feet were met only marginally; the commander elected to continue, reasoning that the energy state was recoverable, which in retrospect was optimistic.',
  'Typographers have long argued about whether justified text improves or degrades readability. The evidence is mixed: rivers of white space damage the texture of a page, yet ragged margins can look unfinished in formal documents. Hyphenation mitigates the problem considerably, especially in narrow columns, though excessive hyphenation introduces its own distractions, particularly when consecutive lines end with hyphens or when proper names are broken awkwardly.',
]

// Spans to highlight, as [first, last] word numbers: one word, the first word,
// the last word, a few words, and runs long enough to cross several lines.
// Each starts and ends at a space. A boundary inside a word is a different
// matter: WebKit shapes the two halves apart, losing kerning and ligatures
// across the cut, so the word itself changes width (see the test below and
// docs/decisions.md).
const SPANS: [number, number][] = [[5, 5], [0, 2], [-1, -1], [16, 21], [3, 40], [30, 31], [44, 60]]

function words(p: string): [number, number][] {
  return [...p.matchAll(/\S+/g)].map((m) => [m.index!, m.index! + m[0].length])
}

/** Each paragraph unmarked, then once per span with that span highlighted. */
function source(): string {
  const out: string[] = []
  for (const p of PARAS) {
    out.push(p)
    const w = words(p)
    for (const [i, j] of SPANS) {
      const a = w.at(i)![0], b = w.at(j)![1]
      out.push(p.slice(0, a) + '<mark>' + p.slice(a, b) + '</mark>' + p.slice(b))
    }
  }
  return out.join('\n\n') + '\n'
}

test('a highlight never changes where lines break', async ({ page }) => {
  await openApp(page, source())
  const per = SPANS.length + 1
  expect(await page.locator('#doc p').count()).toBe(PARAS.length * per)
  expect(await page.locator('#doc mark.hl').count()).toBe(PARAS.length * SPANS.length)

  const failures = await page.evaluate(({ per }) => {
    const root = document.documentElement
    const ps = [...document.querySelectorAll<HTMLElement>('#doc p')]
    // The line each visible character sits on, by the top of its own box. Line
    // numbers rather than raw tops, so only a change of break counts.
    const lines = (p: HTMLElement) => {
      const tops: number[] = []
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      const r = document.createRange()
      while (w.nextNode()) {
        const t = w.currentNode as Text
        for (let i = 0; i < t.data.length; i++) {
          if (/\s/.test(t.data[i])) continue
          r.setStart(t, i); r.setEnd(t, i + 1)
          tops.push(Math.round(r.getClientRects()[0]?.top ?? NaN))
        }
      }
      const rows = [...new Set(tops)].sort((a, b) => a - b)
      return tops.map((t) => rows.indexOf(t)).join(',')
    }
    const out: string[] = []
    for (const style of ['marker', 'lowlight', 'underline']) for (const align of ['left', 'justify']) {
      root.dataset.hlStyle = style
      root.dataset.align = align
      for (let w = 420; w <= 640; w += 4) {
        for (const p of ps) { p.style.width = w + 'px'; p.style.maxWidth = 'none' }
        for (let i = 0; i < ps.length; i += per) {
          const base = lines(ps[i])
          for (let k = 1; k < per; k++) if (lines(ps[i + k]) !== base) out.push(`${style}/${align}/${w}px: paragraph ${i / per}, span ${k - 1}`)
        }
      }
    }
    return out
  }, { per })
  expect(failures).toEqual([])
})

test('an element boundary at a space leaves every glyph where it was', async ({ page }) => {
  // The guarantee above rests on this: WebKit shapes text on either side of an
  // inline element separately, which is harmless only where a space separates them.
  // That is a property of the engine Leading ships on, macOS WebKit (CoreText).
  // WebKit on Linux shapes with HarfBuzz and moves "office" when it is marked
  // (since this test was added, on every CI run), so the check runs on macOS only.
  test.skip(process.platform !== 'darwin', 'glyph shaping at element boundaries is specific to macOS WebKit, the engine Leading ships on')
  const sample = 'Wave AVATAR office affirm first To. Typographers controller'
  await openApp(page, sample + '\n')
  const moved = await page.evaluate((sample) => {
    const p = document.querySelector<HTMLElement>('#doc p')!
    // Where each character starts. Not the box around the run: the marker's fill
    // overhangs the text. Not right edges either: WebKit reports the last glyph of
    // a run a little narrower, though nothing after it moves.
    const xs = () => {
      const out: number[] = []
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      const r = document.createRange()
      while (w.nextNode()) {
        const t = w.currentNode as Text
        for (let i = 0; i < t.data.length; i++) { r.setStart(t, i); r.setEnd(t, i + 1); out.push(r.getBoundingClientRect().left) }
      }
      return out
    }
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 0.01)
    p.textContent = sample
    const base = xs()
    const out: string[] = []
    for (const m of sample.matchAll(/\S+/g)) {
      const a = m.index!, b = a + m[0].length
      const mark = document.createElement('mark')
      mark.className = 'hl'; mark.dataset.c = 'yellow'
      mark.textContent = sample.slice(a, b)
      p.replaceChildren(sample.slice(0, a), mark, sample.slice(b))
      for (const style of ['marker', 'lowlight', 'underline']) {
        document.documentElement.dataset.hlStyle = style
        if (!same(xs(), base)) out.push(`${style}: ${m[0]}`)
      }
    }
    return out
  }, sample)
  expect(moved).toEqual([])
})
