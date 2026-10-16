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

/** Paragraphs whose line breaks differ from the unmarked paragraph before them, every `per` paragraphs. */
async function breakFailures(page: Page, per: number): Promise<string[]> {
  return page.evaluate(({ per }) => {
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
}

test('a highlight never changes where lines break', async ({ page }) => {
  await openApp(page, source())
  const per = SPANS.length + 1
  expect(await page.locator('#doc p').count()).toBe(PARAS.length * per)
  expect(await page.locator('#doc mark.hl').count()).toBe(PARAS.length * SPANS.length)
  expect(await breakFailures(page, per)).toEqual([])
})

// Sloppy drags: each starts a few letters into one word and ends a few letters
// short of the end of another, as [first word, letters in, last word, letters
// short]. One lies within a single word.
const DRAGS: [number, number, number, number][] = [[6, 2, 6, 2], [0, 1, 2, 1], [16, 3, 21, 2], [3, 2, 40, 3], [30, 1, 31, 1], [44, 2, 60, 2]]

/** A drag's character offsets in the paragraph: always inside words, never at a space. */
function dragOffsets(p: string, [i, di, j, dj]: [number, number, number, number]): [number, number] {
  const w = words(p)
  const [a0, a1] = w.at(i)!, [b0, b1] = w.at(j)!
  return [a0 + Math.min(di, a1 - a0 - 1), b1 - Math.min(dj, b1 - b0 - 1)]
}

test('a highlight dragged from inside a word is widened to the word, and moves no line break', async ({ page }) => {
  const per = DRAGS.length + 1

  // Before: the same drags marked exactly where they fall, edges inside words.
  const raw: string[] = []
  for (const p of PARAS) {
    raw.push(p)
    for (const d of DRAGS) { const [a, b] = dragOffsets(p, d); raw.push(p.slice(0, a) + '<mark>' + p.slice(a, b) + '</mark>' + p.slice(b)) }
  }
  await openApp(page, raw.join('\n\n') + '\n')
  const before = await breakFailures(page, per)
  const cases = PARAS.length * DRAGS.length * 56 * 2 // per style: 56 widths, ragged and justified
  const perStyle = (f: string[], s: string) => f.filter((x) => x.startsWith(s + '/')).length
  const report = (f: string[]) => ['marker', 'lowlight', 'underline'].map((s) => `${s} ${perStyle(f, s)}/${cases}`).join(', ')
  test.info().annotations.push({ type: 'mid-word edges, unsnapped', description: report(before) })

  // After: the reader drags across each copy, and highlights it as the app does.
  const copies: string[] = []
  for (const p of PARAS) for (let k = 0; k < per; k++) copies.push(p)
  await openApp(page, copies.join('\n\n') + '\n')
  for (let i = 0; i < PARAS.length; i++) {
    for (let k = 0; k < DRAGS.length; k++) {
      const [a, b] = dragOffsets(PARAS[i], DRAGS[k])
      await page.evaluate(async ({ n, a, b }) => {
        // The paragraph is one run of text; find it fresh, since highlighting redraws its block.
        const p = document.querySelectorAll<HTMLElement>('#doc p')[n]
        const t = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode() as Text
        const r = document.createRange()
        r.setStart(t, a); r.setEnd(t, b)
        await (window as any).leading.view.highlightInReader('yellow', false, { kind: 'selection', range: r })
      }, { n: i * per + k + 1, a, b })
    }
  }
  expect(await page.locator('#doc mark.hl').count()).toBe(PARAS.length * DRAGS.length)
  // Every highlight now begins and ends at a space (or the paragraph's edge),
  // and covers at least what was dragged.
  const edges = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#doc mark.hl')].map((m) => {
    const p = m.closest('p')!
    const r = document.createRange()
    r.setStart(p, 0); r.setEndBefore(m)
    const pre = r.toString()
    r.setStartAfter(m); r.setEndAfter(p.lastChild!)
    const post = r.toString()
    return { ok: (pre === '' || /\s$/.test(pre)) && (post === '' || /^\s/.test(post)), text: m.textContent }
  }))
  expect(edges.filter((e) => !e.ok)).toEqual([])
  const after = await breakFailures(page, per)
  test.info().annotations.push({ type: 'mid-word edges, snapped', description: report(after) })
  console.log(`line breaks moved, unsnapped: ${report(before)}; snapped: ${report(after)}`)
  expect(after).toEqual([])
  // The unsnapped case is what made snapping worth doing; on macOS it shows.
  if (process.platform === 'darwin') expect(before.length).toBeGreaterThan(0)
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
