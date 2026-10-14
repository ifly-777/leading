// The outline: a quiet list of headings in the right margin. It marks the
// section being read, jumps on click, collapses sub-sections, and filters as
// you type when opened from the keyboard.

import type { OutlineItem } from '../core/pipeline'
import { foldQuery, fold } from '../core/fold'
import { topIn } from './geometry'

interface Node { item: OutlineItem; li: HTMLLIElement; a: HTMLAnchorElement; children: Node[] }

export class OutlinePanel {
  private items: OutlineItem[] = []
  private flat: Node[] = []
  private current: Node | null = null
  private selected = -1
  private input: HTMLInputElement
  private list: HTMLOListElement
  private openedForTyping = false
  private raf = 0
  /** Finds a heading's element; with `force`, paints it first if the loader has not reached it. */
  locate: (item: OutlineItem, force: boolean) => HTMLElement | null = () => null
  onClose: () => void = () => {}

  constructor(public el: HTMLElement, private scroller: HTMLElement) {
    el.setAttribute('aria-label', 'Outline')
    el.setAttribute('role', 'navigation')
    this.input = document.createElement('input')
    this.input.placeholder = 'Filter headings'
    this.input.setAttribute('aria-label', 'Filter headings')
    this.input.hidden = true
    this.list = document.createElement('ol')
    el.append(this.input, this.list)
    this.input.addEventListener('input', () => this.filter())
    this.input.addEventListener('keydown', (e) => this.onKey(e))
    scroller.addEventListener('scroll', () => this.schedule(), { passive: true })
  }

  setItems(items: OutlineItem[], maxDepth = 3): void {
    this.items = items.filter((i) => i.depth <= maxDepth)
    this.flat = []
    this.list.replaceChildren()
    if (!this.items.length) {
      const p = document.createElement('li')
      p.className = 'empty'
      p.textContent = 'No headings'
      this.list.append(p)
      return
    }
    // Nest by depth; a jump from H1 to H3 nests the H3 directly under the H1.
    const roots: Node[] = []
    const stack: Node[] = []
    for (const item of this.items) {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.textContent = item.text
      a.title = item.text
      a.tabIndex = -1
      a.addEventListener('click', (e) => { e.preventDefault(); this.jump(item) })
      li.append(a)
      const node: Node = { item, li, a, children: [] }
      while (stack.length && stack[stack.length - 1].item.depth >= item.depth) stack.pop()
      const parent = stack[stack.length - 1]
      if (parent) {
        let ol = parent.li.querySelector(':scope > ol') as HTMLOListElement | null
        if (!ol) { ol = document.createElement('ol'); parent.li.append(ol); this.addFold(parent) }
        ol.append(li)
        parent.children.push(node)
      } else {
        this.list.append(li)
        roots.push(node)
      }
      stack.push(node)
      this.flat.push(node)
    }
    this.current = null
    this.schedule()
  }

  private addFold(n: Node): void {
    const f = document.createElement('span')
    f.className = 'fold'
    f.textContent = '▾'
    f.setAttribute('role', 'button')
    f.setAttribute('aria-label', 'Collapse section')
    f.addEventListener('click', (e) => {
      e.stopPropagation()
      const ol = n.li.querySelector(':scope > ol') as HTMLElement
      ol.hidden = !ol.hidden
      f.classList.toggle('closed', ol.hidden)
      f.setAttribute('aria-label', ol.hidden ? 'Expand section' : 'Collapse section')
    })
    n.li.prepend(f)
  }

  /** Open with keyboard focus in the filter box. */
  focusForTyping(): void {
    this.openedForTyping = true
    this.input.hidden = false
    this.input.value = ''
    this.filter()
    this.input.focus()
  }

  private filter(): void {
    const q = foldQuery(this.input.value.trim())
    let first = -1
    this.flat.forEach((n, i) => {
      const hit = !q || fold(n.item.text).text.includes(q)
      n.a.style.display = hit ? '' : 'none'
      if (hit && first < 0) first = i
    })
    this.select(q ? first : this.flat.indexOf(this.current!))
  }

