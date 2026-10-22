import { test, expect, type Page } from '@playwright/test'

// The page as the app runs it, with every message to Swift captured.
async function open(page: Page, text: string): Promise<any[]> {
  const sent: any[] = []
  await page.exposeFunction('capture', (m: any) => { sent.push(m) })
  await page.addInitScript(() => { ;(window as any).webkit = { messageHandlers: { leading: { postMessage: (m: any) => (window as any).capture(m) } } } })
  await page.setViewportSize({ width: 1300, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, text)
  return sent
}
const text = (page: Page) => page.evaluate(() => (window as any).leading.view.text as string)

test('a note on a highlight: written from the palette, shown, changed, removed, and gone with its highlight', async ({ page }) => {
  await open(page, 'Opening ==first idea== here, and ==a second== too.')
  const mark = page.locator('#doc mark.hl').first()
  // Click the highlight: the palette offers a note.
  await mark.click()
  await expect(page.locator('.hl-palette .hl-note-btn')).toBeVisible()
  await page.locator('.hl-palette .hl-note-btn').dispatchEvent('mousedown')
  const input = page.locator('.hl-note .hl-note-input')
  await expect(input).toBeFocused()
  await input.fill('Thoreau, again\non simplicity')
  await input.press('Enter')
  await expect.poll(() => text(page)).toBe('Opening ==first idea==%%Thoreau, again on simplicity%% here, and ==a second== too.')
  await expect(mark).toHaveAttribute('data-note', 'Thoreau, again on simplicity')
  // Nothing moved: the text reads as before.
  await expect(page.locator('#doc p')).toHaveText('Opening first idea here, and a second too.')
  // Clicking it again shows the note; the margin lists it.
  await page.locator('#doc mark.hl').first().click()
  await expect(page.locator('.hl-note .hl-note-text')).toHaveText('Thoreau, again on simplicity')
  await page.evaluate(() => (window as any).leading.command({ name: 'showHighlights' }))
  await expect(page.locator('#outline .hl-item-note')).toHaveText(['Thoreau, again on simplicity'])
  // Change it, through the card.
  await page.locator('#doc mark.hl').first().click()
  await page.locator('.hl-note .hl-note-text').click()
  await input.fill('Changed')
  await input.press('Enter')
  await expect.poll(() => text(page)).toBe('Opening ==first idea==%%Changed%% here, and ==a second== too.')
  // ⌘Z undoes it, as it undoes a highlight.
  await page.evaluate(() => (window as any).leading.command({ name: 'undo' }))
  await expect.poll(() => text(page)).toContain('%%Thoreau, again on simplicity%%')
  // Removing the highlight takes the note with it.
  await page.locator('#doc mark.hl').first().click()
  await page.locator('.hl-palette .hl-remove').dispatchEvent('mousedown')
  await expect.poll(() => text(page)).toBe('Opening first idea here, and ==a second== too.')
})

test('comments are hidden while reading, block links jump and flash, tags are quiet', async ({ page }) => {
  const filler = Array(40).fill('Filler paragraph to push things down the page.').join('\n\n')
  await open(page, `# Note\n\nSee [[#^far|the far block]]. #reading\n\n%%\nA private aside\n\nover two paragraphs\n%%\n\n${filler}\n\nThe far block. ^far\n`)
  await expect(page.locator('#doc')).not.toContainText('private aside')
  await expect(page.locator('#doc .tag')).toHaveText(['#reading'])
  await page.locator('#doc .wikilink').click()
  const far = page.locator('#doc [id="^far"]')
  await expect(far).toHaveClass(/block-target/)
  const top = await far.evaluate((el) => el.getBoundingClientRect().top)
  expect(top).toBeGreaterThan(100)
  expect(top).toBeLessThan(500)
  await expect(far).toHaveText('The far block.')
})

test('a picture or diagram is enlarged on a click, and Escape puts it back', async ({ page }) => {
  await open(page, 'Text.\n\n![a figure](data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>)')
  // Images from the file need the app; draw one by hand for the test.
  await page.evaluate(() => {
    const img = document.createElement('img')
    img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="red"/></svg>')
    img.alt = 'A red box'
    document.querySelector('#doc p')!.append(img)
  })
  await page.waitForFunction(() => (document.querySelector('#doc img') as HTMLImageElement).naturalWidth > 0)
  await page.locator('#doc img').click()
  await expect(page.locator('.lightbox')).toBeVisible()
  await expect(page.locator('.lightbox-caption')).toHaveText('A red box')
  await page.keyboard.press('Escape')
  await expect(page.locator('.lightbox')).toBeHidden()
})

test('the Links tab asks the app, lists what it sends, and opens a note', async ({ page }) => {
  const sent = await open(page, '# A note\n\nText.')
  await page.evaluate(() => (window as any).leading.command({ name: 'showLinks' }))
  await expect(page.locator('#outline')).toHaveAttribute('data-tab', 'links')
  await expect.poll(() => sent.some((m) => m.type === 'backlinks')).toBe(true)
  await page.evaluate(() => (window as any).leading.backlinks({ saved: true, items: [{ name: 'Walden notes', href: 'file:///v/Walden%20notes.md', lines: ['Reading A note again'] }] }))
  await expect(page.locator('#outline .link-item')).toHaveText(['Walden notes'])
  await expect(page.locator('#outline .link-line')).toHaveText(['Reading A note again'])
  await page.locator('#outline .link-item').click()
  expect(sent.at(-1)).toEqual({ type: 'openLink', href: 'file:///v/Walden%20notes.md' })
})

test('Read Aloud hands over passages from the top, marks each word, and stops', async ({ page }) => {
  const sent = await open(page, '# Title\n\nFirst   paragraph here.\n\n- an item\n\n```\ncode is not read\n```\n\nLast $x^2$ one.')
  await page.evaluate(() => (window as any).leading.command({ name: 'readAloud' }))
  const speak = await expect.poll(() => sent.find((m) => m.type === 'speak')).toBeTruthy().then(() => sent.find((m) => m.type === 'speak'))
  expect(speak.passages).toEqual(['Title', 'First paragraph here.', 'an item', 'Last one.'])
  // The app reports "paragraph" (folded offsets): the page marks those letters.
  await page.evaluate(() => (window as any).leading.speechWord({ seg: 1, loc: 6, len: 9 }))
  const marked = await page.evaluate(() => {
    const h = (CSS as any).highlights?.get('read-aloud')
    return h ? [...h][0].toString() : null
  })
  if (marked !== null) expect(marked).toBe('paragraph')
  await page.evaluate(() => (window as any).leading.command({ name: 'readAloud' }))
  expect(sent.at(-1)).toEqual({ type: 'stopSpeaking' })
})

test('Look Up reports the selected words and where they sit', async ({ page }) => {
  await open(page, 'A serendipitous find.')
  await page.evaluate(() => {
    const t = document.querySelector('#doc p span')!.firstChild as Text
    const r = document.createRange(); r.setStart(t, 2); r.setEnd(t, 15)
    getSelection()!.removeAllRanges(); getSelection()!.addRange(r)
  })
  const t = await page.evaluate(() => (window as any).leading.lookUpTarget())
  expect(t.text).toBe('serendipitous')
  expect(t.size).toBeGreaterThan(10)
  expect(t.x).toBeGreaterThan(0)
})

test('notes already in a file are read on opening, short or long, and a comment across the opening slice stays hidden', async ({ page }) => {
  await open(page, 'A ==marked==%%kept note%% word.')
  await expect(page.locator('#doc mark.hl')).toHaveAttribute('data-note', 'kept note')
  // Long enough to be painted in a slice and parsed in pieces, with a comment spanning where the slice ends.
  const para = 'Filler paragraph with enough words in it to take up some room on the page. '.repeat(3)
  const long = ['# Long', ...Array(150).fill(para), '%%', '# Hidden heading', ...Array(150).fill(para), '%%', '## After', ...Array(400).fill(para), 'End ==mark==%%far note%%.'].join('\n\n')
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null }) }, long)
  await expect(page.locator('#doc mark.hl')).toHaveAttribute('data-note', 'far note')
  await expect(page.locator('#doc')).not.toContainText('Hidden heading')
  await expect(page.locator('#doc h2')).toHaveText(['After'])
})

