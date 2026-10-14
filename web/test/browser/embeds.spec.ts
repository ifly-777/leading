import { test, expect } from '@playwright/test'

// The app serves embeds from the vault; here the test stands in for it.
const NOTE = '# Reading list\n\nIntro line.\n\n## Books\n\n- *Walden*, with $E=mc^2$ for no reason\n- [[Meditations]]\n\n![[Other note]]\n\n## Films\n\nNot this part.\n'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDKgCQAAhgQB/0FqBv4AAAAASUVORK5CYII=', 'base64')

test('embedded notes and pictures appear in place, as copies the page cannot edit', async ({ page }) => {
  await page.route('**/__wiki/abc/Reading%20list', (r) => r.fulfill({ body: NOTE, contentType: 'text/plain' }))
  await page.route('**/__wiki/abc/Missing', (r) => r.fulfill({ status: 404, body: '' }))
  await page.route('**/doc/abc/__wiki/pic.png', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }))
  await page.setViewportSize({ width: 920, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  const text = 'Before.\n\n![[Reading list#Books]]\n\n![[Missing]]\n\n![[pic.png|120]]\n\nAfter.'
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: '/doc/abc/' }) }, text)
  const embed = page.locator('#doc .note-embed').first()
  await expect(embed).toHaveAttribute('data-filled', 'yes')
  const body = embed.locator('.note-embed-body')
  // Only the Books section, typeset like the page.
  await expect(body).toContainText('Walden')
  await expect(body).not.toContainText('Intro line')
  await expect(body).not.toContainText('Not this part')
  expect(await body.locator('.katex').count()).toBe(1)
  // A copy: no positions, no ids; a nested embed is only a link.
  expect(await body.evaluate((b) => b.querySelectorAll('[data-s], [id], .note-embed').length)).toBe(0)
  await expect(body.locator('.note-embed-title')).toHaveText('Other note')
  await expect(page.locator('#doc .note-embed').nth(1)).toHaveAttribute('data-filled', 'missing')
  // The picture, at the width asked for.
  const img = page.locator('#doc img.embed-img')
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(2)
  expect(await img.evaluate((i: HTMLImageElement) => i.getBoundingClientRect().width)).toBe(120)
  // Find does not see the embedded text.
  await page.evaluate(() => (window as any).leading.command({ name: 'find' }))
  await page.keyboard.type('Walden')
  await page.waitForTimeout(300)
  await expect(page.locator('.findbar .count')).toHaveText(/^(No matches|0)/)
})

test('resting on a link to a note shows its opening, or the section it names', async ({ page }) => {
  await page.route('**/__wiki/abc/Reading%20list', (r) => r.fulfill({ body: NOTE, contentType: 'text/plain' }))
  await page.route('**/__wiki/abc/notes%2Fother.md', (r) => r.fulfill({ body: '# Other\n\nThe other note.', contentType: 'text/plain' }))
  await page.setViewportSize({ width: 920, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  const text = 'See [[Reading list#Films|films]], [[Reading list]] and [the other](notes/other.md), or [the web](https://example.com).'
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: '/doc/abc/' }) }, text)
  const card = page.locator('.link-pop')
  await page.locator('#doc .wikilink', { hasText: 'films' }).hover()
  await expect(card).toBeVisible()
  await expect(card).toContainText('Not this part.') // the Films section
  await expect(card).not.toContainText('Walden')
  await page.mouse.move(5, 800)
  await expect(card).toBeHidden()
  await page.locator('#doc a', { hasText: 'the other' }).hover()
  await expect(card).toContainText('The other note.')
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  // A web link shows nothing: nothing ever leaves the Mac.
  await page.locator('#doc a', { hasText: 'the web' }).hover()
  await page.waitForTimeout(800)
  await expect(card).toBeHidden()
})

test('links to a section of this note preview that section, and footnote numbers keep their own card', async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 870 })
  await page.goto('/app.html')
  await page.waitForFunction(() => (window as any).leading)
  const text = ['# Note', 'See [[#Minima]], [the go-around](#go-around), [[#Nowhere]] and a note.[^1]', ...Array(20).fill('Filler.'),
    '## Minima', 'Decision altitude 200 ft.', '## Go-around', 'Press TOGA.', '[^1]: The footnote.'].join('\n\n')
  await page.evaluate(async (t) => { await (window as any).leading.load({ text: t, imageBase: '/doc/abc/' }) }, text)
  const card = page.locator('.link-pop')
  await page.locator('#doc .wikilink', { hasText: 'Minima' }).hover()
  await expect(card).toContainText('Decision altitude 200 ft.')
  await expect(card).not.toContainText('Press TOGA')
  expect(await page.locator('#doc .wikilink').first().getAttribute('title')).toBeNull()
  await page.locator('#doc a', { hasText: 'the go-around' }).hover()
  await expect(card).toContainText('Press TOGA.')
  // A heading that is not there: no card (and never the whole note).
  await page.locator('#doc .wikilink', { hasText: 'Nowhere' }).hover()
  await page.waitForTimeout(800)
  await expect(card).toBeHidden()
  await page.locator('#doc a[data-footnote-ref]').hover()
  await page.waitForTimeout(800)
  await expect(card).toBeHidden()
})
