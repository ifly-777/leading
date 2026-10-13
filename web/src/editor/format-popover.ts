// The small bar that appears above a selection in edit mode: bold, italic,
// underline, strikethrough, code, link. It shows after a pointer selection
// (keyboard selections are left alone, so typing is never interrupted) and
// hides as soon as the selection collapses or a key is pressed. Stage 4
// adds the highlight colours to the same bar.

import type { EditorView } from '@codemirror/view'
import type { Format } from '../core/format'

const BUTTONS: [Format | 'link', string, string][] = [
  ['bold', 'B', 'Bold (⌘B)'],
  ['italic', 'I', 'Italic (⌘I)'],
  ['underline', 'U', 'Underline (⌘U)'],
  ['strike', 'S', 'Strikethrough (⇧⌘X)'],
  ['code', '‹›', 'Code (⌥⌘C)'],
  ['link', '↗', 'Link (⌘K)'],
]

export class FormatPopover {
  readonly el: HTMLElement
  private pointerSelecting = false
  /** The last selection was made with the pointer (keyboard selections never show the bar). */
  private fromPointer = false

  constructor(private win: HTMLElement, private frame: HTMLElement, onFormat: (f: Format | 'link') => void) {
    this.el = document.createElement('div')
    this.el.className = 'format-popover'
    this.el.hidden = true
    this.el.setAttribute('role', 'toolbar')
    this.el.setAttribute('aria-label', 'Format selection')
    for (const [f, label, title] of BUTTONS) {
      const b = document.createElement('button')
      b.textContent = label
      b.title = title
      b.setAttribute('aria-label', title)
      b.className = 'fp-' + f
      // mousedown, not click: keep the editor's selection and focus.
      b.addEventListener('mousedown', (e) => { e.preventDefault(); onFormat(f) })
      this.el.append(b)
    }
    win.append(this.el)
    document.addEventListener('pointerdown', (e) => {
      if (this.el.contains(e.target as Node)) return
      this.pointerSelecting = true
      this.fromPointer = true
      this.hide()
    })
    document.addEventListener('pointerup', () => { this.pointerSelecting = false })
    document.addEventListener('keydown', (e) => {
      // Modifier presses alone (⌘ before ⌘B) keep the bar; anything else hides it.
      if (['Meta', 'Shift', 'Alt', 'Control'].includes(e.key)) return
      this.fromPointer = false
      this.hide()
    }, true)
  }

  /** Called when the editor's selection changes. */
  update(view: EditorView): void {
    const sel = view.state.selection.main
    if (sel.empty || !this.fromPointer) return this.hide()
    // Wait for the pointer to lift before showing, so the bar does not chase the mouse.
    if (this.pointerSelecting) {
      document.addEventListener('pointerup', () => requestAnimationFrame(() => this.update(view)), { once: true })
      return
    }
    const start = view.coordsAtPos(sel.from)
    if (!start) return this.hide()
    const box = this.frame.getBoundingClientRect()
    this.el.hidden = false
    const w = this.el.offsetWidth
    const left = Math.min(Math.max(8, start.left - box.left - w / 2 + 20), box.width - w - 8)
    const top = start.top - box.top - this.el.offsetHeight - 8
    // Below the line instead if there is no room above (under the title bar).
    this.el.style.left = left + 'px'
    this.el.style.top = (top < 44 ? start.bottom - box.top + 8 : top) + 'px'
  }

  hide(): void { this.el.hidden = true }
}
