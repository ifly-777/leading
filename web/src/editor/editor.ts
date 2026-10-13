// Edit mode: the Markdown source in CodeMirror 6, set in the same face, size
// and column as reading mode and lightly styled. Every change is reported to
// the host (Swift keeps a mirror of the text and saves from it); the page's
// undo history is the one history, so ⌘Z works the same in both modes.

import { EditorState, EditorSelection, Prec, Compartment, type Extension, type ChangeSpec } from '@codemirror/state'
import { EditorView, keymap, type KeyBinding } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import { toggleFormat, toggleLink, type Format, type Edit } from '../core/format'
import { alignTable, cellIndexAt, cellStart, isDelimiterRow } from '../core/table-align'
import { fingerprint } from '../core/hash'
import { searchMarks } from './editor-find'

export interface EditorHost {
  /** The text changed: edits in the coordinates of the text before them. */
  onChange(edits: Edit[]): void
  /** Called a moment after typing stops, so the host can check its copy. */
  onSettled(length: number, hash: number): void
  onHistory(canUndo: boolean, canRedo: boolean): void
  /** Selection changed (for the formatting popover); empty = hide it. */
  onSelection(view: EditorView): void
}

// Light styling: structure shows, but the text still reads like the page.
const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '650', fontSize: '1.25em' },
  { tag: t.heading2, fontWeight: '650', fontSize: '1.12em' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.88em' },
  { tag: [t.link, t.url], color: 'var(--link)' },
  { tag: t.quote, color: 'color-mix(in srgb, var(--fg) 82%, var(--bg))' },
  // Markup characters (#, *, `, >, list markers) recede.
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.labelName], color: 'var(--muted)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', background: 'var(--bg)', color: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-body)', fontSize: 'var(--size)', lineHeight: 'var(--lh)',
    fontWeight: 'var(--weight)', letterSpacing: 'var(--ls)', wordSpacing: 'var(--ws)',
    fontVariantNumeric: 'oldstyle-nums proportional-nums', fontKerning: 'normal',
  },
  // The same column as reading mode: width and position come from the layout.
  '.cm-content': {
    // CodeMirror's own styles let the content grow to fill the window; pin it
    // to the reading column instead, so both modes share one measure.
    flexGrow: '0', flexShrink: '0', width: 'var(--col-w)', maxWidth: 'var(--col-w)',
    marginLeft: 'var(--col-left)', boxSizing: 'border-box',
    padding: 'calc(4.5em + 12px) 0 40vh', caretColor: 'var(--fg)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    background: 'color-mix(in srgb, var(--link) 22%, transparent)',
  },
  '.cm-search-match': { outline: '1.5px solid color-mix(in srgb, var(--search) 70%, transparent)', borderRadius: '2px' },
  '.cm-search-current': { outline: '2.5px solid var(--search)', borderRadius: '2px' },
})

// ---------------------------------------------------------------------------
// Commands

function runFormat(view: EditorView, f: Format | 'link'): boolean {
  const { state } = view
  const doc = state.doc.toString()
  const sel = state.selection.main
  const r = f === 'link' ? toggleLink(doc, sel.from, sel.to) : toggleFormat(doc, sel.from, sel.to, f)
  view.dispatch({
    changes: r.changes as ChangeSpec[],
    selection: EditorSelection.single(r.anchor, r.head),
    userEvent: 'input.format', scrollIntoView: true,
  })
  return true
}

/** The lines of the GFM table around `pos`, if there is one. */
function tableAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let node = syntaxTree(state).resolveInner(pos, -1)
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === 'Table') return { from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to }
  }
  // Fallback for a table the parser has not reached yet: contiguous lines with pipes.
  const line = state.doc.lineAt(pos)
  if (!line.text.includes('|')) return null
  let a = line.number, b = line.number
  while (a > 1 && state.doc.line(a - 1).text.includes('|')) a--
  while (b < state.doc.lines && state.doc.line(b + 1).text.includes('|')) b++
  const lines = Array.from({ length: b - a + 1 }, (_, i) => state.doc.line(a + i).text)
  return lines.some(isDelimiterRow) ? { from: state.doc.line(a).from, to: state.doc.line(b).to } : null
}

