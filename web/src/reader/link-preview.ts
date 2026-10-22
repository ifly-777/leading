// A glance at a linked note: rest the pointer on a wikilink, or on a link to
// another Markdown file, and the note's opening (or the section the link
// names) appears in a card under the line, like a footnote. Links to a
// section of this note ([[#Heading]], [text](#heading)) show that section. Moving onto the
// card keeps it open, so it can be scrolled; moving away closes it.

import { placeCard } from './footnote-popover'
import type { NoteEmbeds } from './embeds'

const OPEN_DELAY = 450 // ms of rest before a card appears: passing over a link shows nothing
const CLOSE_DELAY = 250 // ms to cross the gap from the link to the card
const MAX_BLOCKS = 30 // a preview is a glance, not the whole note

/** The note and heading a link points at, or null if it is not a link to a note. */
export function linkTarget(el: Element): { target: string; heading?: string } | null {
  const dec = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
  const wiki = el.closest<HTMLElement>('.wikilink')
  if (wiki && !wiki.closest('.note-embed')) {
    // [[Note]], [[Note#Heading]], or [[#Heading]] in this note (an empty target).
    const target = wiki.dataset.target ?? ''
    const heading = wiki.dataset.heading || undefined
    return target || heading ? { target, heading } : null
  }
  const a = el.closest<HTMLAnchorElement>('a[href]')
  const href = a?.getAttribute('href')
  // Footnote numbers have their own card.
  if (!href || a!.hasAttribute('data-footnote-ref') || a!.hasAttribute('data-footnote-backref')) return null
  // [text](#heading): a section of this note.
  if (href.startsWith('#')) return href.length > 1 ? { target: '', heading: dec(href.slice(1)) } : null
  // Otherwise relative links to Markdown files only: never web addresses.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null
  const [path, frag] = href.split('#', 2)
  if (!/\.(md|markdown|mdown|mkd|mkdn|txt)$/i.test(path)) return null
  return { target: dec(path), heading: frag ? dec(frag) : undefined }
}

export class LinkPreview {
  readonly el: HTMLElement
  private body: HTMLElement
  private ref: Element | null = null
  private openTimer = 0
  private closeTimer = 0
  /** Bumped on every new hover, so a slow fetch for an old link never shows. */
  private gen = 0

  constructor(private win: HTMLElement, private scroller: HTMLElement, private doc: HTMLElement, private embeds: NoteEmbeds) {
    this.el = document.createElement('aside')
    this.el.className = 'fn-pop link-pop'
    this.el.hidden = true
    this.body = document.createElement('div')
    this.body.className = 'doc fn-body'
    this.el.append(this.body)
    win.append(this.el)

    doc.addEventListener('mouseover', (e) => this.over(e.target as Element))
    doc.addEventListener('mouseout', (e) => { if (this.ref && !this.ref.contains(e.relatedTarget as Node)) this.leave() })
    this.el.addEventListener('mouseenter', () => clearTimeout(this.closeTimer))
    this.el.addEventListener('mouseleave', () => this.leave())
    scroller.addEventListener('scroll', () => { if (!this.el.hidden && !placeCard(this.el, this.body, this.ref!, win, scroller)) this.hide() }, { passive: true })
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.el.hidden) { e.preventDefault(); e.stopPropagation(); this.hide() } }, true)
    // Clicking follows the link, which is the page's business; the card just goes.
    doc.addEventListener('mousedown', () => this.hide())
  }

  get isOpen(): boolean { return !this.el.hidden }

  private over(t: Element): void {
    const link = t.closest?.('.wikilink, a[href]')
    if (!link || link === this.ref) { if (link) clearTimeout(this.closeTimer); return }
    const where = linkTarget(link)
    if (!where) return
    clearTimeout(this.openTimer)
    clearTimeout(this.closeTimer)
    const gen = ++this.gen
    this.openTimer = window.setTimeout(() => void this.show(link, where.target, where.heading, gen), OPEN_DELAY)
    this.ref = link
  }

  private leave(): void {
    clearTimeout(this.openTimer)
    clearTimeout(this.closeTimer)
    this.closeTimer = window.setTimeout(() => this.hide(), CLOSE_DELAY)
  }

  /** Show the preview for `link` now (also for tests). */
  async show(link: Element, target: string, heading: string | undefined, gen = ++this.gen): Promise<boolean> {
    // A wikilink the vault has no note for: say so, rather than show nothing.
    let copy: Element | null
    if (link.classList.contains('wiki-missing')) {
      copy = document.createElement('div')
      const p = document.createElement('p')
      p.className = 'link-missing'
      p.textContent = `No note named “${target}” in this vault.`
      copy.append(p)
    } else {
      copy = await this.embeds.note(target, heading, MAX_BLOCKS)
    }
    if (gen !== this.gen) return false
    // Nothing to show for this link: close the card an earlier link left open.
    if (!copy || !link.isConnected) { this.hide(); return false }
    this.ref = link
    this.body.replaceChildren(...copy.childNodes)
    this.el.hidden = false
    this.el.scrollTop = 0
    if (!placeCard(this.el, this.body, link, this.win, this.scroller)) { this.hide(); return false }
    return true
  }

  hide(): void {
    clearTimeout(this.openTimer)
    clearTimeout(this.closeTimer)
    this.gen++
    this.ref = null
    if (this.el.hidden) return
    this.el.hidden = true
    this.body.replaceChildren()
  }
}
