// The highlights in this file, listed beside it: a second tab in the outline's
// margin. Each shows its colour, its words and the section it sits in; a click
// goes there (and View › Back returns). The colour dots filter the list, and
// Copy puts every highlight on the clipboard as Markdown, in the file's own
// syntax, so colours survive a paste into Obsidian.
//
// Read from the page itself (every highlight is a <mark class="hl"> with its
// source range), so the list is always what the reader sees.

import type { HighlightSlot } from '../core/nodes'
import { SLOTS as HIGHLIGHT_SLOTS } from '../core/highlight-colors'
import { SLOT_NAMES } from './highlights'

/** The margin's four tabs: the outline, this file's highlights, the notes that link to it, and search of the vault. */
export type SideTab = 'outline' | 'highlights' | 'links' | 'search'

export interface HighlightEntry { mark: HTMLElement; slot: HighlightSlot; text: string; s: number; e: number; heading: string | null; note?: string }

/**
 * Top-level highlights on the page, in order, with the heading of the section
 * each sits in. Sections come from the page's order, not source offsets: the
 * outline's offsets are from the last full render, and a highlight made since
 * shifts everything after it.
 */
export function collectHighlights(doc: HTMLElement, correction: (b: number) => number): HighlightEntry[] {
  const out: HighlightEntry[] = []
  let heading: string | null = null
  for (const el of doc.querySelectorAll<HTMLElement>('mark.hl, h1, h2, h3')) {
    // A highlight inside another is part of it; anything in an embedded note belongs to that note.
    if (el.closest('.note-embed')) continue
    if (el.tagName !== 'MARK') { heading = (el.textContent ?? '').trim() || heading; continue }
    if (el.parentElement?.closest('mark.hl') || !el.dataset.s) continue
    const b = Number(el.closest<HTMLElement>('[data-b]')?.dataset.b ?? 0)
    const d = correction(b)
    out.push({
      mark: el, slot: (el.dataset.c as HighlightSlot) || 'yellow', s: Number(el.dataset.s) + d, e: Number(el.dataset.e) + d,
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), heading,
      ...(el.dataset.note ? { note: el.dataset.note } : {}),
    })
  }
  return out
}

/** Every highlight as Markdown, grouped under its heading, written exactly as in the file. */
export function highlightsMarkdown(entries: HighlightEntry[], source: string, title: string | null): string {
  const lines: string[] = [`# Highlights${title ? ` from ${title}` : ''}`]
  let heading: string | null | undefined
  for (const e of entries) {
    if (e.heading !== heading) {
      heading = e.heading
      lines.push('', `## ${heading ?? 'Before the first heading'}`, '')
    }
    lines.push(`- ${source.slice(e.s, e.e).replace(/\s*\n\s*/g, ' ')}`)
    // The note goes under its highlight, as text: a comment would hide it in the paste.
    if (e.note) lines.push(`    - ${e.note}`)
  }
  return lines.join('\n') + '\n'
}

export class HighlightsList {
  private tabs: HTMLElement
  private box: HTMLElement
  private chips: HTMLElement
  private list: HTMLOListElement
  private entries: HighlightEntry[] = []
  private only: HighlightSlot | null = null
  private timer = 0
  /** Which tab the margin shows. */
  tab: SideTab = 'outline'
  /** The margin turned to a tab (the view fetches the Links tab's notes then). */
  onTab: (tab: SideTab) => void = () => {}
  /** Hooks into the view. */
  collect: () => HighlightEntry[] = () => []
  onJump: (mark: HTMLElement) => void = () => {}
  onCopy: () => void = () => {}