/** Tab / Shift-Tab inside a table: realign its pipes and move to the next or previous cell. */
function tableTab(dir: 1 | -1) {
  return (view: EditorView): boolean => {
    const { state } = view
    const pos = state.selection.main.head
    const range = tableAt(state, pos)
    if (!range) return false
    const lines = state.sliceDoc(range.from, range.to).split('\n')
    const curLine = state.doc.lineAt(pos)
    const row = curLine.number - state.doc.lineAt(range.from).number
    const col = cellIndexAt(curLine.text, pos - curLine.from)
    const aligned = alignTable(lines)
    const cols = aligned[0].split('|').length - 2
    let r = row, c = col + dir
    if (c >= cols) { c = 0; r++ }
    if (c < 0) { c = cols - 1; r-- }
    if (r > 0 && isDelimiterRow(aligned[r])) r += dir // skip the delimiter row
    if (r < 0) return true // before the first cell: stay
    if (r >= aligned.length) {
      // Tab past the last cell adds a new row.
      aligned.push(alignTable([...lines, '|' + ' |'.repeat(cols)]).slice(-1)[0])
    }
    const text = aligned.join('\n')
    const offsets = aligned.slice(0, r).reduce((n, l) => n + l.length + 1, 0)
    const at = range.from + offsets + cellStart(aligned[r], c)
    // Select the cell's text so typing replaces it, as in a spreadsheet.
    const cellText = aligned[r].slice(cellStart(aligned[r], c)).split(' |')[0].trimEnd()
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: EditorSelection.single(at, at + cellText.length),
      userEvent: 'input.table', scrollIntoView: true,
    })
    return true
  }
}

// ---------------------------------------------------------------------------
// Smart punctuation while typing (off unless the reader turns it on)

