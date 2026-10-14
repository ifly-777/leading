import { test, expect } from '@playwright/test'

test('Copy as Quote gives the selection as Markdown, with a link back to its section', async ({ page }) => {
  const copied: string[] = []
  await page.exposeFunction('capture', (m: any) => { if (m?.type === 'copy') copied.push(m.text) })
  await page.addInitScript(() => { ;(window as any).webkit = { messageHandlers: { leading: { postMessage: (m: any) => (window as any).capture(m) } } } })
  await page.setViewportSize({ width: 920, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  const text = '# Walden\n\n## Where I Lived\n\nI went to the *woods* because I wished to live deliberately.\n\nTo front only the essential facts of life.\n'
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: null, name: 'Walden' }) }, text)
  // Select from "woods" in the first paragraph to "essential" in the second.
  await page.evaluate(() => {
    const texts: Text[] = []
    const w = document.createTreeWalker(document.getElementById('doc')!, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) texts.push(w.currentNode as Text)
    const a = texts.find((t) => t.data === 'woods')!, z = texts.find((t) => t.data.includes('essential'))!
    const r = document.createRange(); r.setStart(a, 0); r.setEnd(z, z.data.indexOf('essential') + 9)
    getSelection()!.removeAllRanges(); getSelection()!.addRange(r)
  })
  await page.evaluate(() => (window as any).leading.command({ name: 'copyQuote' }))
  expect(copied.at(-1)).toBe('> *woods* because I wished to live deliberately.\n>\n> To front only the essential\n>\n> — [[Walden#Where I Lived]]\n')
  // In the editor: the editor's selection.
  await page.evaluate(() => (window as any).leading.command({ name: 'toggleEdit' }))
  await page.evaluate(() => { const v = (window as any).leading.view.editor.view; v.dispatch({ selection: { anchor: 0, head: 8 } }) })
  await page.evaluate(() => (window as any).leading.command({ name: 'copyQuote' }))
  expect(copied.at(-1)).toBe('> # Walden\n>\n> — [[Walden#Walden]]\n')
})