  constructor(private panel: HTMLElement) {
    this.tabs = document.createElement('div')
    this.tabs.className = 'side-tabs'
    this.tabs.setAttribute('role', 'tablist')
    this.tabs.setAttribute('aria-label', 'Margin')
    // ← and → move between tabs, as in any tab list; Tab moves on into the one showing.
    this.tabs.addEventListener('keydown', (e) => {
      const all = [...this.tabs.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const i = all.indexOf(document.activeElement as HTMLButtonElement)
      if (i < 0) return
      const to = e.key === 'ArrowRight' ? all[(i + 1) % all.length] : e.key === 'ArrowLeft' ? all[(i - 1 + all.length) % all.length]
        : e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : null
      if (!to) return
      e.preventDefault()
      this.show(to.dataset.tab as SideTab)
      to.focus()
    })
    for (const [id, label] of [['outline', 'Outline'], ['highlights', 'Highlights'], ['links', 'Links'], ['search', 'Search']] as const) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.tab = id
      b.setAttribute('role', 'tab')
      b.textContent = label
      b.addEventListener('click', () => this.show(id))
      this.tabs.append(b)
    }
    this.box = document.createElement('div')
    this.box.className = 'hl-side'
    this.chips = document.createElement('div')
    this.chips.className = 'hl-chips'
    for (const slot of HIGHLIGHT_SLOTS) {
      const c = document.createElement('button')
      c.type = 'button'
      c.className = 'hl-chip'
      c.dataset.c = slot
      c.title = `Only ${SLOT_NAMES[slot]}`
      c.setAttribute('aria-label', `Only ${SLOT_NAMES[slot].toLowerCase()} highlights`)
      c.addEventListener('click', () => { this.only = this.only === slot ? null : slot; this.render() })
      this.chips.append(c)
    }
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'hl-copy'
    copy.textContent = 'Copy'
    copy.title = 'Copy every highlight as Markdown'
    copy.addEventListener('click', () => this.onCopy())
    this.chips.append(copy)
    this.list = document.createElement('ol')
    // ↑ and ↓ move between highlights; Return goes to one (they are links).
    this.list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const all = [...this.list.querySelectorAll<HTMLElement>('a.hl-item')]
      const i = all.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
    })
    this.box.append(this.chips, this.list)
    panel.prepend(this.tabs)
    panel.append(this.box)
    this.show('outline')
  }

  show(tab: SideTab): void {
    this.tab = tab
    this.panel.dataset.tab = tab
    for (const b of this.tabs.querySelectorAll<HTMLElement>('button')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab))
      b.tabIndex = b.dataset.tab === tab ? 0 : -1
    }
    if (tab === 'highlights') this.refresh()
    this.onTab(tab)
  }

  /**
   * While editing, only the outline: the other tabs list the rendered page,
   * which is hidden then, as the View menu already has it.
   */
  setEditing(editing: boolean): void {
    for (const b of this.tabs.querySelectorAll<HTMLButtonElement>('button')) {
      if (b.dataset.tab !== 'outline') b.disabled = editing
    }
    if (editing && this.tab !== 'outline') this.show('outline')
  }

  /** Put keyboard focus on the first highlight, so ↑, ↓ and Return work at once. */
  focusList(): void { this.list.querySelector<HTMLElement>('a.hl-item')?.focus() }

  /** The page changed: list it again, soon (highlights often come several at once). */
  invalidate(): void {
    if (this.tab !== 'highlights') return
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.refresh(), 150)
  }

  refresh(): void {
    this.entries = this.collect()
    this.render()
  }

  get count(): number { return this.entries.length }

  private render(): void {
    for (const c of this.chips.querySelectorAll<HTMLElement>('.hl-chip')) {
      const slot = c.dataset.c as HighlightSlot
      c.hidden = !this.entries.some((e) => e.slot === slot)
      c.setAttribute('aria-pressed', String(this.only === slot))
    }
    this.list.replaceChildren()
    const shown = this.only ? this.entries.filter((e) => e.slot === this.only) : this.entries
    if (!shown.length) {
      const li = document.createElement('li')
      li.className = 'empty'
      li.textContent = this.entries.length ? 'None in this colour' : 'No highlights yet'
      this.list.append(li)
      return
    }
    let heading: string | null | undefined
    for (const e of shown) {
      if (e.heading !== heading) {
        heading = e.heading
        if (heading) {
          const h = document.createElement('li')
          h.className = 'hl-heading'
          h.textContent = heading
          this.list.append(h)
        }
      }
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.className = 'hl-item'
      a.href = '#'
      a.dataset.c = e.slot
      a.textContent = e.text
      a.title = e.text
      // VoiceOver hears the colour too, which the page shows only as colour.
      a.setAttribute('aria-label', `${SLOT_NAMES[e.slot]}: ${e.text}${e.note ? `. Note: ${e.note}` : ''}`)
      a.addEventListener('click', (ev) => { ev.preventDefault(); if (e.mark.isConnected) this.onJump(e.mark) })
      li.append(a)
      if (e.note) {
        const n = document.createElement('p')
        n.className = 'hl-item-note'
        n.textContent = e.note
        li.append(n)
      }
      this.list.append(li)
    }
  }
}
