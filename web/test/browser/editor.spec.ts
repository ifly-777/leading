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
  // The editor's column is exactly the reading column: same left edge, same width.
  for (const width of [1100, 1600, 800]) {
    await page.setViewportSize({ width, height: 850 })
    await page.waitForTimeout(150)
    const [doc, cm] = await page.evaluate(() => [document.getElementById('doc')!, document.querySelector('#editor .cm-content')!]
      .map((e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width) } }))
    expect(cm, `at ${width}px`).toEqual(doc)
  }
  await page.setViewportSize({ width: 1100, height: 850 })
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
  // Go to a match (it may be below the first screen): it is outlined, not just counted.
  await cmd(page, 'findNext')
  await expect(page.locator('#editor .cm-search-current').first()).toBeVisible()
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

test('smart punctuation while typing: on by default, straight when turned off, never in code', async ({ page }) => {
  await openApp(page, 'x\n')
  await cmd(page, 'toggleEdit')
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' "curly" it\'s -- --- ... `"code"`')
  const t = await editorText(page)
  expect(t).toContain('“curly” it’s – — …')
  expect(t).toContain('`"code"`')
  await page.evaluate(() => (window as any).leading.settings({ settings: { smartTyping: false } }))
  await page.keyboard.type(' "plain" -- ...')
  expect(await editorText(page)).toContain('"plain" -- ...')
})

test('lines become a list and back; a table starts at the cursor', async ({ page }) => {
  await openApp(page, 'one\ntwo\n')
  await cmd(page, 'toggleEdit')
  await page.evaluate(() => { const v = (window as any).leading.view.editor.view; v.dispatch({ selection: { anchor: 0, head: 7 } }) })
  await cmd(page, 'bulletList')
  expect(await editorText(page)).toBe('- one\n- two\n')
  await cmd(page, 'numberList')
  expect(await editorText(page)).toBe('1. one\n2. two\n')
  await cmd(page, 'numberList')
  expect(await editorText(page)).toBe('one\ntwo\n')
  // A table after the last line; typing replaces the first header, Tab moves on.
  await page.keyboard.press('ControlOrMeta+End')
  await cmd(page, 'table')
  await page.keyboard.type('Name')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Age')
  expect(await editorText(page)).toContain('| Name | Age |')
  // Tab into an empty body cell: the cursor waits inside it, nothing selected.
  await page.keyboard.press('Tab')
  await page.keyboard.type('Asha')
  await page.keyboard.press('Tab')
  await page.keyboard.type('7')
  expect(await editorText(page)).toMatch(/\| Asha +\| 7 +\|/)
})

test('a wrapped list item continues under its text, not its bullet', async ({ page }) => {
  await openApp(page, '- ' + 'word '.repeat(60) + '\n\n1. ' + 'word '.repeat(60) + '\n')
  await cmd(page, 'toggleEdit')
  for (const i of [0, 2]) {
    const line = page.locator('.cm-line').nth(i)
    const rects = await line.evaluate((el) => {
      // The left edge of the first word, and of the first character on the next visual line.
      const r = document.createRange()
      const chars: { top: number; left: number; ch: string }[] = []
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (let k = 0; k < n.textContent!.length; k++) {
          r.setStart(n, k); r.setEnd(n, k + 1)
          const b = r.getBoundingClientRect()
          chars.push({ top: b.top, left: b.left, ch: n.textContent![k] })
        }
      }
      const word = chars.find((c) => c.ch === 'w')!
      const next = chars.find((c) => c.top > word.top + 5 && c.ch !== ' ')
      return next ? [word.left, next.left] : [word.left]
    })
    expect(rects.length).toBe(2) // the item wraps
    expect(Math.abs(rects[1] - rects[0])).toBeLessThan(1.5) // and its second line starts under the first word
  }
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
  const bar = page.getByRole('toolbar', { name: 'Format selection' })
  await expect(bar).toBeVisible()
  await bar.locator('.fp-italic').dispatchEvent('mousedown')
  expect(await editorText(page)).toMatch(/^\*[^*]+\*/)
  // A key press hides the bar so typing is never interrupted.
  await page.keyboard.press('ArrowRight')
  await expect(bar).toBeHidden()
  // The same bar carries the highlight colours.
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + box.height / 2)
  await page.mouse.up()
  await expect(bar).toBeVisible()
  await bar.locator('.hl-dot[data-c="blue"]').dispatchEvent('mousedown')
  expect(await editorText(page)).toContain('<mark style="background: #ADCCFFA6;">')
})

test('a new document opens ready to write, and an empty one says so when read', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__msgs = []
    ;(window as any).webkit = { messageHandlers: { leading: { postMessage: (m: unknown) => (window as any).__msgs.push(JSON.parse(JSON.stringify(m))) } } }
  })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).__msgs.some((m: any) => m.type === 'ready'))
  await page.evaluate(async () => { await (window as any).leading.load({ text: '', imageBase: null, edit: true }) })
  // Straight into the editor, with the cursor in it: typing just works.
  await expect(page.locator('#editor .cm-content')).toBeVisible()
  expect(await page.evaluate(() => !!document.activeElement?.closest('.cm-content'))).toBe(true)
  expect(await page.evaluate(() => (window as any).__msgs.some((m: any) => m.type === 'mode' && m.editing))).toBe(true)
  // Reading an empty page shows a quiet note instead of blank paper.
  await cmd(page, 'toggleEdit')
  const note = await page.evaluate(() => getComputedStyle(document.getElementById('doc')!, '::before').content)
  expect(note).toContain('Nothing written yet')
  // Something written: the note goes.
  await cmd(page, 'toggleEdit')
  await page.keyboard.type('# A first line')
  await cmd(page, 'toggleEdit')
  await expect(page.locator('#doc h1')).toHaveText('A first line')
})