test('Search Vault: asks the app, marks the words, moves by keyboard, and opens a result at its match', async ({ page }) => {
  const doc = '# Notes\n\nFirst paragraph.\n\nThe café on the corner, and another café.\n\nLast paragraph mentions a cafe once more.'
  const sent = await open(page, doc)
  await page.evaluate(() => (window as any).leading.command({ name: 'searchVault' }))
  await expect(page.locator('#outline')).toHaveAttribute('data-tab', 'search')
  const input = page.locator('#outline .search-side input')
  await expect(input).toBeFocused()
  await input.fill('cafe')
  await expect.poll(() => sent.filter((m) => m.type === 'vaultSearch').at(-1)?.query).toBe('cafe')
  const id = sent.filter((m) => m.type === 'vaultSearch').at(-1).id
  // An answer to older words is ignored.
  await page.evaluate((id) => (window as any).leading.searchResults({ id: id - 1, items: [{ name: 'Stale', href: 'file:///v/Stale.md', count: 1, lines: [] }], notes: 1, total: 1, state: 'ok' }), id)
  await expect(page.locator('#outline .search-side li')).toHaveCount(0)
  const last = doc.indexOf('Last')
  await page.evaluate(([id, last]) => (window as any).leading.searchResults({ id, notes: 2, total: 4, state: 'ok', items: [
    { name: 'This note', href: 'file:///v/This%20note.md', count: 3, lines: [{ text: 'Last paragraph mentions a cafe once more.', s: last }] },
    { name: 'Other', href: 'file:///v/Other.md', count: 1, lines: [{ text: 'A Café', s: 0 }] },
  ] }), [id, last])
  await expect(page.locator('#outline .search-side .links-status')).toHaveText('4 matches in 2 notes')
  // The words are marked as Find matches them, accents and case ignored.
  await expect(page.locator('#outline .search-side .search-hit')).toHaveText(['cafe', 'Café'])
  // ↓ from the field walks the results; Return opens one at its line, with the words.
  await input.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('#outline .search-side a.link-line').first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => sent.find((m) => m.type === 'openAt')).toEqual({ type: 'openAt', href: 'file:///v/This%20note.md', query: 'cafe', s: last })
  // The app hands the note back to findAt: Find opens on the words, at the match in that line (the third).
  await page.evaluate((s) => (window as any).leading.findAt({ query: 'cafe', s }), last)
  await expect(page.locator('.findbar .count')).toHaveText('3 of 3')
  // The app's other answers: the vault still being read, and a note with no folder.
  await page.evaluate((id) => (window as any).leading.searchResults({ id, items: [], notes: 0, total: 0, state: 'indexing' }), id)
  await expect(page.locator('#outline .search-side .links-status')).toHaveText('Reading the vault…')
})
