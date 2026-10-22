// The notes that link to this one, listed in the margin: the third tab beside
// the outline and the highlights. The app searches the vault for them (it
// finds the vault as a wikilink does) and sends each note's name with the
// lines where it links here. A click opens that note, as a link would.

export interface Backlink { name: string; href: string; lines: string[]; offsets?: number[] }

export class LinksList {
  private box: HTMLElement
  private list: HTMLOListElement
  private status: HTMLElement
  /** Ask the app for the notes linking here. */
  request: () => void = () => {}
  /** Open a note (the host routes it like any link to a file). */
  onOpen: (href: string) => void = () => {}
  /** Open a note at a line: where it links here. */
  onOpenAt: (href: string, s: number) => void = () => {}

  constructor(panel: HTMLElement) {
    this.box = document.createElement('div')
    this.box.className = 'links-side'
    this.status = document.createElement('p')
    this.status.className = 'links-status'
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')
    this.list = document.createElement('ol')
    this.box.append(this.status, this.list)
    panel.append(this.box)
  }

  /** The tab came into view: look again, since notes elsewhere may have changed. */
  refresh(): void {
    // Keep what is shown while the vault is searched, faded, so it is clear a fresh list is coming.
    if (!this.list.children.length) this.say('Looking through the vault…')
    this.box.setAttribute('aria-busy', 'true')
    this.request()
  }

  set(items: Backlink[], saved: boolean): void {
    this.list.replaceChildren()
    this.box.removeAttribute('aria-busy')
    if (!saved) { this.say('Save this note to see the notes that link to it.'); return }
    if (!items.length) { this.say('No other note links here.'); return }
    this.say(`${items.length} note${items.length === 1 ? '' : 's'} link${items.length === 1 ? 's' : ''} here`)
    for (const it of items) {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.className = 'link-item'
      a.textContent = it.name
      a.title = `Open ${it.name}`
      a.href = '#'
      const at = it.offsets?.[0]
      a.addEventListener('click', (e) => { e.preventDefault(); if (at !== undefined) this.onOpenAt(it.href, at); else this.onOpen(it.href) })
      li.append(a)
      it.lines.forEach((line, i) => {
        // Each line opens the note there, where it links here.
        const s = it.offsets?.[i]
        const p = document.createElement(s === undefined ? 'p' : 'a')
        p.className = 'link-line'
        p.textContent = line
        if (s !== undefined) {
          (p as HTMLAnchorElement).href = '#'
          p.addEventListener('click', (e) => { e.preventDefault(); this.onOpenAt(it.href, s) })
        }
        li.append(p)
      })
      this.list.append(li)
    }
  }

  private say(text: string): void { this.status.textContent = text }
}
