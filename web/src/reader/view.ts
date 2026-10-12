// The reading view: everything one window shows, wired together. Used by the
// Mac app's page (app/main.ts) and by the Stage 1 prototype, so both run the
// same code. The host decides where settings live and how commands arrive.

import { DEFAULTS, TUNING, MEASURE_CHARS, RANGES, applySettings, resolveTheme, type Settings, type Tuning, type Measure, type Theme } from '../core/settings'
import type { RenderOptions } from '../core/pipeline'
import { Reader, type LoadResult } from './render'
import { computeLayout, applyLayout, type LayoutResult } from './layout'
import { avgCharEm } from './measure'
import { OutlinePanel } from './outline'
import { FindBar } from './find'
import { TableWatcher } from './tables'
import { topIn } from './geometry'

export interface ViewElements {
  win: HTMLElement; scroller: HTMLElement; doc: HTMLElement; layer: HTMLElement
  ticks: HTMLElement; frame: HTMLElement; outline: HTMLElement
}

export interface OpenOptions extends RenderOptions {
  /** Show the file as plain text instead of rendering Markdown (for .txt files) */
  plain?: boolean
  /** Keep the reader's place (reload after the file changed on disk) */
  keepPlace?: boolean
}

export type Command =
  | 'find' | 'findNext' | 'findPrevious' | 'toggleOutline' | 'bigger' | 'smaller' | 'actualSize'
  | 'narrower' | 'wider' | 'cycleTheme'

const MEASURES: Measure[] = ['narrow', 'medium', 'wide']
const THEMES: Exclude<Theme, 'system'>[] = ['light', 'sepia', 'dark']

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

export class ReaderView {
  readonly reader: Reader
  readonly outline: OutlinePanel
  readonly find: FindBar
  readonly tables: TableWatcher
  settings: Settings = clone(DEFAULTS)
  tuning: Tuning = clone(TUNING)
  /** WCAG 1.4.12 check: override spacing with the criterion's own values */
  wcag = false
  layout: LayoutResult | null = null
  /** The view changed a setting itself (a shortcut, or Esc closing the outline); the host should save it. */
  onSettingsChanged: (s: Settings) => void = () => {}
  private avg = 0.5
  private avgKey = ''
  private dark = matchMedia('(prefers-color-scheme: dark)')
  private root = document.documentElement

  constructor(private els: ViewElements) {
    const { win, scroller, doc, layer, ticks, frame, outline } = els
    this.reader = new Reader(doc)
    this.outline = new OutlinePanel(outline, scroller)
    this.find = new FindBar(win, scroller, doc, layer, ticks, frame)
    this.tables = new TableWatcher(scroller, win, frame)

    this.outline.locate = (item, force) => {
      const blk = this.reader.blockEl(item.b, force)
      if (!blk) return null
      // Most headings are blocks themselves; some sit inside a callout or list.
      return blk.matches('h1,h2,h3,h4,h5,h6') ? blk : blk.querySelector<HTMLElement>(`:is(h1,h2,h3,h4,h5,h6)[data-s="${item.s}"]`)
    }
    this.outline.onClose = () => this.change({ outlineOpen: false })
    this.find.blockY = (b) => this.reader.blockY(b, scroller)
    this.find.index = () => this.reader.index
    this.find.getBlock = (b, force) => this.reader.blockEl(b, force)
    this.find.onLayoutShift = () => this.reader.invalidateGeometry()
    this.reader.onIndexGrew = () => this.find.invalidate()
    this.reader.onBlocksAdded = () => this.reader.invalidateGeometry()

    new ResizeObserver(() => this.relayout()).observe(scroller)
    this.dark.addEventListener('change', () => this.apply())
  }

  private effective(): Settings {
    const s = this.settings
    return this.wcag ? { ...s, lineHeight: Math.max(1.5, s.lineHeight), letterSpacing: 0.12, wordSpacing: 0.16, paragraphStyle: 'space', paragraphSpacing: 2 } : s
  }

  /** Apply the current settings: CSS variables, line-length calibration, layout. */
  async apply(): Promise<void> {
    const s = this.effective()
    const opts = () => ({ prefersDark: this.dark.matches, avgCharEm: this.avg })
    applySettings(this.root, s, this.tuning, opts())
    // Recalibrate the measure only when something that changes character widths changed.
    const key = [getComputedStyle(this.els.doc).fontFamily, s.letterSpacing, s.wordSpacing, this.root.style.getPropertyValue('--weight')].join('|')
    if (key !== this.avgKey) {
      this.avgKey = key
      this.avg = await avgCharEm(this.els.doc)
      applySettings(this.root, s, this.tuning, opts())
    }
    this.relayout()
  }

