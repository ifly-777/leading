// The reading view: everything one window shows, wired together. Used by the
// Mac app's page (app/main.ts) and by the Stage 1 prototype, so both run the
// same code. The host decides where settings live and how commands arrive.

import { DEFAULTS, TUNING, MEASURE_CHARS, RANGES, applySettings, resolveTheme, type Settings, type Tuning, type Measure, type Theme } from '../core/settings'
import type { RenderOptions } from '../core/pipeline'
import { Reader, type LoadResult } from './render'
import { computeLayout, applyLayout, type LayoutResult } from './layout'
import { avgCharEm } from './measure'
import { OutlinePanel } from './outline'
import { FindBar, ReaderFind } from './find'
import { TableWatcher } from './tables'
import { topIn } from './geometry'
// Type-only: the editor's code (CodeMirror) is loaded on first use; see loadEditor().
import type { SourceEditor } from '../editor/editor'
import type { EditorSession } from '../editor/session'
import { scanHeadings } from '../core/headings'
import type { Edit, Format } from '../core/format'
import type { OutlineItem } from '../core/pipeline'

export interface ViewElements {
  win: HTMLElement; scroller: HTMLElement; doc: HTMLElement; layer: HTMLElement
  ticks: HTMLElement; frame: HTMLElement; outline: HTMLElement
  /** Where the source editor lives (edit mode) */
  editor: HTMLElement
}

/** What the view tells its host about editing (the app forwards these to Swift). */
export interface EditHost {
  onEdit(edits: Edit[]): void
  onSettled(length: number, hash: number): void
  onHistory(canUndo: boolean, canRedo: boolean): void
  onMode(editing: boolean): void
}

export interface OpenOptions extends RenderOptions {
  /** Show the file as plain text instead of rendering Markdown (for .txt files) */
  plain?: boolean
  /** Keep the reader's place (reload after the file changed on disk) */
  keepPlace?: boolean
  /** Scroll to this source offset after rendering (coming back from edit mode) */
  placeAt?: number
  /** The text came from disk, not from the editor: replace the editor's text and history too */
  fromDisk?: boolean
}

export type Command =
  | 'find' | 'findNext' | 'findPrevious' | 'toggleOutline' | 'bigger' | 'smaller' | 'actualSize'
  | 'narrower' | 'wider' | 'cycleTheme'
  | 'toggleEdit' | 'findReplace' | 'undo' | 'redo'
  | 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link'

const MEASURES: Measure[] = ['narrow', 'medium', 'wide']
const THEMES: Exclude<Theme, 'system'>[] = ['light', 'sepia', 'dark']

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

export class ReaderView {
  readonly reader: Reader
  readonly outline: OutlinePanel
  readonly find: FindBar
  readonly readerFind: ReaderFind
  readonly tables: TableWatcher
  /** The source editor, once edit mode has been used (its code loads on demand). */
  editor: SourceEditor | null = null
  private session: EditorSession | null = null
  private sessionLoading: Promise<EditorSession> | null = null
  /** Reading or editing */
  mode: 'read' | 'edit' = 'read'
  /** The document's current text (the editor's, once editing has begun) */
  private source = ''
  /** The text the reader last rendered */
  private renderedText = ''
  private lastOpen: OpenOptions = {}
  private readerOutline: OutlineItem[] = []
  private headingTimer = 0
  editHost: EditHost = { onEdit() {}, onSettled() {}, onHistory() {}, onMode() {} }
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
    this.readerFind = new ReaderFind(scroller, doc, layer, frame)
    this.find = new FindBar(win, scroller, ticks, this.readerFind)
    this.tables = new TableWatcher(scroller, win, frame)
    this.outline.locate = (item, force) => {
      const blk = this.reader.blockEl(item.b, force)
      if (!blk) return null
      // Most headings are blocks themselves; some sit inside a callout or list.
      return blk.matches('h1,h2,h3,h4,h5,h6') ? blk : blk.querySelector<HTMLElement>(`:is(h1,h2,h3,h4,h5,h6)[data-s="${item.s}"]`)
    }
    this.outline.onClose = () => this.change({ outlineOpen: false })
    this.readerFind.blockY = (b) => this.reader.blockY(b, scroller)
    this.readerFind.index = () => this.reader.index
    this.readerFind.getBlock = (b, force) => this.reader.blockEl(b, force)
    this.readerFind.onLayoutShift = () => this.reader.invalidateGeometry()
    this.readerFind.onRedraw = () => this.find.draw()
    this.reader.onIndexGrew = () => { this.readerFind.invalidate(); if (this.mode === 'read') this.find.invalidate() }
    this.reader.onBlocksAdded = () => this.reader.invalidateGeometry()

