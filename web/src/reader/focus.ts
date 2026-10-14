// Focus (View › Focus, ⌘D): everything but the paragraph being read is
// dimmed, so the eye has one place to rest. The paragraph is the one under the
// reading line, a third of the way down the window, where the eye settles
// after a scroll. In a list it is the item, not the whole list.

const READING_LINE = 0.33

export class Focus {
  private on = false
  private current: HTMLElement | null = null
  private raf = 0

  constructor(private doc: HTMLElement, private scroller: HTMLElement, private root: HTMLElement) {
    scroller.addEventListener('scroll', () => this.schedule(), { passive: true })
  }

  set enabled(on: boolean) {
    if (on === this.on) return
    this.on = on
    if (on) this.root.dataset.focus = 'on'
    else delete this.root.dataset.focus
    this.update()
  }

  /** The page changed under the reading line (a new document, a re-render): look again. */
  schedule(): void {
    if (!this.on || this.raf) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.update() })
  }

  update(): void {
    const next = this.on ? this.atReadingLine() : null
    if (next === this.current) return
    this.current?.classList.remove('focus-current')
    this.current = next
    next?.classList.add('focus-current')
  }

  private atReadingLine(): HTMLElement | null {
    const box = this.scroller.getBoundingClientRect()
    const css = getComputedStyle(document.documentElement)
    const x = box.left + (parseFloat(css.getPropertyValue('--col-left')) || box.width / 3) + 40
    const y = box.top + box.height * READING_LINE
    // Between paragraphs there is only margin: look a little further down for the next one.
    for (let dy = 0; dy < 120; dy += 12) {
      const hit = document.elementFromPoint(x, y + dy)
      const block = hit?.closest<HTMLElement>('[data-b]')
      if (!block || !this.doc.contains(block)) continue
      // In a list, the item; elsewhere, the block.
      if (/^(UL|OL)$/.test(block.tagName)) {
        const li = hit!.closest('li')
        // The top-level item: a nested one cannot be brighter than its parent.
        let top: Element | null = li
        while (top && top.parentElement !== block) top = top.parentElement?.closest('li') ?? null
        if (top) return top as HTMLElement
      }
      return block
    }
    return null
  }
}
