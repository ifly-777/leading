import { expect, test } from 'vitest'
import { renderMarkdown } from '../../src/core/pipeline'

test('a code block that names its language is coloured, and its text is unchanged', () => {
  const plain = renderMarkdown('```\nlet x = "a" // c\n```').blocks[0]
  const [b] = renderMarkdown('```swift\nlet x = "a" // c\n```').blocks
  expect(b.html).toContain('class="language-swift hljs"')
  expect(b.html).toContain('<span class="hljs-keyword">let</span>')
  expect(b.html).toContain('<span class="hljs-string">"a"</span>')
  expect(b.html).toContain('<span class="hljs-comment">// c</span>')
  // Find sees exactly the same text as before colouring.
  expect(b.text).toBe(plain.text)
})

test('aliases, unknown languages and no language', () => {
  expect(renderMarkdown('```zsh\necho hi\n```').blocks[0].html).toContain('hljs-built_in')
  expect(renderMarkdown('```html\n<p>x</p>\n```').blocks[0].html).toContain('hljs-tag')
  expect(renderMarkdown('```klingon\nqapla\n```').blocks[0].html).not.toContain('hljs')
  expect(renderMarkdown('```\nlet x\n```').blocks[0].html).not.toContain('hljs')
})

test('code from the file stays text: highlighting never lets markup through', () => {
  const [b] = renderMarkdown('```html\n<script>alert(1)</script>\n```').blocks
  expect(b.html).not.toContain('<script>')
  expect(b.html).toContain('&#x3C;')
})
