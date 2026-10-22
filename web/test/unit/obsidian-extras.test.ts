import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/core/pipeline'
import { findComments, hideComments } from '../../src/core/comments'
import { highlightEdits } from '../../src/core/highlight-edit'
import { noteComment } from '../../src/reader/highlight-note'

const html = (md: string) => renderMarkdown(md).blocks.map((b) => b.html).join('\n')
const text = (md: string) => renderMarkdown(md).blocks.map((b) => b.text).join('\n')
/** Each span's source, so a test can check no rendered text points into a comment. */
const spans = (md: string) => [...html(md).matchAll(/<span data-s="(\d+)" data-e="(\d+)">/g)].map((m) => md.slice(+m[1], +m[2]))

describe('comments', () => {
  it('hide %%text%% within a line, and join what is either side', () => {
    expect(text('Before %%hidden%% after')).toBe('Before  after')
    expect(text('a%%x%%b')).toBe('ab')
    expect(spans('a%%x%%b')).toEqual(['a', 'b'])
  })
  it('hide a comment that spans paragraphs, headings and fences', () => {
    const md = 'One\n\n%%\n# Not a heading\n\n```\ncode\n```\n%%\n\nTwo'
    expect(text(md)).toBe('One\nTwo')
    expect(renderMarkdown(md).outline).toEqual([])
  })
  it('leave %% in code, fences and front matter alone', () => {
    expect(text('`%%a%%` b')).toBe('%%a%% b')
    expect(text('```\n%%x%%\n```')).toContain('%%x%%')
    expect(findComments('---\nk: "%%v%%"\n---\ntext')).toEqual([])
  })
  it('leave an unclosed %% as text', () => {
    expect(text('100%% sure')).toBe('100%% sure')
  })
  it('do not turn the text after a leading comment into code', () => {
    expect(html('%%a long comment here%% Text')).toMatch(/^<p/)
  })
  it('keep every offset: the blanked text is as long as the file, line for line', () => {
    const md = 'x %%a\nb%% y\n\n%%c%%'
    const h = hideComments(md).text
    expect(h.length).toBe(md.length)
    expect(h.split('\n').length).toBe(md.split('\n').length)
  })
})

describe('notes on highlights', () => {
  it('a comment straight after a highlight is its note, with its range', () => {
    const md = 'Some ==words==%%my note%% then'
    const m = /data-note="([^"]*)" data-note-s="(\d+)" data-note-e="(\d+)"/.exec(html(md))!
    expect(m[1]).toBe('my note')
    expect(md.slice(+m[2], +m[3])).toBe('%%my note%%')
    expect(text(md)).toBe('Some words then')
  })
  it('works for <mark> highlights too, and not for a comment after a space', () => {
    expect(html('<mark style="background: #BBFABBA6;">g</mark>%%n%%')).toContain('data-note="n"')
    expect(html('==w== %%n%%')).not.toContain('data-note')
  })
  it('a note is written on one line, and cannot close itself early', () => {
    expect(noteComment('  two\nlines  ')).toBe('%%two lines%%')
    expect(noteComment('50%% off')).toBe('%%50% off%%')
    expect(noteComment('   ')).toBe('')
  })
  it('recolouring a highlight leaves its note where it is', () => {
    const md = 'a ==word==%%n%% b'
    const s = md.indexOf('=='), e = md.indexOf('%%')
    const r = highlightEdits(md, [[0, md.length]], s, e, 'green', {})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    let out = md
    for (const ed of [...r.edits].sort((x, y) => y.from - x.from)) out = out.slice(0, ed.from) + ed.insert + out.slice(ed.to)
    expect(out).toMatch(/<\/mark>%%n%% b$/)
  })
})

describe('block ids', () => {
  it('^id ends a paragraph: not shown, and the paragraph takes it', () => {
    expect(html('A thought worth linking ^idea-1')).toMatch(/^<p id="\^idea-1"/)
    expect(text('A thought worth linking ^idea-1')).toBe('A thought worth linking')
  })
  it('names a list item, not the list', () => {
    expect(html('- one ^first\n- two')).toContain('<li id="^first">')
  })
  it('on its own line, names the table, quotation or code before it', () => {
    expect(html('| a |\n|---|\n| 1 |\n\n^tbl')).toMatch(/class="table-bleed" id="\^tbl"/)
    expect(html('> q\n\n^q')).toMatch(/<blockquote id="\^q"/)
    expect(html('```\nx\n```\n\n^c')).toMatch(/<pre[^>]* id="\^c"/)
    expect(renderMarkdown('> q\n\n^q').blocks).toHaveLength(1)
  })
  it('does not rename a heading', () => {
    expect(html('# Head\n\n^h')).toContain('id="head"')
  })
  it('a link to a block keeps its caret, so it is never taken for a heading', () => {
    expect(html('[[Note#^abc]]')).toContain('data-heading="^abc"')
    expect(text('[[Note#^abc]]')).toBe('Note › abc')
  })
})

describe('tags', () => {
  it('#tag becomes a tag; numbers, words joined to it and code do not', () => {
    const h = html('Tagged #reading and #books/fiction, not #1, a#b or `#c`. But #2024review.')
    expect([...h.matchAll(/<span class="tag"><span[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(['#reading', '#books/fiction', '#2024review'])
  })
  it('a tag keeps its source range, so it can be highlighted', () => {
    expect(spans('x #tag y')).toContain('#tag')
  })
})
