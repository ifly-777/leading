// Find and Replace in edit mode: searches the raw Markdown source. Plain
// searches use the same matching as reading mode (case, accents and
// typography ignored unless asked); the .* toggle switches to regular
// expressions. Matches near the screen are outlined like reading-mode marks;
// Replace All is a single undoable change.

import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { fold, findAll, type Folded } from '../core/fold'
import type { FindEngine, FindOptions } from '../reader/find'
import type { SourceEditor } from './editor'

const setMarks = StateEffect.define<DecorationSet>()

/** Holds the drawn search marks; part of the editor's extensions. */
export const searchMarks: Extension = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    for (const e of tr.effects) if (e.is(setMarks)) return e.value
    return tr.docChanged ? set.map(tr.changes) : set
  },
  provide: (f) => EditorView.decorations.from(f),
})

const matchMark = Decoration.mark({ class: 'cm-search-match' })
const currentMark = Decoration.mark({ class: 'cm-search-current' })

export class EditorFind implements FindEngine {
  readonly canReplace = true
  private matches: [number, number][] = []
  private regex: RegExp | null = null
  // Folding 5 MB takes a moment, so it is done once per version of the text.
  private folded: { text: string; doc: string; caseSensitive: boolean; f: Folded } | null = null

  constructor(private editor: SourceEditor) {}

  private get view(): EditorView | null { return this.editor.view }

  search(query: string, opts: FindOptions): number {
    const v = this.view
    this.matches = []
    this.regex = null
    if (!v) return 0
    const doc = v.state.doc.toString()
    if (opts.regex) {
      let re: RegExp
      try {
        const src = opts.wholeWord ? `\\b(?:${query})\\b` : query
        re = new RegExp(src, 'gu' + (opts.caseSensitive ? '' : 'i'))
      } catch {
        return 0 // an unfinished pattern simply has no matches yet
      }
      this.regex = re
      for (const m of doc.matchAll(re)) {
        if (m[0].length === 0) continue // patterns that can match nothing would match everywhere
        this.matches.push([m.index!, m.index! + m[0].length])
      }
      return this.matches.length
    }
    if (!this.folded || this.folded.doc !== doc || this.folded.caseSensitive !== opts.caseSensitive) {
      this.folded = { text: doc, doc, caseSensitive: opts.caseSensitive, f: fold(doc, opts.caseSensitive) }
    }
    this.matches = findAll(this.folded.f, doc, query, opts)
    return this.matches.length
  }

  firstVisible(): number {
    const v = this.view
    if (!v || !this.matches.length) return -1
    const top = this.editor.topPos()
    const i = this.matches.findIndex(([s]) => s >= top)
    return i < 0 ? 0 : i
  }

  reveal(i: number, settle = false): void {
    const v = this.view
    const m = this.matches[i]
    if (!v || !m) return
    if (settle) return // CodeMirror scrolls precisely the first time
    v.dispatch({ selection: { anchor: m[0], head: m[1] }, effects: EditorView.scrollIntoView(m[0], { y: 'center' }) })
  }

  draw(current: number): void {
    const v = this.view
    if (!v) return
    const marks = []
    // Only the matches inside what CodeMirror has drawn: a few hundred at most.
    for (const { from, to } of v.visibleRanges) {
      let lo = 0, hi = this.matches.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if (this.matches[mid][1] < from) lo = mid + 1; else hi = mid }
      for (let i = lo; i < this.matches.length && this.matches[i][0] <= to; i++) {
        const [s, e] = this.matches[i]
        marks.push((i === current ? currentMark : matchMark).range(s, e))
      }
    }
    v.dispatch({ effects: setMarks.of(Decoration.set(marks, true)) })
  }

  clear(): void {
    this.view?.dispatch({ effects: setMarks.of(Decoration.none) })
  }

  ticks(current: number): { all: number[]; current: number | null } {
    const v = this.view
    if (!v) return { all: [], current: null }
    const h = v.contentHeight || 1
    const at = (pos: number) => v.lineBlockAt(pos).top / h
    // Sample at most 2,000 positions: a scroll bar has fewer pixels than that.
    const step = Math.max(1, Math.floor(this.matches.length / 2000))
    const all: number[] = []
    for (let i = 0; i < this.matches.length; i += step) all.push(at(this.matches[i][0]))
    const c = this.matches[current]
    return { all, current: c ? at(c[0]) : null }
  }

  /** The replacement for one match: with a regular expression, $1 and the like refer to its groups. */
  private replacementFor(i: number, text: string): string {
    if (!this.regex || !this.view) return text
    const [s, e] = this.matches[i]
    const once = new RegExp(this.regex.source, this.regex.flags.replace('g', ''))
    return this.view.state.sliceDoc(s, e).replace(once, text)
  }

  replace(i: number, text: string): void {
    const v = this.view
    const m = this.matches[i]
    if (!v || !m) return
    v.dispatch({ changes: { from: m[0], to: m[1], insert: this.replacementFor(i, text) }, userEvent: 'input.replace' })
  }

  replaceAll(text: string): number {
    const v = this.view
    if (!v || !this.matches.length) return 0
    const changes = this.matches.map(([from, to], i) => ({ from, to, insert: this.replacementFor(i, text) }))
    // One transaction: one step to undo.
    v.dispatch({ changes, userEvent: 'input.replace.all' })
    return changes.length
  }
}
