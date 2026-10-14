// Mermaid diagrams, drawn on the page. The parser leaves each ```mermaid
// fence as <figure class="diagram"> holding its source; this draws the SVG
// beside it. Mermaid measures text in the page, so it cannot run in the
// parsing workers, and it is large, so it loads only when a document has a
// diagram (it is bundled with the app: nothing comes from the network).
//
// Diagrams near the window are drawn first, the rest as they come within
// reach. A diagram above the window that changes height while drawing must
// not move the line being read: current WebKit anchors the scroll itself
// (overflow-anchor); older engines get the page moved by the change here.

import { fingerprint } from '../core/hash'

type Mermaid = typeof import('mermaid').default

const NATIVE_ANCHORING = typeof CSS !== 'undefined' && CSS.supports('overflow-anchor', 'auto')

export class Diagrams {
  private mermaid: Promise<Mermaid> | null = null
  private io: IntersectionObserver
  /** Drawn SVG by (source, look): redrawing after a highlight or a theme change back is instant. */
  private cache = new Map<string, string>()
  /** Fonts and colours the diagrams are drawn in; a change redraws them all. */
  private look = ''
  private lookVars: Record<string, unknown> = {}
  /** Mermaid draws one diagram at a time. */
  private chain: Promise<void> = Promise.resolve()
  private count = 0
  /** For tests: resolves when every diagram currently queued is drawn. */
  get settled(): Promise<void> { return this.chain }

  constructor(private doc: HTMLElement, private scroller: HTMLElement) {
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { this.io.unobserve(e.target); this.queue(e.target as HTMLElement) }
    }, { root: scroller, rootMargin: '1500px 0px' })
  }

  /** Watch diagrams not yet drawn in the current look (after a load, a patch, or new blocks). */
  scan(): void {
    for (const fig of this.doc.querySelectorAll<HTMLElement>('figure.diagram')) {
      if (fig.dataset.look !== this.look) this.io.observe(fig)
    }
  }

  /** Draw every diagram now, near or far (for printing), and wait until all are drawn. */
  async drawAll(): Promise<void> {
    for (const fig of this.doc.querySelectorAll<HTMLElement>('figure.diagram')) {
      if (fig.dataset.look !== this.look) { this.io.unobserve(fig); this.queue(fig) }
    }
    await this.chain
  }

  /** The page's colours or font changed: draw every diagram again to match. */
  restyle(): void {
    const css = getComputedStyle(document.documentElement)
    const v = (name: string) => css.getPropertyValue(name).trim()
    const dark = document.documentElement.dataset.theme === 'dark'
    const vars = {
      darkMode: dark,
      background: v('--bg'),
      fontFamily: v('--font-body'),
      fontSize: '15px',
      // Boxes in the code-block shade, edged and joined in the muted ink.
      primaryColor: v('--code-bg'),
      primaryTextColor: v('--fg'),
      primaryBorderColor: v('--muted'),
      secondaryColor: v('--bg'),
      tertiaryColor: v('--bg'),
      lineColor: v('--muted'),
      textColor: v('--fg'),
      noteBkgColor: v('--code-bg'),
      noteTextColor: v('--fg'),
      noteBorderColor: v('--rule'),
      clusterBkg: v('--bg'),
      clusterBorder: v('--rule'),
      edgeLabelBackground: v('--bg'),
      actorBkg: v('--code-bg'),
      actorBorder: v('--muted'),
      actorTextColor: v('--fg'),
      signalColor: v('--fg'),
      signalTextColor: v('--fg'),
    }
    const look = JSON.stringify(vars)
    if (look === this.look) return
    this.look = look
    this.lookVars = vars
    this.scan()
  }

  private queue(fig: HTMLElement): void {
    this.chain = this.chain.then(() => this.draw(fig)).catch(() => {})
  }

  private load(): Promise<Mermaid> {
    this.mermaid ??= import('mermaid').then((m) => m.default)
    return this.mermaid
  }

  private async draw(fig: HTMLElement): Promise<void> {
    const look = this.look
    if (!fig.isConnected || fig.dataset.look === look) return
    const src = fig.querySelector('pre.diagram-src')?.textContent ?? ''
    const key = fingerprint(src) + ':' + fingerprint(look)
    let svg = this.cache.get(key)
    let error = ''
    if (!svg) {
      const mermaid = await this.load()
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: this.lookVars, fontFamily: this.lookVars.fontFamily as string })
      try {
        svg = (await mermaid.render(`leading-diagram-${++this.count}`, src)).svg
        this.cache.set(key, svg)
      } catch (e) {
        error = String((e as Error)?.message ?? e).split('\n')[0]
      }
      // Mermaid leaves its measuring element behind when a diagram fails.
      document.getElementById(`dleading-diagram-${this.count}`)?.remove()
    }
    if (!fig.isConnected || look !== this.look) return
    this.keepPlace(fig, () => {
      fig.querySelector('.diagram-svg, .diagram-error')?.remove()
      const out = document.createElement('div')
      if (svg) {
        out.className = 'diagram-svg'
        out.innerHTML = svg
        fig.classList.add('drawn')
      } else {
        out.className = 'diagram-error'
        out.textContent = `Diagram could not be drawn: ${error}`
        fig.classList.remove('drawn')
      }
      fig.append(out)
      fig.dataset.look = look
    })
  }

  /** Change a figure; if it is above the window, move the page by its change in height. */
  private keepPlace(fig: HTMLElement, change: () => void): void {
    // The engine keeps the place itself; doing it here too would move the page twice.
    if (NATIVE_ANCHORING) { change(); return }
    const top = this.scroller.getBoundingClientRect().top
    const above = fig.getBoundingClientRect().bottom <= top + 1
    const before = fig.offsetHeight
    change()
    if (above) this.scroller.scrollTop += fig.offsetHeight - before
  }
}
