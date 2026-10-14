// Footnotes beside their reference. Clicking a footnote number shows the note
// in a small card under the line, so the reader never leaves the page; the
// endnotes stay where they are for anyone who scrolls there (and ⌥-click
// still jumps to them). The card holds a copy of the note with its source
// positions removed: highlights are made in the endnote itself, which keeps
// its place in the file.

export class FootnotePopover {
  readonly el: HTMLElement
  private body: HTMLElement
  private ref: HTMLAnchorElement | null = null

  constructor(private win: HTMLElement, private scroller: HTMLElement) {
    this.el = document.createElement('aside')
    this.el.className = 'fn-pop'
    this.el.setAttribute('role', 'note')
    this.el.hidden = true
    this.body = document.createElement('div')
    // `.doc` gives the note the reading typography; `.fn-body` undoes the column geometry.
    this.body.className = 'doc fn-body'
    this.el.append(this.body)
    win.append(this.el)

    scroller.addEventListener('scroll', () => this.place(), { passive: true })
    new ResizeObserver(() => this.place()).observe(scroller)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) { e.preventDefault(); e.stopPropagation(); this.hide() }
    }, true)
    // A click anywhere else closes it; clicks on a footnote number are the caller's.
    document.addEventListener('mousedown', (e) => {
      const t = e.target as Element
      if (!this.el.hidden && !this.el.contains(t) && !t.closest?.('a[data-footnote-ref]')) this.hide()
    }, true)
  }

  get isOpen(): boolean { return !this.el.hidden }

  /** Show the note `ref` points to, or close it if it is already showing. False if there is no such note. */
  toggle(ref: HTMLAnchorElement): boolean {
    if (this.ref === ref && this.isOpen) { this.hide(); return true }
    const id = decodeURIComponent((ref.getAttribute('href') ?? '').slice(1))
    const note = id ? document.getElementById(id) : null
    if (!note || !this.scroller.contains(note)) return false
    const copy = note.cloneNode(true) as HTMLElement
    copy.querySelectorAll('[data-footnote-backref]').forEach((a) => a.remove())
    // No duplicate ids, and nothing that maps back into the file.
    for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
      el.removeAttribute('id')
      delete el.dataset.s; delete el.dataset.e; delete el.dataset.b
    }
    this.body.replaceChildren(...copy.childNodes)
    const n = document.createElement('span')
    n.className = 'fn-num'
    n.textContent = ref.textContent ?? ''
    this.body.firstElementChild?.prepend(n)
    this.ref = ref
    this.el.hidden = false
    this.place()
    return true
  }

  hide(): void {
    this.el.hidden = true
    this.ref = null
    this.body.replaceChildren()
  }

  /** Under the reference's line, within the column; above it when there is no room below. */
  private place(): void {
    const ref = this.ref
    if (!ref || this.el.hidden) return
    const win = this.win.getBoundingClientRect()
    const view = this.scroller.getBoundingClientRect()
    const r = ref.getBoundingClientRect()
    // Scrolled out of sight, or the page was re-rendered under it: close.
    if (!ref.isConnected || r.bottom < view.top || r.top > view.bottom) { this.hide(); return }
    const css = getComputedStyle(document.documentElement)
    const colLeft = parseFloat(css.getPropertyValue('--col-left')) || 0
    const colW = parseFloat(css.getPropertyValue('--col-w')) || view.width
    const w = Math.min(colW, 34 * parseFloat(getComputedStyle(this.body).fontSize))
    this.el.style.width = `${w}px`
    const left = Math.max(colLeft, Math.min(r.left - win.left - w / 2, colLeft + colW - w))
    this.el.style.left = `${left}px`
    // The line box, not the superscript, so the card clears the whole line.
    const line = ref.closest('p, li, td, th, dd, blockquote, h1, h2, h3, h4, h5, h6') ?? ref
    const lineHeight = parseFloat(getComputedStyle(line).lineHeight) || r.height
    const below = r.bottom - win.top + lineHeight * 0.35
    const h = this.el.offsetHeight
    const top = below + h > win.height - 12 ? r.top - win.top - lineHeight * 0.35 - h : below
    this.el.style.top = `${Math.max(0, top)}px`
  }
}