    new ResizeObserver(() => this.relayout()).observe(scroller)
    this.dark.addEventListener('change', () => this.apply())
  }

  private effective(): Settings {
    const s = this.settings
    return this.wcag ? { ...s, lineHeight: Math.max(1.5, s.lineHeight), letterSpacing: 0.12, wordSpacing: 0.16, paragraphStyle: 'space', paragraphSpacing: 2 } : s
  }

  /** Load edit mode's code (CodeMirror) and set it up; once only. */
  private loadEditor(): Promise<EditorSession> {
    this.sessionLoading ??= import('../editor/session').then(({ createEditorSession }) => {
      const s = createEditorSession(this.els.editor, this.els.win, this.els.frame, {
        onChange: (edits) => {
          this.editHost.onEdit(edits)
          this.find.invalidate()
          // Keep the outline in step with headings as they are typed.
          clearTimeout(this.headingTimer)
          this.headingTimer = window.setTimeout(() => { if (this.mode === 'edit' && this.editor) this.outline.setItems(scanHeadings(this.editor.text)) }, 300)
          // Changes made while reading (undo, or a highlight in Stage 4) show at once.
          if (this.mode === 'read') this.rerender()
        },
        onSettled: (len, hash) => this.editHost.onSettled(len, hash),
        onHistory: (u, r) => this.editHost.onHistory(u, r),
      })
      this.session = s
      this.editor = s.editor
      return s
    })
    return this.sessionLoading
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
    if (this.editor?.exists) this.editor.setSmartTyping(s.smartTyping)
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
    this.source = src
    this.lastOpen = { ...opts, keepPlace: false, placeAt: undefined, fromDisk: false }
    if (opts.fromDisk && this.editor?.exists) {
      // The file changed on disk or a version was restored: the editor starts again from it.
      const top = this.editor.topPos()
      this.editor.reset(src)
      if (this.mode === 'edit') {
        this.editor.scrollToPos(top)
        this.outline.setItems(scanHeadings(src))
        this.find.invalidate()
        return null // the reader re-renders when reading resumes
      }
    }
    const place = opts.keepPlace ? this.placeMark() : null
    if (!opts.keepPlace && opts.placeAt === undefined) scroller.scrollTop = 0
    let result: LoadResult | null
    if (opts.plain) {
      result = this.reader.showPlain(src)
    } else {
      result = await this.reader.load(src, opts)
      if (!result) return null
    }
    this.renderedText = src
    this.lastResult = result
    this.readerOutline = result.outline
    if (this.mode === 'read') this.outline.setItems(result.outline)
    this.tables.scan(doc)
    this.tables.recheckAll(doc)
    this.readerFind.invalidate()
    if (this.mode === 'read') this.find.invalidate()
    if (place) this.restorePlace(place, result)
    if (opts.placeAt !== undefined) this.placeAt(opts.placeAt, result)
    this.outline.updateCurrent()
    // Warm block geometry once the page settles, so the first Find keystroke is quick,
    // and fetch edit mode's code in the background so ⌘E is instant when it comes.
    setTimeout(() => this.reader.blockY(0, scroller), 300)
    setTimeout(() => import('../editor/session'), 2000)
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

  /** Scroll the reader to the block holding source offset `pos`. */
  private placeAt(pos: number, result: LoadResult): void {
    let b = 0
    for (let i = 0; i < result.blocks.length; i++) { if (result.blocks[i].s >= 0 && result.blocks[i].s <= pos) b = i; else if (result.blocks[i].s > pos) break }
    const el = this.reader.blockEl(b, true)
    if (el) this.els.scroller.scrollTop = Math.max(0, topIn(el, this.els.scroller) - 8)
  }

  private lastResult: LoadResult | null = null

  /** Re-render the reader from the current text, keeping the reader's place. */
  private async rerender(placeAt?: number): Promise<void> {
    const text = this.editor?.exists ? this.editor.text : this.source
    this.source = text
    await this.open(text, { ...this.lastOpen, keepPlace: placeAt === undefined, placeAt })
  }

  /** ⌘E: between reading and the source. The reader's place carries across. */
  async toggleEdit(): Promise<void> {
    const { scroller, editor } = this.els
    if (this.mode === 'read') {
      const pos = this.placeMark()?.s ?? 0
      const session = await this.loadEditor()
      const ed = session.editor
      const view = ed.ensure(this.source)
      ed.setSmartTyping(this.settings.smartTyping)
      this.mode = 'edit'
      document.documentElement.dataset.mode = 'edit'
      editor.hidden = false
      this.outline.setItems(scanHeadings(ed.text))
      this.outline.jumpTo = (item) => ed.scrollToPos(item.s)
      this.outline.currentIndex = (items) => {
        const top = ed.topPos() + 1
        let found = -1
        for (let i = 0; i < items.length && items[i].s <= top; i++) found = i
        return found
      }
      this.outline.watch(view.scrollDOM)
      this.find.setEngine(session.find, view.scrollDOM)
      ed.focus()
      ed.scrollToPos(pos)
    } else {
      const ed = this.editor!
      const pos = ed.topPos()
      this.session?.popover.hide()
      this.mode = 'read'
      document.documentElement.dataset.mode = 'read'
      editor.hidden = true
      this.outline.useReadingMode()
      this.find.setEngine(this.readerFind, scroller)
      if (ed.text !== this.renderedText) {
        await this.rerender(pos)
      } else {
        this.outline.setItems(this.readerOutline)
        if (this.lastResult) this.placeAt(pos, this.lastResult)
      }
      scroller.focus({ preventScroll: true })
    }
    this.editHost.onMode(this.mode === 'edit')
  }

  /** Run a command. Switching modes returns a promise that settles once the switch is done. */
  command(c: Command): Promise<void> | void {
    const s = this.settings
    switch (c) {
      case 'toggleEdit': return this.toggleEdit()
      case 'findReplace': if (this.mode === 'edit') this.find.open(true); else this.find.open(); break
      case 'undo': this.editor?.undo(); break
      case 'redo': this.editor?.redo(); break
      case 'bold': case 'italic': case 'underline': case 'strike': case 'code': case 'link':
        if (this.mode === 'edit') this.editor?.format(c as Format | 'link')
        break
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
