// The notes that link to this one, listed in the margin: the third tab beside
// the outline and the highlights. The app searches the vault for them (it
// finds the vault as a wikilink does) and sends each note's name with the
// lines where it links here. A click opens that note, as a link would.

export interface Backlink { name: string; href: string; lines: string[] }

export class LinksList {
  private box: HTMLElement
  private list: HTMLOListElement
  private status: HTMLElement
  /** Ask the app for the notes linking here. */
  request: () => void = () => {}
  /** Open a note (the host routes it like any link to a file). */
  onOpen: (href: string) => void = () => {}

  constructor(panel: HTMLElement) {
    this.box = document.createElement('div')
    this.box.className = 'links-side'
    this.status = document.createElement('p')
    this.status.className = 'links-status'
    this.list = document.createElement('ol')
    this.box.append(this.status, this.list)
    panel.append(this.box)
  }

  /** The tab came into view: look again, since notes elsewhere may have changed. */
  refresh(): void {
    // Keep what is shown while the vault is searched; say so only if there is nothing yet.
    if (!this.list.children.length) this.say('Looking through the vault…')
    this.request()
  }

  set(items: Backlink[], saved: boolean): void {
    this.list.replaceChildren()
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
      a.addEventListener('click', (e) => { e.preventDefault(); this.onOpen(it.href) })
      li.append(a)
      for (const line of it.lines) {
        const p = document.createElement('p')
        p.className = 'link-line'
        p.textContent = line
        li.append(p)
      }
      this.list.append(li)
    }
  }

  private say(text: string): void { this.status.textContent = text }
}
