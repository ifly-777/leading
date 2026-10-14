import { expect, test } from 'vitest'
import { parse } from '../../src/core/pipeline'

/** The math in a snippet, as type[tex]@start-end. */
function maths(src: string): string[] {
  const out: string[] = []
  const walk = (n: any) => {
    if (n.type === 'inlineMath' || n.type === 'math') out.push(`${n.type}[${n.value}]@${n.position.start.offset}-${n.position.end.offset}`)
    for (const c of n.children ?? []) walk(c)
  }
  walk(parse(src))
  return out
}

test('single dollars follow Obsidian, so prices stay prose', () => {
  expect(maths('$x^2$ and $y$')).toEqual(['inlineMath[x^2]@0-5', 'inlineMath[y]@10-13'])
  expect(maths('it costs $5 and $10')).toEqual([])
  expect(maths('cost $3.50 vs $x$')).toEqual(['inlineMath[x]@14-17'])
  expect(maths('$ x$')).toEqual([])
  expect(maths('$x $')).toEqual([])
  expect(maths('$x$5')).toEqual([])
  expect(maths('$x\ny$')).toEqual([])
})

test('math is found before emphasis and escapes, like code', () => {
  expect(maths('$a*b*c$')).toEqual(['inlineMath[a*b*c]@0-7'])
  expect(maths('$\\{x\\}$')).toEqual(['inlineMath[\\{x\\}]@0-7'])
  expect(maths('\\$x$')).toEqual([])
  expect(maths('`$x$`')).toEqual([])
})

test('double dollars, inline and as a block', () => {
  expect(maths('$$E=mc^2$$ inline')).toEqual(['inlineMath[E=mc^2]@0-10'])
  expect(maths('$$\nx\n$$')).toEqual(['math[x]@0-7'])
})

import { renderMarkdown } from '../../src/core/pipeline'

test('formulas are typeset in the block, keep their source range, and stay out of Find', () => {
  const [p] = renderMarkdown('Energy $E=mc^2$ here.').blocks
  expect(p.html).toContain('class="math" data-s="7" data-e="15"')
  expect(p.html).toContain('class="katex"')
  expect(p.html).toContain('<annotation encoding="application/x-tex">E=mc^2</annotation>')
  expect(p.html).not.toContain('data-tex')
  expect(p.text).toBe('Energy  here.')
  const [d] = renderMarkdown('$$\n\\int_0^1 x\\,dx\n$$').blocks
  expect(d.html).toMatch(/^<div class="math display"/)
  expect(d.html).toContain('katex-display')
  const [g] = renderMarkdown('```math\na^2+b^2\n```').blocks
  expect(g.html).toContain('katex-display')
})

test('bad TeX shows an error in place, and nothing from the file runs', () => {
  const [p] = renderMarkdown('Bad $\\frac{1$ and $\\href{javascript:alert(1)}{x}$ and $<img src=x onerror=alert(1)>$.').blocks
  expect(p.html).toContain('katex-error')
  // The source appears only as escaped text (KaTeX's TeX annotation): no tag, handler or link.
  expect(p.html).not.toMatch(/<script|<img|<[^>]*\son\w+=|href=/i)
})

test('math inside a block with raw HTML survives the sanitiser', () => {
  const [p] = renderMarkdown('A <b>bold</b> and $x^2$.').blocks
  expect(p.html).toContain('class="katex"')
})

test('a Mermaid fence waits on the page as a figure, out of Find', () => {
  const [f] = renderMarkdown('```mermaid\ngraph TD; A-->B\n```').blocks
  expect(f.html).toMatch(/^<figure class="diagram" data-s="0" data-e="\d+" data-b="0"><pre class="diagram-src">graph TD; A-->B<\/pre><\/figure>$/)
  expect(f.text).toBe('')
})

import { splitForParallel, nextFence } from '../../src/core/chunks'
import { cutPrefix } from '../../src/reader/render'

test('a $$ block is never cut, even with headings and blank lines inside it', () => {
  // "# " inside display math is TeX, not a heading; a cut there would break the formula.
  const math = '$$\n\\begin{aligned}\n\n# x &= 1\n\n\\end{aligned}\n$$\n\n'
  const src = ('# Part\n\n' + 'Prose line.\n\n'.repeat(300) + math).repeat(40)
  for (const c of splitForParallel(src, 6, 20_000)) {
    let fence: string | null = null
    for (const line of src.slice(c.start, c.end).split('\n')) fence = nextFence(line, fence)
    expect(fence).toBeNull()
  }
  const head = cutPrefix(src, 5_000)
  let fence: string | null = null
  for (const line of head.split('\n')) fence = nextFence(line, fence)
  expect(fence).toBeNull()
  expect(nextFence('$$x$$', null)).toBeNull()
  expect(nextFence('$$', null)).toBe('$$')
  expect(nextFence('$$', '```')).toBe('```')
})
