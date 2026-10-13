import { test, expect, type Page } from '@playwright/test'

// Highlighting while reading, driven with the mouse the way a reader would,
// checking the text Swift would save (rebuilt from the page's edit messages).

async function openApp(page: Page, text: string) {
  await page.addInitScript(() => {
    ;(window as any).__msgs = []
    ;(window as any).webkit = { messageHandlers: { leading: { postMessage: (m: unknown) => (window as any).__msgs.push(JSON.parse(JSON.stringify(m))) } } }
  })
  await page.setViewportSize({ width: 1100, height: 850 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).__msgs.some((m: any) => m.type === 'ready'))
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, text)
}

const cmd = (page: Page, name: string) => page.evaluate((n) => (window as any).leading.command({ name: n }), name)

/** Replay every "edit" message onto the original text, as Swift's mirror does. */
async function mirror(page: Page, original: string): Promise<string> {
  const msgs = await page.evaluate(() => (window as any).__msgs.filter((m: any) => m.type === 'edit'))
  let doc = original
  for (const m of msgs) for (const e of [...m.edits].sort((a: any, b: any) => b.from - a.from)) doc = doc.slice(0, e.from) + e.insert + doc.slice(e.to)
  return doc
}

/** Screen position of the n-th occurrence of `text` on the page (start, or just past its end). */
async function at(page: Page, text: string, end = false, nth = 0): Promise<{ x: number; y: number }> {
  return page.evaluate(({ text, end, nth }) => {
    const w = document.createTreeWalker(document.getElementById('doc')!, NodeFilter.SHOW_TEXT)
    let seen = 0
    while (w.nextNode()) {
      const t = w.currentNode as Text
      let i = t.data.indexOf(text)
      while (i >= 0) {
        if (seen++ === nth) {
          const r = document.createRange()
          const k = end ? i + text.length - 1 : i
          r.setStart(t, k); r.setEnd(t, k + 1)
          const b = r.getBoundingClientRect()
          return { x: end ? b.right - 1 : b.left + 1, y: b.top + b.height / 2 }
        }
        i = t.data.indexOf(text, i + 1)
      }
    }
    throw new Error('not on page: ' + text)
  }, { text, end, nth })
}

/** Drag-select from the start of `a` to the end of `b`. */
async function select(page: Page, a: string, b: string, nth = 0) {
  const p = await at(page, a, false, nth)
  const q = await at(page, b, true, nth)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 })
  await page.mouse.move(q.x, q.y, { steps: 4 })
  await page.mouse.up()
}

const palette = (page: Page) => page.locator('.hl-palette')

test('select across bold and a link, pick a colour, undo', async ({ page }) => {
  const src = 'A **bold** idea and [a link](https://example.com) here.\n\nSecond “quoted” paragraph.\n'
  await openApp(page, src)
  await select(page, 'old', 'a li')
  await expect(palette(page)).toBeVisible()
  await expect(palette(page).locator('.hl-remove')).toBeHidden() // nothing to remove yet
  await palette(page).locator('.hl-dot[data-c="green"]').dispatchEvent('mousedown')
  const G = '<mark style="background: #BBFABBA6;">'
  await expect.poll(() => mirror(page, src)).toBe(`A **b${G}old</mark>** ${G}idea and</mark> [${G}a li</mark>nk](https://example.com) here.\n\nSecond “quoted” paragraph.\n`)
  await expect(page.locator('#doc mark.hl[data-c="green"]')).toHaveCount(3)
  await expect(palette(page)).toBeHidden()
  // The palette remembers green for ⇧⌘H.
  expect(await page.evaluate(() => (window as any).leading.view.settings.lastHighlight)).toBe('green')
  // Undo while reading takes it off again.
  await cmd(page, 'undo')
  await expect.poll(() => mirror(page, src)).toBe(src)
  await expect(page.locator('#doc mark.hl')).toHaveCount(0)
})

test('click a highlight to change its colour or remove it', async ({ page }) => {
  const src = 'Some ==marked words== in a line.\n'
  await openApp(page, src)
  const p = await at(page, 'marked')
  await page.mouse.click(p.x + 8, p.y)
  await expect(palette(page)).toBeVisible()
  await expect(palette(page).locator('.hl-dot[data-c="yellow"]')).toHaveAttribute('aria-pressed', 'true')
  await palette(page).locator('.hl-dot[data-c="pink"]').dispatchEvent('mousedown')
  await expect.poll(() => mirror(page, src)).toBe('Some <mark style="background: #FFB8EBA6;">marked words</mark> in a line.\n')
  const q = await at(page, 'words')
  await page.mouse.click(q.x + 8, q.y)
  await palette(page).locator('.hl-remove').dispatchEvent('mousedown')
  await expect.poll(() => mirror(page, src)).toBe('Some marked words in a line.\n')
})