function inCode(state: EditorState, pos: number): boolean {
  // Code being typed has no closing backtick yet, so the parser cannot see it:
  // an odd number of backticks before the cursor on this line means "in code".
  const line = state.doc.lineAt(pos)
  const ticks = (state.sliceDoc(line.from, pos).match(/`/g) ?? []).length
  if (ticks % 2 === 1) return true
  for (let n: any = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'URL', 'Autolink'].includes(n.name)) return true
  }
  return false
}

function smartInput(view: EditorView, from: number, to: number, text: string): boolean {
  if (inCode(view.state, from)) return false
  const before = view.state.sliceDoc(Math.max(0, from - 2), from)
  const prev = before.slice(-1)
  const opens = !prev || /[\s(\[{—–“‘-]/.test(prev)
  let insert: string | null = null
  let replaceFrom = from
  if (text === '"') insert = opens ? '“' : '”'
  else if (text === "'") insert = opens ? '‘' : '’'
  else if (text === '-' && before.endsWith('–')) { insert = '—'; replaceFrom = from - 1 } // en dash + hyphen = em dash
  else if (text === '-' && prev === '-') { insert = '–'; replaceFrom = from - 1 }
  else if (text === '.' && before === '..') { insert = '…'; replaceFrom = from - 2 }
  if (insert === null) return false
  view.dispatch({ changes: { from: replaceFrom, to, insert }, selection: { anchor: replaceFrom + insert.length }, userEvent: 'input.type' })
  return true
}

// ---------------------------------------------------------------------------

export class SourceEditor {
  view: EditorView | null = null
  private smart = new Compartment()
  private smartOn = false
  private settleTimer = 0
  private lastHistory = ''

  constructor(private host: HTMLElement, private cb: EditorHost) {}

  get exists(): boolean { return !!this.view }
  get text(): string { return this.view ? this.view.state.doc.toString() : '' }

  private extensions(): Extension[] {
    const formatKeys: KeyBinding[] = [
      { key: 'Mod-b', run: (v) => runFormat(v, 'bold') },
      { key: 'Mod-i', run: (v) => runFormat(v, 'italic') }, // replaces CodeMirror's select-parent
      { key: 'Mod-u', run: (v) => runFormat(v, 'underline') },
      { key: 'Shift-Mod-x', run: (v) => runFormat(v, 'strike') },
      { key: 'Alt-Mod-c', run: (v) => runFormat(v, 'code') },
      { key: 'Mod-k', run: (v) => runFormat(v, 'link') },
      { key: 'Tab', run: tableTab(1) },
      { key: 'Shift-Tab', run: tableTab(-1) },
    ]
    return [
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      history(),
      EditorView.lineWrapping,
      theme,
      searchMarks, // Find's outlines (editor-find.ts)
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off', 'aria-label': 'Markdown source' }),
      Prec.highest(keymap.of(formatKeys)),
      keymap.of([...historyKeymap, indentWithTab, ...defaultKeymap]),
      this.smart.of(this.smartOn ? EditorView.inputHandler.of(smartInput) : []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const edits: Edit[] = []
          u.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => edits.push({ from: fromA, to: toA, insert: inserted.toString() }))
          this.cb.onChange(edits)
          clearTimeout(this.settleTimer)
          this.settleTimer = window.setTimeout(() => {
            const text = this.text
            this.cb.onSettled(text.length, fingerprint(text))
          }, 800)
        }
        const h = `${undoDepth(u.state) > 0}|${redoDepth(u.state) > 0}`
        if (h !== this.lastHistory) { this.lastHistory = h; this.cb.onHistory(undoDepth(u.state) > 0, redoDepth(u.state) > 0) }
        if (u.selectionSet || u.docChanged) this.cb.onSelection(u.view)
      }),
    ]
  }

  /** Create the editor on first use, holding `text`. */
  ensure(text: string): EditorView {
    if (!this.view) {
      this.view = new EditorView({ state: EditorState.create({ doc: text, extensions: this.extensions() }), parent: this.host })
    }
    return this.view
  }

  /** Replace the whole text (the file changed on disk, or a version was restored). Starts a fresh history. */
  reset(text: string): void {
    if (!this.view) return
    const keep = Math.min(this.view.state.selection.main.head, text.length)
    this.view.setState(EditorState.create({ doc: text, selection: { anchor: keep }, extensions: this.extensions() }))
  }

  setSmartTyping(on: boolean): void {
    this.smartOn = on
    this.view?.dispatch({ effects: this.smart.reconfigure(on ? EditorView.inputHandler.of(smartInput) : []) })
  }

  format(f: Format | 'link'): void { if (this.view) { runFormat(this.view, f); this.view.focus() } }
  undo(): boolean { return this.view ? undo(this.view) : false }
  redo(): boolean { return this.view ? redo(this.view) : false }

  /** Apply edits made outside the editor (a highlight from reading mode, Stage 4) through the history. */
  apply(edits: Edit[]): void {
    this.view?.dispatch({ changes: edits as ChangeSpec[], userEvent: 'input.external' })
  }

  focus(): void { this.view?.focus() }

  /** Source position at the top of the visible editor. */
  topPos(): number {
    const v = this.view
    if (!v) return 0
    // Heights count from the top of the text, below the content's top padding.
    return v.lineBlockAtHeight(Math.max(0, v.scrollDOM.scrollTop - v.documentPadding.top + 8)).from
  }

  /** Scroll so source position `pos` is near the top, just below the title bar. */
  scrollToPos(pos: number): void {
    const v = this.view
    if (!v) return
    const p = Math.min(pos, v.state.doc.length)
    v.dispatch({ selection: { anchor: p } })
    // On the first line, show the very top (with its padding) rather than cutting it off.
    if (v.state.doc.lineAt(p).number === 1) { v.scrollDOM.scrollTop = 0; return }
    v.dispatch({ effects: EditorView.scrollIntoView(p, { y: 'start', yMargin: 56 }) })
  }
}
