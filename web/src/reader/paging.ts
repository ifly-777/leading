// Page by Page (View › Page by Page): Space, Page Down and → move exactly one
// screen, less one line, so the last line read is the first line seen and the
// eye never hunts for its place; ⇧Space, Page Up and ← go back. Each new
// screen starts on a whole line, never one cut in half by the title bar.

export class Paging {
  enabled = false
  /** Only while reading, and not while typing in Find or the outline filter. */
  active: () => boolean = () => true

  constructor(private scroller: HTMLElement, private doc: HTMLElement) {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled || !this.active() || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest?.('input, textarea, [contenteditable="true"], .cm-editor')) return
      const forward = (e.key === ' ' && !e.shiftKey) || e.key === 'PageDown' || e.key === 'ArrowRight'
      const back = (e.key === ' ' && e.shiftKey) || e.key === 'PageUp' || e.key === 'ArrowLeft'
      if (!forward && !back) return
      e.preventDefault()
      this.turn(forward ? 1 : -1)
    })
  }

  /** The band under the title bar that text scrolls beneath. */
  private get band(): number {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top')) || 0
  }

  private get lineHeight(): number {
    return parseFloat(getComputedStyle(this.doc).lineHeight) || 28
  }

  /** One screen on (1) or back (-1). */
  turn(dir: 1 | -1): void {
    const s = this.scroller
    const page = s.clientHeight - this.band - this.lineHeight
    s.scrollTop = Math.max(0, s.scrollTop + dir * page)
    this.alignTop()
  }

  /** If a line is cut by the top of the reading area, move back so it shows whole. */
  private alignTop(): void {
    const box = this.scroller.getBoundingClientRect()
    const top = box.top + this.band
    const css = getComputedStyle(document.documentElement)
    const x = box.left + (parseFloat(css.getPropertyValue('--col-left')) || box.width / 3) + 20
    const r = (document as any).caretRangeFromPoint?.(x, top + 1) as Range | null
    const rect = r?.getBoundingClientRect()
    if (rect && rect.height > 0 && rect.top < top - 0.5) this.scroller.scrollTop -= top - rect.top
  }
}