test('Find, then ⇧⌘H highlights each match in turn', async ({ page }) => {
  const src = 'The cafe opens. A café is not a cafeteria.\n\nCafe society.\n'
  await openApp(page, src)
  await cmd(page, 'find')
  await page.keyboard.type('cafe')
  await page.waitForTimeout(100)
  await cmd(page, 'highlight')
  await cmd(page, 'highlight')
  await cmd(page, 'highlight')
  await expect.poll(() => mirror(page, src)).toBe('The ==cafe== opens. A ==café== is not a ==cafe==teria.\n\nCafe society.\n')
})

test('only the changed block is re-rendered, and later offsets stay right', async ({ page }) => {
  const paras = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} has some words in it, and *more* words after.`)
  const src = paras.join('\n\n') + '\n'
  await openApp(page, src)
  // Tag a later block; a full re-render would replace it.
  await page.evaluate(() => { (document.querySelector('#doc [data-b="30"]') as any).__kept = true })
  await select(page, 'some', 'some words', 3)
  await palette(page).locator('.hl-dot[data-c="yellow"]').dispatchEvent('mousedown')
  await expect.poll(() => page.locator('#doc mark.hl').count()).toBe(1)
  expect(await page.evaluate(() => (document.querySelector('#doc [data-b="30"]') as any).__kept)).toBe(true)
  // A second highlight further down uses offsets written before the first one moved them.
  await page.locator('#doc [data-b="30"]').scrollIntoViewIfNeeded()
  await select(page, 'more', 'more', 30)
  await palette(page).locator('.hl-dot[data-c="yellow"]').dispatchEvent('mousedown')
  const want = paras.map((p, i) => i === 3 ? p.replace('some words', '==some words==') : i === 30 ? p.replace('*more*', '==*more*==') : p).join('\n\n') + '\n'
  await expect.poll(() => mirror(page, src)).toBe(want)
})

test('a long sectioned page highlights deep inside', async ({ page }) => {
  const paras = Array.from({ length: 4000 }, (_, i) => `## Part ${i}\n\nLine ${i}: the quick brown fox jumps over the lazy dog, again and again.`)
  const src = paras.join('\n\n') + '\n'
  await openApp(page, src)
  await page.waitForFunction(() => (window as any).leading.view.reader.complete)
  const b = await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('#doc [data-b]')].find((e) => e.textContent!.startsWith('Line 3000:'))!
    el.scrollIntoView({ block: 'center' })
    return Number(el.dataset.b)
  })
  await page.waitForTimeout(200)
  const nth = 3000 // the 3001st "quick" on the page
  await select(page, 'quick', 'fox', nth)
  await palette(page).locator('.hl-dot[data-c="blue"]').dispatchEvent('mousedown')
  const want = src.replace('Line 3000: the quick brown fox', 'Line 3000: the <mark style="background: #ADCCFFA6;">quick brown fox</mark>')
  await expect.poll(() => mirror(page, src)).toBe(want)
  expect(b).toBeGreaterThan(0)
})

test('edit mode: shortcut colours, toggling, and colours shown in the source', async ({ page }) => {
  const src = 'Alpha beta gamma.\n'
  await openApp(page, src)
  await cmd(page, 'toggleEdit')
  await expect(page.locator('#editor .cm-content')).toBeVisible()
  // Put the cursor in "beta": no selection highlights the word.
  await page.evaluate(() => { const v = (window as any).leading.view.editor.view; v.dispatch({ selection: { anchor: 8 } }) })
  await cmd(page, 'highlightOrange')
  await expect.poll(() => page.evaluate(() => (window as any).leading.text())).toBe('Alpha <mark style="background: #FFB86CA6;">beta</mark> gamma.\n')
  await expect(page.locator('#editor .cm-hl[data-c="orange"]')).toHaveCount(1)
  // The same colour again, with the cursor inside, takes it off.
  await page.evaluate(() => { const v = (window as any).leading.view.editor.view; v.dispatch({ selection: { anchor: 45 } }) })
  await cmd(page, 'highlightOrange')
  await expect.poll(() => page.evaluate(() => (window as any).leading.text())).toBe(src)
  await expect.poll(() => mirror(page, src)).toBe(src)
})
