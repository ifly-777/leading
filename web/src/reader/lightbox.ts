// A picture or diagram, enlarged: click one and it fills the window, on the
// theme's paper; click again, or press Escape, and it goes. A figure set at
// column width is often too small to read, and a note should not have to be
// left to see it properly.

export class Lightbox {
  readonly el: HTMLElement
  private stage: HTMLElement
  private caption: HTMLElement
  /** Only while reading. */
  active = () => true

  constructor(win: HTMLElement, doc: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'lightbox'
    this.el.hidden = true
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-modal', 'true')
    this.stage = document.createElement('div')
    this.stage.className = 'lightbox-stage'
    this.caption = document.createElement('p')
    this.caption.className = 'lightbox-caption'
    this.el.append(this.stage, this.caption)
    win.append(this.el)
    this.el.addEventListener('click', () => this.hide())
    document.addEventListener('keydown', (e) => {
      if (this.el.hidden) return
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.hide() }
    }, true)
    doc.addEventListener('click', (e) => {
      const t = e.target as Element
      // A picture that is a link goes where it links; a drag that selected text is a selection.
      if (!this.active() || t.closest('a[href], .wikilink') || !window.getSelection()?.isCollapsed) return
      const img = t.closest<HTMLImageElement>('img')
      if (img && img.naturalWidth) { this.showImage(img); return }
      const svg = t.closest('figure.diagram')?.querySelector('svg')
      if (svg) this.showSvg(svg)
    })
  }

  get isOpen(): boolean { return !this.el.hidden }

  showImage(img: HTMLImageElement): void {
    const big = document.createElement('img')
    big.src = img.currentSrc || img.src
    big.alt = img.alt
    // Never past the picture's own size: a small icon is not blown up into a blur.
    big.style.maxWidth = `min(100%, ${img.naturalWidth}px)`
    big.style.maxHeight = `min(100%, ${img.naturalHeight}px)`
    this.open(big, img.alt && !/\.(png|jpe?g|gif|webp|svg|heic|heif|avif|tiff?|bmp)$/i.test(img.alt) ? img.alt : '')
  }

  showSvg(svg: SVGSVGElement): void {
    const copy = svg.cloneNode(true) as SVGSVGElement
    // Mermaid fixes a diagram's width; here it scales to the window instead.
    copy.removeAttribute('width')
    copy.removeAttribute('height')
    copy.style.maxWidth = ''
    copy.classList.add('lightbox-svg')
    this.open(copy, '')
  }

  private open(content: Element, caption: string): void {
    this.stage.replaceChildren(content)
    this.caption.textContent = caption
    this.caption.hidden = !caption
    this.el.hidden = false
  }

  hide(): void {
    if (this.el.hidden) return
    this.el.hidden = true
    this.stage.replaceChildren()
  }
}