  private select(i: number): void {
    this.flat[this.selected]?.a.classList.remove('selected')
    this.selected = i
    const n = this.flat[i]
    if (n) { n.a.classList.add('selected'); n.a.scrollIntoView({ block: 'nearest' }) }
  }

  private onKey(e: KeyboardEvent): void {
    const visible = this.flat.map((n, i) => [n, i] as const).filter(([n]) => n.a.style.display !== 'none').map(([, i]) => i)
    const pos = visible.indexOf(this.selected)
    if (e.key === 'ArrowDown') { e.preventDefault(); this.select(visible[Math.min(visible.length - 1, pos + 1)] ?? -1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.select(visible[Math.max(0, pos - 1)] ?? -1) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const n = this.flat[this.selected]
      if (n) this.jump(n.item)
      this.endTyping()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      const close = this.openedForTyping
      this.endTyping()
      if (close) this.onClose()
    }
  }

  private endTyping(): void {
    this.input.hidden = true
    this.input.value = ''
    this.filter()
    this.flat.forEach((n) => (n.a.style.display = ''))
    this.openedForTyping = false
    this.scroller.focus({ preventScroll: true })
  }

  /** Go to a heading. Reading mode scrolls to its element; edit mode replaces this with a jump in the source. */
  jumpTo: (item: OutlineItem) => void = (item) => {
    const h = this.locate(item, true)
    if (!h) return
    // Land the heading a little below the top; no animation, so it stays calm.
    // offsetTop (relative to the scroller) avoids rect queries, which are slow on long pages.
    this.scroller.scrollTo({ top: Math.max(0, topIn(h, this.scroller) - this.scroller.clientHeight * 0.12) })
  }

  /** Index of the heading of the section being read. Edit mode replaces this too. */
  currentIndex: (items: OutlineItem[]) => number = (items) => {
    const line = this.scroller.scrollTop + this.scroller.clientHeight * 0.3
    // Headings are in document order, so their tops increase: binary search.
    let lo = 0, hi = items.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const h = this.locate(items[mid], false)
      if (!h) { hi = mid - 1; continue } // not rendered yet: it is further down
      if (topIn(h, this.scroller) <= line) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    return found
  }

  /** Called before every jump from the outline, so the view can offer a way back. */
  beforeJump: () => void = () => {}
  private jump(item: OutlineItem): void { this.beforeJump(); this.jumpTo(item) }

  // The reading-mode behaviour, kept so edit mode can hand it back.
  private readonly readingJump = this.jumpTo
  private readonly readingCurrent = this.currentIndex
  useReadingMode(): void { this.jumpTo = this.readingJump; this.currentIndex = this.readingCurrent }

  private watched = new WeakSet<HTMLElement>()
  /** Follow scrolling in another element too (the editor's scroller). */
  watch(scroller: HTMLElement): void {
    if (this.watched.has(scroller)) return
    this.watched.add(scroller)
    scroller.addEventListener('scroll', () => this.schedule(), { passive: true })
  }

  private schedule(): void {
    if (this.raf || this.el.hidden || !this.flat.length) return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.updateCurrent() })
  }

  /** The current section is the last heading above a line ~30% down the window. */
  updateCurrent(): void {
    const found = this.flat.length ? this.currentIndex(this.flat.map((n) => n.item)) : -1
    const next = this.flat[found] ?? null
    if (next === this.current) return
    this.current?.a.classList.remove('current')
    this.current?.a.removeAttribute('aria-current')
    this.current = next
    if (next) {
      next.a.classList.add('current')
      next.a.setAttribute('aria-current', 'location')
      if (!this.el.matches(':hover')) next.a.scrollIntoView({ block: 'nearest' })
    }
  }
}
