import { describe, it, expect } from 'vitest'
import { smartenText } from '../../src/core/plugins/smartquotes'
import { renderMarkdown } from '../../src/core/pipeline'

const text = (md: string) => renderMarkdown(md).blocks.map((b) => b.html.replace(/<[^>]+>/g, '')).join('\n')

describe('smart punctuation', () => {
  it.each([
    ['"Hello," she said.', '“Hello,” she said.'],
    ["It's the '90s, rock 'n' roll", 'It’s the ’90s, rock ’n’ roll'],
    ["'tis 'single'", '’tis ‘single’'],
    ['pages 10--20', 'pages 10–20'],
    ['a---b', 'a—b'],
    ['wait...', 'wait…'],
    ['(\'quoted\')', '(‘quoted’)'],
  ])('%s', (src, out) => expect(smartenText(src, '')).toBe(out))

  it('never touches URLs', () => {
    expect(smartenText('see https://ex.com/a--b?q="x" ok', '')).toBe('see https://ex.com/a--b?q="x" ok')
    expect(smartenText('www.ex.com/it\'s--x', '')).toBe('www.ex.com/it\'s--x')
  })

  it('never touches inline code, code blocks or front matter', () => {
    const out = text('---\nt: "a--b"\n---\n\n`"x" -- ...`\n\n```\n"y" -- ...\n```\n')
    expect(out).toContain('"x" -- ...')
    expect(out).toContain('"y" -- ...')
    expect(out).toContain('"a--b"'.replace(/"/g, '') /* YAML value */)
  })

  it('uses the character before a formatting boundary', () => {
    expect(text("**bold**'s and \"*em*\"")).toContain('bold’s and “em”')
  })

  it('leaves the source text alone', () => {
    const src = 'It\'s "fine" -- really...'
    const before = src
    renderMarkdown(src)
    expect(src).toBe(before)
  })
})
