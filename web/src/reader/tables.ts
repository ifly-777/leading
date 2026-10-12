// Tables that are wider than the window scroll sideways as a last resort:
// the first column stays pinned and the right edge fades while there is more
// to see. Checked lazily as tables come near the screen.

export class TableWatcher {
  private io: IntersectionObserver
  private seen = new WeakSet<Element>()

  constructor(private scroller: HTMLElement) {
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.check(e.target as HTMLElement)
    }, { root: scroller, rootMargin: '1200px 0px' })
  }

  /** Watch any tables added since the last call. */
  scan(doc: HTMLElement): void {
    doc.querySelectorAll('.table-scroll').forEach((el) => {
      if (this.seen.has(el)) return
      this.seen.add(el)
      this.io.observe(el)
      el.addEventListener('scroll', () => this.fade(el as HTMLElement), { passive: true })
    })
  }

  /** Re-check every table after a layout change (font size, window width…). */
  recheckAll(doc: HTMLElement): void {
    doc.querySelectorAll<HTMLElement>('.table-scroll').forEach((el) => this.check(el))
  }

  private check(el: HTMLElement): void {
    el.classList.remove('scrolls')
    const table = el.firstElementChild as HTMLElement
    const scrolls = table.scrollWidth > el.clientWidth + 1
    el.classList.toggle('scrolls', scrolls)
    this.fade(el)
  }

  private fade(el: HTMLElement): void {
    const more = el.scrollWidth - el.clientWidth - el.scrollLeft
    el.style.setProperty('--fade-r', more > 2 ? '36px' : '0px')
    el.classList.toggle('scrolled', el.scrollLeft > 2)
  }
}
