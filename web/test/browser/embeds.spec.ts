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
