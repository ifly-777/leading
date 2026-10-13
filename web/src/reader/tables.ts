// Table behaviour in reading mode.
//
// - Tables wider than the window scroll sideways as a last resort: the first
//   column stays pinned and the right edge fades while there is more to see.
// - A header normally sticks to the top of the window with plain CSS. That
//   cannot work for a table that scrolls sideways (the two cancel out), so
//   those get a floating copy of the header, kept in step with the table.
// - Double-click a table for a full-window focus view.
// - tableToCSV() serves "Copy as CSV".

export class TableWatcher {
  private io: IntersectionObserver
  private seen = new WeakSet<Element>()
  private visible = new Set<HTMLElement>()
  private float: HTMLElement
  private floatFor: HTMLElement | null = null
  private raf = 0
  /** The table under the pointer, for the right-click menu. */
  hovered: HTMLTableElement | null = null
  onHoverChange: (overTable: boolean) => void = () => {}

  constructor(private scroller: HTMLElement, private win: HTMLElement, private frame: HTMLElement) {
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement
        if (e.isIntersecting) { this.check(el); this.visible.add(el) } else this.visible.delete(el)
      }
      this.schedule()
    }, { root: scroller, rootMargin: '1200px 0px' })
    this.float = document.createElement('div')
    this.float.className = 'float-head'
    this.float.hidden = true
    this.float.setAttribute('aria-hidden', 'true') // a visual copy; the real header is in the table
    win.append(this.float)
    scroller.addEventListener('scroll', () => this.schedule(), { passive: true })
    scroller.addEventListener('dblclick', (e) => {
      const t = (e.target as Element).closest?.('.doc table') as HTMLTableElement | null
      if (t) { window.getSelection()?.removeAllRanges(); this.focus(t) }
    })
    scroller.addEventListener('pointerover', (e) => {
      const t = ((e.target as Element).closest?.('.doc table') as HTMLTableElement | null) ?? null
      if (t !== this.hovered) {
        const was = !!this.hovered
        this.hovered = t
        if (was !== !!t) this.onHoverChange(!!t)
      }
    })
  }

  /** Watch any tables added since the last call. */
  scan(doc: HTMLElement): void {
    doc.querySelectorAll('.table-scroll').forEach((el) => {
      if (this.seen.has(el)) return
      this.seen.add(el)
      this.io.observe(el)
      el.addEventListener('scroll', () => { this.fade(el as HTMLElement); this.schedule() }, { passive: true })
    })
  }

  /** Re-check tables after a layout change (font size, window width…). */
  recheckAll(doc: HTMLElement): void {
    doc.querySelectorAll<HTMLElement>('.table-scroll').forEach((el) => this.check(el))
    this.floatFor = null
    this.schedule()
  }

  private check(el: HTMLElement): void {
    el.classList.remove('scrolls')
    const table = el.firstElementChild as HTMLElement
    el.classList.toggle('scrolls', table.scrollWidth > el.clientWidth + 1)
    this.fade(el)
  }

  private fade(el: HTMLElement): void {
    const more = el.scrollWidth - el.clientWidth - el.scrollLeft
    el.style.setProperty('--fade-r', more > 2 ? '36px' : '0px')
    el.classList.toggle('scrolled', el.scrollLeft > 2)
  }

  private schedule(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.updateFloat() })
  }

  /** Show a floating header for a sideways-scrolling table whose own header has scrolled out of view. */
  private updateFloat(): void {
    // Measured through the empty frame overlay, never the window element itself
    // (a rect query on an ancestor of the document is slow on long pages).
    const box = this.frame.getBoundingClientRect()
    // Below anything covering the page's top edge (the app's title bar).
    const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top')) || 0
    const top = box.top + inset
    let target: HTMLElement | null = null
    for (const el of this.visible) {
      if (!el.classList.contains('scrolls')) continue
      const thead = el.querySelector('thead')
      if (!thead) continue
      const r = el.getBoundingClientRect()
      const h = thead.getBoundingClientRect().height
      if (r.top < top && r.bottom > top + h * 2) { target = el; break }
    }
    if (!target) { this.float.hidden = true; this.floatFor = null; return }
    const r = target.getBoundingClientRect()
    if (this.floatFor !== target) {
      // Rebuild the copy, fixing each column to the real table's width.
      const table = target.querySelector('table')!
      const copy = table.cloneNode(false) as HTMLTableElement
      const thead = table.querySelector('thead')!.cloneNode(true) as HTMLElement
      const real = table.querySelectorAll('thead th')
      thead.querySelectorAll('th').forEach((th, i) => {
        const w = (real[i] as HTMLElement).getBoundingClientRect().width
        th.style.minWidth = th.style.maxWidth = th.style.width = w + 'px'
        th.style.boxSizing = 'border-box'
      })
      copy.style.width = table.getBoundingClientRect().width + 'px'
      copy.append(thead)
      const inner = document.createElement('div')
      inner.className = 'table-scroll scrolls'
      inner.append(copy)
      this.float.replaceChildren(inner)
      this.floatFor = target
    }
    this.float.hidden = false
    this.float.style.left = r.left - box.left + 'px'
    this.float.style.width = r.width + 'px'
    this.float.style.top = inset + 'px'
    const inner = this.float.firstElementChild as HTMLElement
    inner.scrollLeft = target.scrollLeft
    inner.classList.toggle('scrolled', target.scrollLeft > 2)
  }

  /** Full-window view of one table; Esc or the close button returns to the page. */
  focus(table: HTMLTableElement): void {
    const overlay = document.createElement('div')
    overlay.className = 'table-focus'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-label', 'Table')
    overlay.innerHTML = `<div class="tf-bar"><button class="tf-csv">Copy as CSV</button><button class="tf-close" aria-label="Close">Close</button></div><div class="tf-body doc"></div>`
    overlay.querySelector('.tf-body')!.append(table.cloneNode(true))
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); this.scroller.focus({ preventScroll: true }) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
    overlay.querySelector('.tf-close')!.addEventListener('click', close)
    overlay.querySelector('.tf-csv')!.addEventListener('click', () => this.onCopyCSV(tableToCSV(table)))
    document.addEventListener('keydown', onKey, true)
    this.win.append(overlay)
    ;(overlay.querySelector('.tf-close') as HTMLElement).focus()
  }

  /** The host decides how CSV reaches the clipboard (native pasteboard in the app). */
  onCopyCSV: (csv: string) => void = (csv) => { navigator.clipboard?.writeText(csv).catch(() => {}) }
}

/** A table as CSV (RFC 4180): fields quoted when they hold commas, quotes or line breaks. */
export function tableToCSV(table: HTMLTableElement): string {
  const field = (s: string) => {
    const v = s.replace(/\s+/g, ' ').trim()
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
  }
  return Array.from(table.rows).map((row) => Array.from(row.cells).map((c) => field(c.textContent ?? '')).join(',')).join('\n') + '\n'
}
