// Search the vault: the margin's fourth tab. The app keeps an index of the
// vault in memory and answers each query with the notes that hold the words,
// best first, and up to three lines from each. Words are matched as Find
// matches them (case, accents and typography ignored), and marked in the lines
// here with the same folding. A click opens the note with Find on the words, at
// the line that was clicked.

import { fold, findAll } from '../core/fold'

export interface SearchLine { text: string; s: number }
export interface SearchNote { name: string; href: string; lines: SearchLine[]; count: number }
/** ok: these are the results; indexing: the vault is still being read; unsaved: the note has no folder yet; broad: its folder is too broad to search. */
export type SearchState = 'ok' | 'indexing' | 'unsaved' | 'broad'

/** Lines longer than this are cut around their first hit. */
const LINE_MAX = 160

export class SearchList {
  private box: HTMLElement
  private input: HTMLInputElement
  private status: HTMLElement
  private list: HTMLOListElement
  private id = 0
  private timer = 0
  /** Ask the app for the notes holding `query`; it answers through `set` with the same id. */
  request: (query: string, id: number) => void = () => {}
  /** Open a note at a line, with Find on the words. */
  onOpen: (href: string, query: string, s: number) => void = () => {}

  constructor(panel: HTMLElement) {
    this.box = document.createElement('div')
    this.box.className = 'search-side'
    this.input = document.createElement('input')
    this.input.type = 'search'
    this.input.placeholder = 'Search the vault'
    this.input.setAttribute('aria-label', 'Search the vault')
    this.input.spellcheck = false
    this.input.autocomplete = 'off'
    this.status = document.createElement('p')
    this.status.className = 'links-status'
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
    this.list = document.createElement('ol')
    this.box.append(this.input, this.status, this.list)
    panel.append(this.box)
    this.input.addEventListener('input', () => {
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => this.refresh(), 120)
    })
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.items()[0]?.focus() }
      else if (e.key === 'Enter') { e.preventDefault(); this.items()[0]?.click() }
    })
    // ↑ and ↓ move through the notes and lines; Return opens (they are links).
    this.list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const all = this.items()
      const i = all.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'ArrowUp' && i <= 0) { this.input.focus(); return }
      all[Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))]?.focus()
    })
  }

  get query(): string { return this.input.value.trim() }

  /** Put the cursor in the field, the words selected, ready to type. */
  focus(): void {
    this.input.focus()
    this.input.select()
  }

  /** Ask again: the tab came into view, or the vault changed. */
  refresh(): void {
    const q = this.query
    const id = ++this.id
    if (!q) { this.list.replaceChildren(); this.say(''); return }
    if (!this.list.children.length) this.say('Searching…')
    this.request(q, id)
  }

  set(id: number, notes: SearchNote[], counts: { notes: number; total: number }, state: SearchState): void {
    if (id !== this.id) return // an answer to words since changed
    this.list.replaceChildren()
    if (state === 'unsaved') { this.say('Save this note to search the notes around it.'); return }
    if (state === 'broad') { this.say('This note is in your home folder, which is too broad to search. Notes in a vault, or in a folder of their own, can be searched.'); return }
    if (state === 'indexing') { this.say('Reading the vault…'); return }
    if (!notes.length) { this.say('Nothing found.'); return }
    const n = (k: number, one: string, many: string) => `${k.toLocaleString()} ${k === 1 ? one : many}`
    let said = counts.total ? `${n(counts.total, 'match', 'matches')} in ${n(counts.notes, 'note', 'notes')}` : n(counts.notes, 'note', 'notes')
    if (counts.notes > notes.length) said += `, the first ${notes.length.toLocaleString()} shown`
    this.say(said)
    const q = this.query
    for (const note of notes) {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.className = 'link-item search-item'
      a.href = '#'
      this.mark(a, note.name, q)
      if (note.count > 1) {
        const c = document.createElement('span')
        c.className = 'search-count'
        c.textContent = ` ${note.count.toLocaleString()}`
        c.setAttribute('aria-label', `, ${n(note.count, 'match', 'matches')}`)
        a.append(c)
      }
      a.title = `Open ${note.name}`
      a.addEventListener('click', (e) => { e.preventDefault(); this.onOpen(note.href, q, note.lines[0]?.s ?? -1) })
      li.append(a)
      for (const line of note.lines) {
        const p = document.createElement('a')
        p.className = 'link-line search-item'
        p.href = '#'
        this.mark(p, cut(line.text, q), q)
        p.addEventListener('click', (e) => { e.preventDefault(); this.onOpen(note.href, q, line.s) })
        li.append(p)
      }
      this.list.append(li)
    }
  }

  /** The focusable results, in order. */
  private items(): HTMLElement[] { return [...this.list.querySelectorAll<HTMLElement>('.search-item')] }

  /** Fill `el` with `text`, the words marked. */
  private mark(el: HTMLElement, text: string, q: string): void {
    let at = 0
    for (const [s, e] of findAll(fold(text), text, q)) {
      if (s > at) el.append(text.slice(at, s))
      const hit = document.createElement('span')
      hit.className = 'search-hit'
      hit.textContent = text.slice(s, e)
      el.append(hit)
      at = e
    }
    if (at < text.length) el.append(text.slice(at))
  }

  private say(text: string): void { this.status.textContent = text }
}

/** A long line cut to show its first hit, with an ellipsis where it was cut. */
function cut(text: string, q: string): string {
  if (text.length <= LINE_MAX) return text
  const hit = findAll(fold(text), text, q)[0]?.[0] ?? 0
  const from = Math.max(0, Math.min(hit - 50, text.length - LINE_MAX))
  // Start and end at spaces, so no word is cut in half.
  let s = from === 0 ? 0 : text.indexOf(' ', from) + 1 || from
  let e = Math.min(text.length, s + LINE_MAX)
  if (e < text.length) e = text.lastIndexOf(' ', e) > s ? text.lastIndexOf(' ', e) : e
  if (s > hit) s = from
  return (s > 0 ? '…' : '') + text.slice(s, e) + (e < text.length ? '…' : '')
}