  /** Change some settings from inside the view, apply them, and tell the host. */
  async change(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch }
    await this.apply()
    this.onSettingsChanged(this.settings)
  }

  relayout(): void {
    const s = this.effective()
    const r = computeLayout({
      width: this.els.scroller.clientWidth, fontPx: s.size,
      measureEm: MEASURE_CHARS[s.measure] * this.avg, narrowEm: MEASURE_CHARS.narrow * this.avg, outlineOpen: s.outlineOpen,
    })
    this.layout = r
    applyLayout(this.root, r)
    const o = this.outline.el
    o.hidden = r.outline === 'hidden'
    o.classList.toggle('popover', r.outline === 'popover')
    this.tables.recheckAll(this.els.doc)
    this.reader.invalidateGeometry()
    this.outline.updateCurrent()
    this.find.draw()
  }

  get theme(): 'light' | 'sepia' | 'dark' { return resolveTheme(this.settings.theme, this.dark.matches) }

  get charsPerLine(): number { return this.layout ? this.layout.colW / this.effective().size / this.avg : 0 }

  /** Show a document. Returns null if a newer open replaced this one. */
  async open(src: string, opts: OpenOptions = {}): Promise<LoadResult | null> {
    const { scroller, doc } = this.els
    const place = opts.keepPlace ? this.placeMark() : null
    if (!opts.keepPlace) scroller.scrollTop = 0
    let result: LoadResult | null
    if (opts.plain) {
      result = this.reader.showPlain(src)
    } else {
      result = await this.reader.load(src, opts)
      if (!result) return null
    }
    this.outline.setItems(result.outline)
    this.tables.scan(doc)
    this.tables.recheckAll(doc)
    this.find.invalidate()
    if (place) this.restorePlace(place, result)
    this.outline.updateCurrent()
    // Warm block geometry once the page settles, so the first Find keystroke is quick.
    setTimeout(() => this.reader.blockY(0, scroller), 300)
    return result
  }

  /** Where the reader is: the source offset of the block at the top, and how far into it. */
  private placeMark(): { s: number; dy: number } | null {
    const box = this.els.frame.getBoundingClientRect()
    const x = box.left + (parseFloat(getComputedStyle(this.root).getPropertyValue('--col-left')) || box.width / 3) + 40
    const el = (document.elementFromPoint(x, box.top + 8) as HTMLElement | null)?.closest('[data-b]') as HTMLElement | null
    if (!el?.dataset.s) return null
    return { s: Number(el.dataset.s), dy: this.els.scroller.scrollTop - topIn(el, this.els.scroller) }
  }

  private restorePlace(place: { s: number; dy: number }, result: LoadResult): void {
    // The first block starting at or after the old one (the file may have changed around it).
    let b = result.blocks.findIndex((x) => x.s >= place.s)
    if (b < 0) b = result.blocks.length - 1
    const el = this.reader.blockEl(b, true)
    if (el) this.els.scroller.scrollTop = topIn(el, this.els.scroller) + (result.blocks[b].s === place.s ? place.dy : 0)
  }

  command(c: Command): void {
    const s = this.settings
    switch (c) {
      case 'find': this.find.open(); break
      case 'findNext': if (!this.find.isOpen) this.find.open(); this.find.step(1); break
      case 'findPrevious': if (!this.find.isOpen) this.find.open(); this.find.step(-1); break
      case 'toggleOutline':
        this.change({ outlineOpen: !s.outlineOpen }).then(() => { if (this.settings.outlineOpen) this.outline.focusForTyping() })
        break
      case 'bigger': this.change({ size: Math.min(RANGES.size.max, s.size + 1) }); break
      case 'smaller': this.change({ size: Math.max(RANGES.size.min, s.size - 1) }); break
      case 'actualSize': this.change({ size: DEFAULTS.size }); break
      case 'narrower': this.change({ measure: MEASURES[Math.max(0, MEASURES.indexOf(s.measure) - 1)] }); break
      case 'wider': this.change({ measure: MEASURES[Math.min(2, MEASURES.indexOf(s.measure) + 1)] }); break
      case 'cycleTheme': this.change({ theme: THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length] }); break
    }
  }
}
