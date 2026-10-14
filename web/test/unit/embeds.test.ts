import { expect, test } from 'vitest'
import { renderMarkdown } from '../../src/core/pipeline'

const base = 'leading://doc/abc/'

test('an embedded picture is an image the app finds in the vault, sized as Obsidian sizes it', () => {
  const [p] = renderMarkdown('![[Pasted image 2024.png]]', { imageBase: base }).blocks
  expect(p.html).toContain('<img class="embed-img" src="leading://doc/abc/__wiki/Pasted%20image%202024.png" alt="Pasted image 2024.png"')
  expect(renderMarkdown('![[pic.jpg|300]]', { imageBase: base }).blocks[0].html).toContain('width="300"')
  expect(renderMarkdown('![[pic.jpg|300x200]]', { imageBase: base }).blocks[0].html).toMatch(/width="300" height="200"/)
})

test('an embedded note waits as a placeholder; other files stay links', () => {
  const [p] = renderMarkdown('![[Reading list#Books]]', { imageBase: base }).blocks
  expect(p.html).toContain('<span class="note-embed" data-target="Reading list" data-heading="Books"')
  expect(p.html).toContain('class="wikilink note-embed-title"')
  expect(p.text).toBe('') // not searched
  expect(renderMarkdown('![[paper.pdf]]', { imageBase: base }).blocks[0].html).toContain('class="wikilink embed"')
  // With no document folder (a new page), there is nowhere to look: a link.
  expect(renderMarkdown('![[pic.png]]', { imageBase: null }).blocks[0].html).toContain('class="wikilink embed"')
})

import { balanceMarkers } from '../../src/reader/view'

test('a quotation keeps its emphasis paired', () => {
  const t = 'I went to the *woods* because ==I wished== to `live`, **bold** and on.'
  const q = (a: string, z: string) => { const s = t.indexOf(a); const [f, e] = balanceMarkers(t, s, t.indexOf(z, s) + z.length); return t.slice(f, e) }
  expect(q('woods', 'because')).toBe('*woods* because')
  expect(q('I wished', 'to')).toBe('==I wished== to')
  expect(q('bold', 'and')).toBe('**bold** and')
  expect(q('went', 'live')).toBe('went to the *woods* because ==I wished== to `live`')
})
