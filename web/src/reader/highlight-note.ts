// A note on a highlight: a few words of the reader's own, kept in the file
// straight after the highlight as an Obsidian comment, ==words==%%note%%, so
// Obsidian hides it as it hides any comment and the two apps agree.
//
// Clicking a highlight that has a note shows the note in a card under the
// line, beside the colour palette above it; the palette's pencil, or a click
// on the note, opens it for writing. Return keeps it, Escape leaves it as it
// was, and an empty note removes the comment.

import { placeCard } from './footnote-popover'

/** The comment for a note: one line, and never a "%%" that would close it early. */
export function noteComment(text: string): string {
  const clean = text.replace(/\s+/g, ' ').replace(/%%+/g, '%').trim()
  return clean ? `%%${clean}%%` : ''
}

export class HighlightNote {
  readonly el: HTMLElement
  private text: HTMLElement
  private input: HTMLTextAreaElement
  private mark: HTMLElement | null = null
  /** The reader kept a note (empty: removed) for this highlight. */
  onSave: (mark: HTMLElement, text: string) => void = () => {}

  constructor(private win: HTMLElement, private scroller: HTMLElement) {
    this.el = document.createElement('aside')
    this.el.className = 'fn-pop hl-note'
    this.el.hidden = true
    this.text = document.createElement('p')
    this.text.className = 'hl-note-text'
    this.text.title = 'Click to change the note'
    this.text.addEventListener('click', () => this.edit())
    this.input = document.createElement('textarea')
    this.input.className = 'hl-note-input'
    this.input.rows = 3
    this.input.placeholder = 'A note on this highlight'
    this.input.setAttribute('aria-label', 'Note on this highlight')
    this.input.hidden = true
    this.input.addEventListener('keydown', (e) => {
      // Return keeps the note; ⇧Return is allowed, but notes are kept on one line.
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.save() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hide() }
    })
    this.input.addEventListener('input', () => this.place())
    const hint = document.createElement('p')
    hint.className = 'hl-note-hint'
    hint.textContent = 'Return to keep · Esc to cancel'
    this.el.append(this.text, this.input, hint)
    win.append(this.el)
    // A click anywhere else puts the card away; a note being written is kept, as a text field would.
    document.addEventListener('pointerdown', (e) => {
      if (this.el.hidden || this.el.contains(e.target as Node)) return
      if ((e.target as Element).closest?.('.hl-palette')) return
      if (this.editing) this.save()
      else this.hide()
    }, true)
    scroller.addEventListener('scroll', () => { if (!this.el.hidden && !this.place()) this.hide() }, { passive: true })
  }

  get editing(): boolean { return !this.el.hidden && !this.input.hidden }
  get isOpen(): boolean { return !this.el.hidden }

  /** Show a highlight's note, if it has one. */
  show(mark: HTMLElement): void {
    if (!mark.dataset.note) { this.hide(); return }
    this.mark = mark
    this.text.textContent = mark.dataset.note
    this.text.hidden = false
    this.input.hidden = true
    this.el.dataset.editing = 'false'
    this.el.hidden = false
    if (!this.place()) this.hide()
  }

  /** Write or change a highlight's note. */
  open(mark: HTMLElement): void {
    this.mark = mark
    this.el.hidden = false
    this.edit()
  }

  private edit(): void {
    if (!this.mark) return
    this.input.value = this.mark.dataset.note ?? ''
    this.text.hidden = true
    this.input.hidden = false
    this.el.dataset.editing = 'true'
    this.place()
    this.input.focus()
    this.input.select()
  }

  private save(): void {
    const mark = this.mark
    const was = mark?.dataset.note ?? ''
    const now = this.input.value
    this.hide()
    if (mark?.isConnected && now.replace(/\s+/g, ' ').trim() !== was) this.onSave(mark, now)
  }

  private place(): boolean {
    return !!this.mark?.isConnected && placeCard(this.el, this.el, this.mark, this.win, this.scroller)
  }

  hide(): void {
    if (this.el.hidden) return
    this.el.hidden = true
    this.mark = null
  }
}
