import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Drive the app's page the way Swift does, capturing what it would send to Swift.
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
const editorText = (page: Page) => page.evaluate(() => (window as any).leading.text())

/** Replay every "edit" message onto the original text, as Swift's mirror does. */
async function mirror(page: Page, original: string): Promise<string> {
  const msgs = await page.evaluate(() => (window as any).__msgs.filter((m: any) => m.type === 'edit'))
  let doc = original
  for (const m of msgs) {
    for (const e of [...m.edits].sort((a: any, b: any) => b.from - a.from)) doc = doc.slice(0, e.from) + e.insert + doc.slice(e.to)
  }
  return doc
}

test('edit, format, undo, and the mirror stays exact', async ({ page }) => {
  const original = readFileSync(new URL('../fixtures/prose.md', import.meta.url), 'utf8')
  await openApp(page, original)
  await cmd(page, 'toggleEdit')
  await expect(page.locator('#editor .cm-content')).toBeVisible()
  // Coming from the top of the page, the first line is visible, not scrolled away.
  await expect(page.locator('#editor .cm-line').first()).toBeInViewport()
  // Type at the very start, then bold a word with ⌘B.
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('Hello ')
  await page.keyboard.down('Shift'); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift')
  await page.keyboard.press('Shift+ArrowLeft') // the space before is left out by the trim anyway
  await page.keyboard.press('ControlOrMeta+b')
  let text = await editorText(page)
  expect(text.startsWith('**Hello** # The Quiet Page') || text.startsWith('**Hello**')).toBe(true)
  // ⌘B again removes it.
  await page.keyboard.press('ControlOrMeta+b')
  text = await editorText(page)
  expect(text.startsWith('Hello # The Quiet Page')).toBe(true)
  // Undo through the history.
  await cmd(page, 'undo'); await cmd(page, 'undo')
  text = await editorText(page)
  expect(text.startsWith('Hello ')).toBe(true)
  // Swift's mirror, rebuilt from the messages, equals the editor's text.
  expect(await mirror(page, original)).toBe(text)
  const msgs = await page.evaluate(() => (window as any).__msgs.map((m: any) => m.type))
  expect(msgs).toContain('mode')
  expect(msgs).toContain('history')
})

test('Tab moves between table cells and aligns the pipes', async ({ page }) => {
  const original = '# T\n\n|a|b|\n|-|-|\n|long text|x|\n\nafter\n'
  await openApp(page, original)
  await cmd(page, 'toggleEdit')
  // Put the cursor in the first header cell and press Tab twice.
  await page.evaluate(() => { const v = (window as any).leading.view.editor.view; v.dispatch({ selection: { anchor: 6 } }); v.focus() })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const text = await editorText(page)
  expect(text).toContain('| a         | b   |\n| --------- | --- |\n| long text | x   |')
  // The second Tab skipped the delimiter row and selected the next cell's text.
  const sel = await page.evaluate(() => { const v = (window as any).leading.view.editor.view; const s = v.state.selection.main; return v.state.sliceDoc(s.from, s.to) })
  expect(sel).toBe('long text')
})

test('Find and Replace in edit mode; the query carries across ⌘E; reading shows the result', async ({ page }) => {
  const original = readFileSync(new URL('../fixtures/prose.md', import.meta.url), 'utf8')
  await openApp(page, original)
  // Search while reading first.
  await cmd(page, 'find')
  await page.keyboard.type('reader')
  const readCount = await page.locator('.findbar .count').textContent()
  expect(readCount).toMatch(/of \d+/)
  // Switch to editing: the same query is still there, now counted in the source.
  await cmd(page, 'toggleEdit')
  await expect(page.locator('.findbar .find-q')).toHaveValue('reader')
  await cmd(page, 'findReplace')
  await expect(page.locator('.findbar .replace-row')).toBeVisible()
  // The matches are outlined in the editor, not just counted.
  await expect(page.locator('#editor .cm-search-match, #editor .cm-search-current').first()).toBeVisible()
  await page.locator('.findbar .find-r').fill('READER')
  await page.locator('.findbar .do-replace-all').click()
  let text = await editorText(page)
  expect(text).toContain('READER')
  expect(text.match(/\breader\b/g)).toBeNull()
  // One undo reverts the whole Replace All.
  await cmd(page, 'undo')
  text = await editorText(page)
  expect(text).toBe(original)
  // Redo, then back to reading: the page shows the edited text.
  await cmd(page, 'redo')
  await cmd(page, 'toggleEdit')
  await expect(page.locator('#doc')).toContainText('READER')
  await expect(page.locator('.findbar .replace-row')).toBeHidden()
  expect(await mirror(page, original)).toBe(await editorText(page))
})

test('regular expressions with groups (edit mode only)', async ({ page }) => {
  await openApp(page, 'Fuel 61450 kg and 64900 kg.\n')
  await cmd(page, 'toggleEdit')
  await cmd(page, 'findReplace')
  await page.locator('.findbar .regex').click()
  await page.locator('.findbar .find-q').fill('(\\d+) kg')
  await page.locator('.findbar .find-q').dispatchEvent('input')
  await expect(page.locator('.findbar .count')).toHaveText('1 of 2')
  await page.locator('.findbar .find-r').fill('$1 kilograms')
  await page.locator('.findbar .do-replace-all').click()
  expect(await editorText(page)).toBe('Fuel 61450 kilograms and 64900 kilograms.\n')
})

test('undo works while reading too, and the page shows the result', async ({ page }) => {
  await openApp(page, '# Title\n\nOriginal sentence.\n')
  await cmd(page, 'toggleEdit')
  await page.evaluate(() => { const v = (window as any).leading.view.editor.view; v.dispatch({ changes: { from: v.state.doc.length - 1, insert: ' Added later.' }, userEvent: 'input.type' }) })
  await cmd(page, 'toggleEdit')
  await expect(page.locator('#doc')).toContainText('Added later.')
  await cmd(page, 'undo') // ⌘Z while reading: the one history covers both modes
  await expect(page.locator('#doc')).not.toContainText('Added later.')
  await expect(page.locator('#doc')).toContainText('Original sentence.')
})

test('smart punctuation while typing: off by default, curly when turned on, never in code', async ({ page }) => {
  await openApp(page, 'x\n')
  await cmd(page, 'toggleEdit')
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('"plain" -- ...')
  expect(await editorText(page)).toContain('"plain" -- ...')
  await page.evaluate(() => (window as any).leading.settings({ settings: { smartTyping: true } }))
  await page.keyboard.type(' "curly" it\'s -- --- ... `"code"`')
  const t = await editorText(page)
  expect(t).toContain('“curly” it’s – — …')
  expect(t).toContain('`"code"`')
})

test('the formatting bar appears over a mouse selection and its buttons format', async ({ page }) => {
  await openApp(page, 'A plain sentence to format.\n')
  await cmd(page, 'toggleEdit')
  const line = page.locator('.cm-line').first()
  const box = (await line.boundingBox())!
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + box.height / 2)
  await page.mouse.up()
  await expect(page.locator('.format-popover')).toBeVisible()
  await page.locator('.format-popover .fp-italic').dispatchEvent('mousedown')
  expect(await editorText(page)).toMatch(/^\*[^*]+\*/)
  // A key press hides the bar so typing is never interrupted.
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.format-popover')).toBeHidden()
})
