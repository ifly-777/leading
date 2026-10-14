// Notes embedded with ![[Note]] or ![[Note#Heading]]: the parser leaves a
// placeholder holding the note's name, and this fills it with the note,
// rendered as the page is. The app finds the file in the vault and serves
// its text (SchemeHandler, leading://app/__wiki/…), so nothing here touches
// the file system.
//
// An embedded note is shown, not part of this file: its positions are
// removed, so a highlight or an edit can never land in it, and Find leaves
// it out. Embeds inside an embedded note stay links, so two notes that
// embed each other cannot loop.

import { renderMarkdown, slugify } from '../core/pipeline'

export class NoteEmbeds {
  /** The current document's id in the app's addresses (from its image base), or null. */
  private docId: string | null = null
  private imageBase: string | null = null
  /** Called after notes have been put in, so diagrams in them get drawn. */
  onFilled: () => void = () => {}

  constructor(private doc: HTMLElement) {}

  /** A new document: embeds are looked up beside it. */
  setDocument(imageBase: string | null | undefined): void {
    this.imageBase = imageBase ?? null
    this.docId = /\/doc\/([^/]+)\/$/.exec(imageBase ?? '')?.[1] ?? null
  }

  /** Fill every embed not yet filled. */
  scan(): void {
    if (!this.docId) return
    const todo = this.doc.querySelectorAll<HTMLElement>('.note-embed:not([data-filled])')
    for (const el of todo) {
      el.dataset.filled = 'loading'
      void this.fill(el)
    }
  }

  private async fill(el: HTMLElement): Promise<void> {
    const target = el.dataset.target ?? ''
    let text: string | null = null
    try {
      const r = await fetch(`/__wiki/${this.docId}/${encodeURIComponent(target)}`)
      if (r.ok) text = await r.text()
    } catch { /* not found: stays a link */ }
    if (!el.isConnected) return
    if (text === null) { el.dataset.filled = 'missing'; return }
    const body = document.createElement('div')
    body.className = 'note-embed-body'
    body.innerHTML = renderMarkdown(text, { imageBase: this.imageBase }).blocks.map((b) => b.html).join('')
    if (el.dataset.heading) keepSection(body, el.dataset.heading)
    unplace(body)
    el.append(body)
    el.dataset.filled = 'yes'
    this.onFilled()
  }
}

/** Keep only the section under the named heading: from it to the next heading at its level or above. */
function keepSection(body: HTMLElement, name: string): void {
  const want = slugify(name)
  const headings = Array.from(body.querySelectorAll<HTMLElement>(':scope > :is(h1,h2,h3,h4,h5,h6)'))
  const h = headings.find((x) => x.id === want || slugify(x.textContent ?? '') === want)
  if (!h) return
  const level = Number(h.tagName[1])
  const keep: Element[] = [h]
  for (let n = h.nextElementSibling; n; n = n.nextElementSibling) {
    if (/^H[1-6]$/.test(n.tagName) && Number(n.tagName[1]) <= level) break
    keep.push(n)
  }
  body.replaceChildren(...keep)
}

/** Remove everything that ties the copy to a file or the page: positions, ids, nested embeds. */
function unplace(body: HTMLElement): void {
  for (const el of body.querySelectorAll<HTMLElement>('*')) {
    el.removeAttribute('id')
    delete el.dataset.s; delete el.dataset.e; delete el.dataset.b
  }
  for (const inner of body.querySelectorAll<HTMLElement>('.note-embed')) {
    const link = inner.querySelector('.note-embed-title')
    if (link) inner.replaceWith(link)
  }
}
