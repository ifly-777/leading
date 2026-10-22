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
import type { Edit } from '../core/format'
import { slugify, type OutlineItem } from '../core/pipeline'
import type { HighlightSlot } from '../core/nodes'
import { highlightEdits } from '../core/highlight-edit'
import { referenceDefinitions } from '../core/chunks'
import { ReaderPalette, pointToSource, snapRange, notice, type PaletteTarget } from './highlights'
import { ProgressMark, cumulativeWords, progressAt } from './progress'
import { FootnotePopover } from './footnote-popover'
import { Diagrams } from './diagrams'
import { NoteEmbeds } from './embeds'
import { LinkPreview } from './link-preview'
import { HighlightsList, collectHighlights, highlightsMarkdown } from './highlights-list'
import { Focus } from './focus'
import { Paging } from './paging'
import { HighlightNote, noteComment } from './highlight-note'
import { Lightbox } from './lightbox'
import { LinksList } from './links-list'
import { SearchList } from './search-list'
import { ReadAloud } from './read-aloud'

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
  /** Where the reader stopped last time this file was open (from the host's memory) */
  resume?: Place
}

/** A place in the document: the source offset of the block at the top, and how far into it (px). */
export interface Place { s: number; dy: number }

export type Command =
  | 'find' | 'findNext' | 'findPrevious' | 'toggleOutline' | 'bigger' | 'smaller' | 'actualSize'
  | 'narrower' | 'wider' | 'cycleTheme' | 'back' | 'showHighlights' | 'showLinks' | 'searchVault' | 'readAloud' | 'copyHighlights' | 'copyQuote' | 'pageBreak'
  | 'toggleEdit' | 'findReplace' | 'undo' | 'redo'
  | 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link'
  | 'bulletList' | 'numberList' | 'table'
  | 'highlight' | 'removeHighlight'
  | 'highlightYellow' | 'highlightGreen' | 'highlightBlue' | 'highlightPink' | 'highlightOrange'

const COLOUR_COMMANDS: Record<string, HighlightSlot> = {
  highlightYellow: 'yellow', highlightGreen: 'green', highlightBlue: 'blue', highlightPink: 'pink', highlightOrange: 'orange',
}

const MEASURES: Measure[] = ['narrow', 'medium', 'wide']
/** Next Theme's order: Auto, which follows macOS, then each theme. */
const THEMES: Theme[] = ['system', 'light', 'sepia', 'dark']

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

export class ReaderView {
  readonly reader: Reader
  readonly outline: OutlinePanel
  readonly find: FindBar
  readonly readerFind: ReaderFind
  readonly tables: TableWatcher
  /** The colour dots over a selection while reading. */
  readonly palette: ReaderPalette
  readonly progress: ProgressMark
  /** Footnotes shown beside their reference */
  readonly footnotes: FootnotePopover
  /** Mermaid diagrams, drawn on the page after it renders */
  readonly diagrams: Diagrams
  /** Notes embedded with ![[Note]], filled in after the page renders */
  readonly embeds: NoteEmbeds
  /** A glance at a linked note, on hover */
  readonly preview: LinkPreview
  /** The file's highlights, a second tab beside the outline */
  readonly highlights: HighlightsList
  /** Dims all but the paragraph being read, when on */
  readonly focus: Focus
  /** A screen at a time, when on */
  readonly paging: Paging
  /** A highlight's note, shown and written under its line */
  readonly note: HighlightNote
  /** A picture or diagram, enlarged to the window */
  readonly lightbox: Lightbox
  /** The notes that link here, the margin's third tab */
  readonly links: LinksList
  /** Search of the whole vault, the margin's fourth tab */
  readonly search: SearchList
  /** View › Read Aloud */
  readonly readAloud: ReadAloud
  /** Text the view wants on the clipboard (the host puts it there). */
  onCopyText: (text: string) => void = () => {}
  /** The margin turned to a tab (the app ticks the matching View menu item). */
  onSideTab: (tab: string) => void = () => {}
  /** The notes this one's wikilinks name; the app answers with those the vault lacks. */
  onWikiTargets: (targets: string[]) => void = () => {}
  /** Wikilink targets the vault has no note for, as written, lower-cased. */
  private missingWikis = new Set<string>()
  /** Words before each block, for the progress mark; rebuilt when the blocks change. */
  private words: { blocks: unknown; n: number; cum: Float64Array } | null = null
  private progressFrame = 0
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
  /** Reading stopped scrolling here; the host remembers it for next time. */
  onPlace: (p: Place) => void = () => {}
  /** Whether View › Back has somewhere to go changed. */
  onCanGoBack: (can: boolean) => void = () => {}
  /** Places left by jumps within the document (outline, links, footnotes), newest last. */
  private backStack: Place[] = []
  private placeTimer = 0
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
    this.palette = new ReaderPalette(win, frame, scroller, doc)
    this.progress = new ProgressMark(win)
    this.footnotes = new FootnotePopover(win, scroller)
    this.diagrams = new Diagrams(doc, scroller)
    this.embeds = new NoteEmbeds(doc)
    this.embeds.onFilled = () => this.diagrams.scan()
    this.embeds.currentText = () => this.text
    this.preview = new LinkPreview(win, scroller, doc, this.embeds)
    // Blocks are painted as they come into view: mark the wikilinks in each as it arrives.
    new MutationObserver((records) => {
      if (!this.missingWikis.size) return
      for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) this.markWikis(n)
    }).observe(doc, { childList: true, subtree: true })
    this.focus = new Focus(doc, scroller, document.documentElement)
    this.paging = new Paging(scroller, doc)
    this.paging.active = () => this.mode === 'read'
    // Plain text shows the file unrendered: there is no Markdown to place a highlight in.
    this.palette.active = () => this.mode === 'read' && !this.lastOpen.plain && !this.readOnly
    this.palette.onPick = (slot, target) => { void this.highlightInReader(slot, false, target) }
    this.note = new HighlightNote(win, scroller)
    this.palette.onShow = (t) => { if (t.kind === 'mark') this.note.show(t.mark); else this.note.hide() }
    this.palette.onNote = (mark) => this.note.open(mark)
    this.note.onSave = (mark, text) => { void this.saveNote(mark, text) }
    this.lightbox = new Lightbox(win, doc)
    this.lightbox.active = () => this.mode === 'read'
    this.outline.locate = (item, force) => {
      const blk = this.reader.blockEl(item.b, force)
      if (!blk) return null
      // Most headings are blocks themselves; some sit inside a callout or list.
      return blk.matches('h1,h2,h3,h4,h5,h6') ? blk : blk.querySelector<HTMLElement>(`:is(h1,h2,h3,h4,h5,h6)[data-s="${item.s}"]`)
    }
    this.outline.onClose = () => this.change({ outlineOpen: false })
    this.outline.beforeJump = () => this.rememberPlace()
    this.highlights = new HighlightsList(outline)
    this.highlights.collect = () => collectHighlights(doc, (b) => this.reader.correction(b))
    this.highlights.onJump = (mark) => {
      this.rememberPlace()
      // A third of the way down the window, where the eye goes after a jump.
      const top = mark.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      scroller.scrollTop += top - scroller.clientHeight * 0.3
    }
    this.highlights.onCopy = () => this.copyHighlights()
    this.links = new LinksList(outline)
    this.search = new SearchList(outline)
    this.highlights.onTab = (tab) => {
      this.onSideTab(tab)
      if (tab === 'links') this.links.refresh()
      if (tab === 'search') this.search.refresh()
    }
    this.readAloud = new ReadAloud(doc, scroller)
    this.readerFind.blockY = (b) => this.reader.blockY(b, scroller)
    this.readerFind.index = () => this.reader.index
    this.readerFind.getBlock = (b, force) => this.reader.blockEl(b, force)
    this.readerFind.onLayoutShift = () => this.reader.invalidateGeometry()
    this.readerFind.onRedraw = () => this.find.draw()
    this.reader.onIndexGrew = () => { this.readerFind.invalidate(); if (this.mode === 'read') this.find.invalidate() }
    this.reader.onBlocksAdded = () => { this.reader.invalidateGeometry(); this.diagrams.scan(); this.embeds.scan() }

    // Ticking a task while reading changes its [ ] in the file.
    doc.addEventListener('click', (e) => {
      const box = (e.target as Element).closest?.('li.task-list-item input[type=checkbox]') as HTMLInputElement | null
      if (!box) return
      e.preventDefault() // the box shows the file's state once the change is made
      void this.toggleTask(box)
    })
    // Report the place once scrolling has settled, not on every frame.
    scroller.addEventListener('scroll', () => {
      clearTimeout(this.placeTimer)
      this.placeTimer = window.setTimeout(() => this.reportPlace(), 500)
      if (this.settings.progress && !this.progressFrame) {
        this.progressFrame = requestAnimationFrame(() => { this.progressFrame = 0; this.updateProgress(true) })
      }
    }, { passive: true })
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
      const s = createEditorSession(this.els.editor, this.els.win, this.els.frame, (slot) => { void this.highlightInEditor(slot, false) }, {
        onChange: (edits) => {
          this.editHost.onEdit(edits)
          this.find.invalidate()
          // Keep the outline in step with headings as they are typed.
          clearTimeout(this.headingTimer)
          this.headingTimer = window.setTimeout(() => { if (this.mode === 'edit' && this.editor) this.outline.setItems(scanHeadings(this.editor.text)) }, 300)
          // Changes made while reading (a highlight, or undo) show at once.
          if (this.mode === 'read') this.readingChanged(edits)
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

  private appliedKey = ''

  /** Apply the current settings: CSS variables, line-length calibration, layout. */
  async apply(): Promise<void> {
    const s = this.effective()
    // Settings that do not change the page's look (the last highlight colour)
    // must not re-measure it: on a 5 MB page that takes seconds.
    const { lastHighlight: _ignored, ...look } = s
    const lookKey = JSON.stringify([look, this.wcag, this.tuning, this.dark.matches])
    if (lookKey === this.appliedKey) return
    this.appliedKey = lookKey
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
    this.diagrams.restyle()
    this.focus.enabled = s.focus && this.mode === 'read'
    this.paging.enabled = s.paged
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
    this.updateProgress(false)
  }

  get theme(): 'light' | 'sepia' | 'dark' { return resolveTheme(this.settings.theme, this.dark.matches) }

  get charsPerLine(): number { return this.layout ? this.layout.colW / this.effective().size / this.avg : 0 }

  /** Show a document. Returns null if a newer open replaced this one. */
  async open(src: string, opts: OpenOptions = {}): Promise<LoadResult | null> {
    const { scroller, doc } = this.els
    this.source = src
    this.lastOpen = { ...opts, keepPlace: false, placeAt: undefined, fromDisk: false, resume: undefined }
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
    this.footnotes.hide()
    this.preview.hide()
    this.note.hide()
    this.lightbox.hide()
    // A new text (another file, or this one re-rendered) has new elements: what was being read is gone.
    this.readAloud.stop()
    this.embeds.setDocument(opts.imageBase)
    // A different document (not a reload of this one): its jumps have nothing to go back to.
    if (!opts.keepPlace && !opts.fromDisk && opts.placeAt === undefined && this.backStack.length) {
      this.backStack = []
      this.onCanGoBack(false)
    }
    const place = opts.keepPlace ? this.placeMark() : null
    if (!opts.keepPlace && opts.placeAt === undefined && !opts.resume) scroller.scrollTop = 0
    let result: LoadResult | null
    if (opts.plain) {
      result = this.reader.showPlain(src)
    } else {
      result = await this.reader.load(src, opts)
      if (!result) return null
    }
    this.renderedText = src
    this.lastResult = result
    // The editor checks spelling in the note's language too (it takes effect from the next render).
    this.els.editor.lang = result.lang
    this.readerOutline = result.outline
    if (this.mode === 'read') this.outline.setItems(result.outline)
    this.tables.scan(doc)
    this.diagrams.scan()
    this.embeds.scan()
    this.tables.recheckAll(doc)
    this.readerFind.invalidate()
    if (this.mode === 'read') this.find.invalidate()
    if (place) this.restorePlace(place, result)
    else if (opts.resume && !opts.plain) this.restorePlace(opts.resume, result)
    if (opts.placeAt !== undefined) this.placeAt(opts.placeAt, result)
    this.outline.updateCurrent()
    this.updateProgress(false)
    this.highlights.invalidate()
    if (this.highlights.tab === 'links' && !opts.keepPlace && !opts.fromDisk && opts.placeAt === undefined) this.links.refresh()
    this.askWikis()
    this.focus.schedule()
    // Warm block geometry once the page settles, so the first Find keystroke is quick,
    // and fetch edit mode's code in the background so ⌘E is instant when it comes.
    setTimeout(() => this.reader.blockY(0, scroller), 300)
    setTimeout(() => import('../editor/session'), 2000)
    return result
  }

  private reportPlace(): void {
    if (this.mode !== 'read' || this.lastOpen.plain) return
    const p = this.placeMark()
    if (p) this.onPlace({ s: p.s, dy: Math.round(p.dy) })
  }

  /** The block at the top of the reading column, just under the title bar. */
  private topBlock(): HTMLElement | null {
    const box = this.els.frame.getBoundingClientRect()
    const x = box.left + (parseFloat(getComputedStyle(this.root).getPropertyValue('--col-left')) || box.width / 3) + 40
    // The top of the page is padding, and blocks have gaps between them: look a
    // little further down until a block is found. Its offset is then negative.
    for (let y = 8; y < Math.min(box.height, 480); y += 16) {
      const el = (document.elementFromPoint(x, box.top + y) as HTMLElement | null)?.closest('[data-b]') as HTMLElement | null
      if (el) return el
    }
    return null
  }

  /** Where the reader is: the source offset of the block at the top, and how far into it. */
  private placeMark(): Place | null {
    const el = this.topBlock()
    if (!el?.dataset.s) return null
    return { s: Number(el.dataset.s) + this.reader.correction(Number(el.dataset.b)), dy: this.els.scroller.scrollTop - topIn(el, this.els.scroller) }
  }

  private themeBeforePrint: Settings['theme'] | null = null

  /**
   * Before printing: the light theme (dark paper never reaches a printer), every
   * diagram drawn and every image loaded, since paper shows the whole file at once.
   */
  async preparePrint(): Promise<void> {
    if (this.mode === 'edit') await this.toggleEdit()
    this.footnotes.hide()
    this.preview.hide()
    if (this.theme !== 'light') {
      this.themeBeforePrint = this.settings.theme
      this.settings = { ...this.settings, theme: 'light' }
      await this.apply()
    }
    const imgs = Array.from(this.els.doc.querySelectorAll<HTMLImageElement>('img'))
    const loaded = Promise.all(imgs.map((i) => {
      if (i.complete) return null
      i.loading = 'eager'
      return new Promise((ok) => { i.addEventListener('load', ok, { once: true }); i.addEventListener('error', ok, { once: true }) })
    }))
    await Promise.all([this.diagrams.drawAll(), Promise.race([loaded, new Promise((ok) => setTimeout(ok, 3000))]), document.fonts.ready])
  }

  /** Printing is over: the reader's own theme again. */
  async afterPrint(): Promise<void> {
    if (this.themeBeforePrint === null) return
    this.settings = { ...this.settings, theme: this.themeBeforePrint }
    this.themeBeforePrint = null
    await this.apply()
  }

  /** A preview with nowhere to save (Quick Look): no highlighting, no ticking, no editing. */
  readOnly = false

  /** Highlights and ticks allowed, but no source editing (the Leading Guide). */
  noEdit = false

  /** The file's name, for the link a quotation carries back to it (set by the host). */
  docName: string | null = null

  /**
   * Edit › Copy as Quote: the selection as a Markdown quotation, written as in
   * the file, with a wikilink back to the section it came from.
   */
  copyQuote(): void {
    const text = this.text
    let range: [number, number] | null = null
    let anchor: Node | null = null
    if (this.mode === 'edit') {
      range = this.editor?.selectionRange ?? null
    } else {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.rangeCount && this.els.doc.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        const span = this.spanOf({ kind: 'selection', range: sel.getRangeAt(0) })
        if (span) { range = [span.from, span.to]; anchor = sel.getRangeAt(0).startContainer }
      }
    }
    if (!range) { notice(this.els.win, 'Select some text to quote.'); return }
    range = balanceMarkers(text, range[0], range[1])
    const body = text.slice(range[0], range[1]).replace(/\s+$/, '')
    const lines = body.split('\n').map((l) => (l.trim() ? `> ${l}` : '>'))
    // The section the quotation starts in: the nearest heading above it.
    const heading = this.mode === 'edit' ? nearestHeadingAt(scanHeadings(text), range[0]) : nearestHeadingBefore(this.els.doc, anchor)
    if (this.docName) lines.push('>', `> — [[${this.docName}${heading ? '#' + heading : ''}]]`)
    this.onCopyText(lines.join('\n') + '\n')
    notice(this.els.win, 'Copied as a quotation.')
  }

  /** Every highlight in the file, as Markdown, onto the clipboard. */
  copyHighlights(): void {
    const entries = collectHighlights(this.els.doc, (b) => this.reader.correction(b))
    if (!entries.length) { notice(this.els.win, 'This file has no highlights yet.'); return }
    const title = this.readerOutline.find((i) => i.depth === 1)?.text ?? null
    this.onCopyText(highlightsMarkdown(entries, this.text, title))
    notice(this.els.win, `Copied ${entries.length} highlight${entries.length === 1 ? '' : 's'} as Markdown.`)
  }

  /** Ask the app which of the notes this one's wikilinks name are missing from the vault. */
  askWikis(): void {
    const targets = new Set<string>()
    for (const m of this.source.matchAll(/\[\[([^\[\]\n|#]+)/g)) targets.add(m[1].trim())
    if (targets.size) this.onWikiTargets([...targets])
  }

  /** The app's answer: these targets have no note. Their links are dimmed, and their preview says so. */
  setMissingWikis(targets: string[]): void {
    this.missingWikis = new Set(targets.map((t) => t.toLowerCase()))
    this.markWikis(this.els.doc)
  }

  private markWikis(root: Element): void {
    const links = root.matches('.wikilink') ? [root] : root.querySelectorAll('.wikilink')
    for (const a of links) {
      const t = (a as HTMLElement).dataset.target
      a.classList.toggle('wiki-missing', !!t && this.missingWikis.has(t.trim().toLowerCase()))
    }
  }

  /** A short message over the page, for the app (a link that leads nowhere, say). */
  notice(text: string): void { notice(this.els.win, text) }

  /** Notes in the vault changed: the Links tab, if showing, lists them again. */
  vaultChanged(): void {
    if (this.settings.outlineOpen && this.highlights.tab === 'links') this.links.refresh()
    if (this.settings.outlineOpen && this.highlights.tab === 'search') this.search.refresh()
    // A note added or removed elsewhere can mend or break this one's links.
    this.askWikis()
  }

  /** Edit › Find › Search Vault: the Search tab, with the cursor in its field. Again just puts the cursor back. */
  private searchVault(): void {
    this.highlights.show('search')
    if (this.settings.outlineOpen) { this.search.focus(); return }
    void this.change({ outlineOpen: true }).then(() => this.search.focus())
  }

  /**
   * A vault search result opened this note: Find on its words, at the match in
   * the block holding source offset `s` (where the result's line starts).
   */
  findAt(query: string, s: number): void {
    if (this.mode === 'edit' || !this.lastResult) { this.find.query = query; this.find.open(); return }
    const blocks = this.lastResult.blocks
    const b = s < 0 ? -1 : blocks.findIndex((x) => x.s >= 0 && x.e >= s)
    this.rememberPlace()
    // Go to the block first: if its words are in a comment, which the page hides, the reader is still at the line.
    if (b >= 0) this.placeAt(blocks[b].s, this.lastResult)
    this.find.openAt(query, b)
  }

  /** View › Show Highlights, or Show Links: that tab in the margin, or close the margin if it is already showing. */
  private toggleSide(tab: 'highlights' | 'links'): void {
    if (this.settings.outlineOpen && this.highlights.tab === tab) { void this.change({ outlineOpen: false }); return }
    this.highlights.show(tab)
    if (!this.settings.outlineOpen) void this.change({ outlineOpen: true })
  }

  /** View › Read Aloud: from the selection, or from the top of the window; again to stop. */
  toggleReadAloud(): void {
    if (this.readAloud.speaking) { this.readAloud.stop(); return }
    if (this.mode !== 'read') return
    if (!this.readAloud.start(this.topBlock())) notice(this.els.win, 'Nothing here to read aloud.')
  }

  /**
   * Edit › Look Up: the selected words, the font they are set in and where
   * their first line's baseline sits in the window, for the dictionary's panel.
   */
  lookUpTarget(): { text: string; x: number; y: number; size: number; font: string } | null {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null
    const range = sel.getRangeAt(0)
    const text = range.toString().replace(/\s+/g, ' ').trim()
    const rect = range.getClientRects()[0]
    const holder = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement
    if (!text || !rect || !holder) return null
    const css = getComputedStyle(holder)
    const size = parseFloat(css.fontSize) || 17
    // The baseline: the line box's bottom less the font's descent (about a fifth of its size).
    return { text: text.slice(0, 200), x: rect.left, y: rect.bottom - size * 0.22, size, font: css.fontFamily.split(',')[0].replace(/["']/g, '').trim() }
  }

  /** Before a jump within the document: remember where the reader was, for View › Back. */
  rememberPlace(): void {
    const p = this.mode === 'edit' && this.editor ? { s: this.editor.topPos(), dy: 0 } : this.placeMark()
    if (!p) return
    this.backStack.push(p)
    if (this.backStack.length > 50) this.backStack.shift()
    if (this.backStack.length === 1) this.onCanGoBack(true)
  }

  /** View › Back (⌘[): return to where the last jump started. */
  goBack(): void {
    const p = this.backStack.pop()
    if (!p) return
    if (!this.backStack.length) this.onCanGoBack(false)
    this.footnotes.hide()
    if (this.mode === 'edit') this.editor?.scrollToPos(p.s)
    else if (this.lastResult) this.restorePlace(p, this.lastResult)
  }

  /**
   * Go to a heading named in a link: its text as written ("Further reading",
   * as in [[Note#Further reading]]) or its slug ("further-reading", as in
   * other.md#further-reading). False if the document has no such heading.
   */
  jumpToHeading(name: string): boolean {
    if (name.startsWith('^')) return this.jumpToBlock(name)
    return this.jumpToHeadingOnly(name)
  }

  /** Go to a heading or block a link names, or say there is none rather than do nothing. */
  goToHeading(name: string): boolean {
    if (this.jumpToHeading(name)) return true
    notice(this.els.win, name.startsWith('^') ? `There is no block ${name} in this note.` : `There is no heading “${name}” in this note.`)
    return false
  }

  private jumpToHeadingOnly(name: string): boolean {
    const want = slugify(name)
    const items = this.mode === 'edit' && this.editor ? scanHeadings(this.editor.text) : this.readerOutline
    const item = items.find((i) => i.id === name || slugify(i.text) === want)
    if (!item) return false
    this.rememberPlace()
    if (this.mode === 'edit') this.editor?.scrollToPos(item.s)
    else this.outline.jumpTo(item)
    return true
  }

  /**
   * Go to a block named with ^id, as [[Note#^id]] names it. Reading mode
   * finds its element; edit mode finds the "^id" in the text.
   */
  private jumpToBlock(id: string): boolean {
    if (this.mode === 'edit' && this.editor) {
      const m = new RegExp(`(?:^|\\s)\\^${id.replace(/[^A-Za-z0-9-]/g, '')}[ \\t]*$`, 'm').exec(this.editor.text)
      if (!m) return false
      this.rememberPlace()
      this.editor.scrollToPos(m.index)
      return true
    }
    // Long files may not have painted that far yet: paint until it is there.
    let el = this.findBlockId(id)
    if (!el && !this.reader.complete) { this.reader.ensureBlock(this.reader.blockCount - 1); el = this.findBlockId(id) }
    if (!el) return false
    this.rememberPlace()
    const { scroller } = this.els
    // A third of the way down the window, where the eye goes after a jump.
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight * 0.3
    el.classList.remove('block-target')
    void el.offsetWidth // restart the flash if the same block is jumped to again
    el.classList.add('block-target')
    return true
  }

  private findBlockId(id: string): HTMLElement | null {
    for (const el of this.els.doc.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`)) if (!el.closest('.note-embed')) return el
    return null
  }

  /** Redraw the progress mark, if it is on; `scrolling` also shows the time left for a moment. */
  private updateProgress(scrolling: boolean): void {
    const blocks = this.lastResult?.blocks
    const { scroller } = this.els
    // Off, editing, nothing loaded, or the whole text fits in the window: nothing to show.
    if (!this.settings.progress || this.mode !== 'read' || !blocks?.length || scroller.scrollHeight <= scroller.clientHeight + 4) {
      this.progress.hide()
      return
    }
    // Long files grow their block list while they load; count again when it has changed.
    if (this.words?.blocks !== blocks || this.words.n !== blocks.length) {
      this.words = { blocks, n: blocks.length, cum: cumulativeWords(blocks) }
    }
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
    const el = atEnd ? null : this.topBlock()
    let p = { fraction: 1, wordsLeft: 0 }
    if (!atEnd) {
      const b = el ? Number(el.dataset.b) : 0
      const into = el ? (scroller.scrollTop - topIn(el, scroller)) / Math.max(1, el.offsetHeight) : 0
      p = progressAt(this.words.cum, b, into)
    }
    this.progress.show(p.fraction, p.wordsLeft, scrolling)
  }

  private restorePlace(place: Place, result: LoadResult): void {
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
      this.highlights.setEditing(true)
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
      this.progress.hide()
      this.footnotes.hide()
      this.preview.hide()
      this.note.hide()
      this.readAloud.stop()
      this.focus.enabled = false
      ed.focus()
      ed.scrollToPos(pos)
    } else {
      const ed = this.editor!
      const pos = ed.topPos()
      this.session?.popover.hide()
      this.mode = 'read'
      document.documentElement.dataset.mode = 'read'
      this.highlights.setEditing(false)
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
      this.updateProgress(false)
      this.focus.enabled = this.settings.focus
    }
    this.editHost.onMode(this.mode === 'edit')
  }

  // -------------------------------------------------------------------------
  // Highlights

  /** The document's text now: the editor's, once it exists. */
  get text(): string { return this.editor?.exists ? this.editor.text : this.source }

  private defsOf(text: string): string { return text.includes(']:') ? referenceDefinitions(text) : '' }

  /** A shortcut or menu command: the selection, else the current search match. */
  highlight(slot: HighlightSlot | null, toggle: boolean): Promise<void> {
    return this.mode === 'edit' ? this.highlightInEditor(slot, toggle) : this.highlightInReader(slot, toggle)
  }

  /** Remember the colour last chosen, for ⇧⌘H. */
  private rememberColour(slot: HighlightSlot | null): void {
    if (slot && slot !== this.settings.lastHighlight) void this.change({ lastHighlight: slot })
  }

  /** Source range and blocks of something on the page. */
  private spanOf(t: PaletteTarget): { from: number; to: number; blocks: [number, number][] } | null {
    const corr = (b: number) => this.reader.correction(b)
    if (t.kind === 'mark') {
      const blk = t.mark.closest<HTMLElement>('[data-b]')
      if (!blk || !t.mark.dataset.s) return null
      const b = Number(blk.dataset.b)
      const d = corr(b)
      return { from: Number(t.mark.dataset.s) + d, to: Number(t.mark.dataset.e) + d, blocks: [this.reader.blockRange(b)] }
    }
    const r = t.range
    const text = this.text
    const a = pointToSource(r.startContainer, r.startOffset, false, text, corr)
    const z = pointToSource(r.endContainer, r.endOffset, true, text, corr)
    if (!a || !z || z.offset <= a.offset) return null
    const blocks: [number, number][] = []
    for (let b = a.b; b <= z.b; b++) blocks.push(this.reader.blockRange(b))
    return { from: a.offset, to: z.offset, blocks }
  }

  async highlightInReader(slot: HighlightSlot | null, toggle: boolean, target?: PaletteTarget): Promise<void> {
    if (this.lastOpen.plain || this.readOnly) return
    let t = target ?? null
    let match = false
    if (!t) {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.rangeCount && this.els.doc.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        t = { kind: 'selection', range: sel.getRangeAt(0) }
      } else if (this.palette.target) {
        t = this.palette.target
      } else if (this.find.isOpen && this.find.currentIndex >= 0) {
        // "Find every mention and highlight it": ⇧⌘H on the current match, then on to the next.
        const r = this.find.currentRange()
        if (r) { t = { kind: 'selection', range: r }; match = true }
      }
    }
    if (!t) { notice(this.els.win, slot ? 'Select some text to highlight.' : 'Select highlighted text to remove its highlight.'); return }
    // A reader's selection is widened to whole words, so no edge falls inside
    // one (docs/decisions.md). A Find match is highlighted exactly as found.
    if (t.kind === 'selection' && !match) t = { kind: 'selection', range: snapRange(t.range, this.els.doc.lang || 'en') }
    const span = this.spanOf(t)
    this.palette.hide()
    if (!span) return
    const text = this.text
    const r = highlightEdits(text, span.blocks, span.from, span.to, slot, { toggle, defs: this.defsOf(text) })
    if (!r.ok) { notice(this.els.win, r.reason); return }
    this.rememberColour(slot)
    if (!r.edits.length) return
    // A highlight taken away takes its note with it, or the note would be left behind as a stray comment.
    if (slot === null) r.edits.push(...this.notesWithin(t, span.from, span.to, r.edits))
    window.getSelection()?.removeAllRanges()
    await this.applyFromReader(r.edits)
    if (match) this.find.step(1)
  }

  private async highlightInEditor(slot: HighlightSlot | null, toggle: boolean): Promise<void> {
    const session = await this.loadEditor()
    // With Find open on a match and nothing selected, the match is the target.
    let span: [number, number] | undefined
    const i = this.find.currentIndex
    const ed = session.editor
    if (this.find.isOpen && i >= 0 && ed.selectionEmpty) span = session.find.span(i) ?? undefined
    const err = ed.highlight(slot, toggle, span, this.defsOf(ed.text))
    if (err) { notice(this.els.win, err); return }
    this.rememberColour(slot)
    if (span) this.find.step(1)
  }

  /** Deletions for the notes of highlights wholly inside [from, to], that no other edit touches. */
  private notesWithin(t: PaletteTarget, from: number, to: number, edits: Edit[]): Edit[] {
    const marks = t.kind === 'mark' ? [t.mark] : Array.from(this.els.doc.querySelectorAll<HTMLElement>('mark.hl[data-note-s]')).filter((m) => t.range.intersectsNode(m))
    const out: Edit[] = []
    for (const m of marks) {
      if (!m.dataset.noteS || m.closest('.note-embed')) continue
      const d = this.reader.correction(Number(m.closest<HTMLElement>('[data-b]')?.dataset.b ?? 0))
      const s = Number(m.dataset.s) + d, e = Number(m.dataset.e) + d
      const ns = Number(m.dataset.noteS) + d, ne = Number(m.dataset.noteE) + d
      if (s < from || e > to) continue
      if (edits.some((x) => x.from < ne && x.to > ns)) continue
      out.push({ from: ns, to: ne, insert: '' })
    }
    return out
  }

  /** Keep a highlight's note: written as a comment straight after it, or removed when empty. One edit, so ⌘Z undoes it. */
  async saveNote(mark: HTMLElement, note: string): Promise<void> {
    const blk = mark.closest<HTMLElement>('[data-b]')
    if (this.mode !== 'read' || this.readOnly || !blk || !mark.dataset.e || mark.closest('.note-embed')) return
    const d = this.reader.correction(Number(blk.dataset.b))
    const text = this.text
    const comment = noteComment(note)
    if (mark.dataset.noteS) {
      const s = Number(mark.dataset.noteS) + d, e = Number(mark.dataset.noteE) + d
      // The page and the text must agree before anything is written.
      if (!text.startsWith('%%', s) || text.slice(e - 2, e) !== '%%') return
      await this.applyFromReader([{ from: s, to: e, insert: comment }])
    } else if (comment) {
      const at = Number(mark.dataset.e) + d
      await this.applyFromReader([{ from: at, to: at, insert: comment }])
    }
    notice(this.els.win, comment ? 'Note kept.' : 'Note removed.')
  }

  /** Tick or untick a task: "- [ ]" becomes "- [x]" in the file, and back. One edit, so ⌘Z undoes it. */
  async toggleTask(box: HTMLInputElement): Promise<void> {
    const li = box.closest<HTMLElement>('li.task-list-item')
    if (!li) return
    const blk = li.closest<HTMLElement>('[data-b]')
    if (this.mode !== 'read' || this.lastOpen.plain || this.readOnly || !li.dataset.s || !blk) return
    const s = Number(li.dataset.s) + this.reader.correction(Number(blk.dataset.b))
    const text = this.text
    // The item starts at its bullet: "- [ ] ", "* [x] ", "12. [ ] ", after any indent.
    const m = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/.exec(text.slice(s, s + 40))
    if (!m) return
    const at = s + m[0].length - 2
    await this.applyFromReader([{ from: at, to: at + 1, insert: m[1] === ' ' ? 'x' : ' ' }])
  }

  /** Apply edits made while reading: they go through the editor, so ⌘Z undoes them. */
  private async applyFromReader(edits: Edit[]): Promise<void> {
    const session = await this.loadEditor()
    session.editor.ensure(this.source)
    session.editor.apply(edits)
  }

  /** The text changed while reading: show it, re-rendering only the blocks that changed if possible. */
  private readingChanged(edits: Edit[]): void {
    const text = this.text
    if (this.reader.patch(text, edits, this.lastOpen, () => this.defsOf(text))) {
      this.source = text
      this.renderedText = text
      // New tables are watched and measured as they come into view; measuring
      // every table now would lay out the whole page (seconds at 5 MB).
      this.tables.scan(this.els.doc)
      this.diagrams.scan()
      this.embeds.scan()
      this.highlights.invalidate()
      this.focus.schedule()
      this.readerFind.invalidate()
      this.find.invalidate()
    } else {
      void this.rerender()
    }
  }

  /** Run a command. Switching modes returns a promise that settles once the switch is done. */
  command(c: Command): Promise<void> | void {
    const s = this.settings
    switch (c) {
      case 'toggleEdit': return this.readOnly || this.noEdit ? undefined : this.toggleEdit()
      case 'back': this.goBack(); break
      case 'showHighlights': this.toggleSide('highlights'); break
      case 'showLinks': this.toggleSide('links'); break
      case 'searchVault': this.searchVault(); break
      case 'readAloud': this.toggleReadAloud(); break
      case 'copyHighlights': this.copyHighlights(); break
      case 'copyQuote': this.copyQuote(); break
      // Obsidian's and Typora's form, so the break holds when the note is printed there too.
      case 'pageBreak': if (this.mode === 'edit') this.editor?.insertBlock('<div style="page-break-after: always;"></div>'); break
      case 'findReplace': if (this.mode === 'edit') this.find.open(true); else this.find.open(); break
      case 'undo': this.editor?.undo(); break
      case 'redo': this.editor?.redo(); break
      case 'highlight': return this.highlight(this.settings.lastHighlight, true)
      case 'removeHighlight': return this.highlight(null, false)
      case 'highlightYellow': case 'highlightGreen': case 'highlightBlue': case 'highlightPink': case 'highlightOrange':
        return this.highlight(COLOUR_COMMANDS[c], true)
      case 'bold': case 'italic': case 'underline': case 'strike': case 'code': case 'link':
      case 'bulletList': case 'numberList': case 'table':
        if (this.mode === 'edit') this.editor?.format(c)
        break
      case 'find': this.find.open(); break
      case 'findNext': if (!this.find.isOpen) this.find.open(); this.find.step(1); break
      case 'findPrevious': if (!this.find.isOpen) this.find.open(); this.find.step(-1); break
      case 'toggleOutline':
        // Showing highlights: ⌥⌘O turns the margin back to the outline rather than closing it.
        if (s.outlineOpen && this.highlights.tab !== 'outline') { this.highlights.show('outline'); this.outline.focusForTyping(); break }
        this.highlights.show('outline')
        this.change({ outlineOpen: !s.outlineOpen }).then(() => { if (this.settings.outlineOpen) this.outline.focusForTyping() })
        break
      case 'bigger': this.change({ size: Math.min(RANGES.size.max, s.size + 1) }); break
      case 'smaller': this.change({ size: Math.max(RANGES.size.min, s.size - 1) }); break
      case 'actualSize': this.change({ size: DEFAULTS.size }); break
      case 'narrower': this.change({ measure: MEASURES[Math.max(0, MEASURES.indexOf(s.measure) - 1)] }); break
      case 'wider': this.change({ measure: MEASURES[Math.min(2, MEASURES.indexOf(s.measure) + 1)] }); break
      // From the setting, not the theme it resolves to, so Auto is one of the steps.
      case 'cycleTheme': this.change({ theme: THEMES[(THEMES.indexOf(this.settings.theme) + 1) % THEMES.length] }); break
    }
  }
}

/** The text of the last heading at or before source offset `pos`. */
function nearestHeadingAt(items: OutlineItem[], pos: number): string | null {
  let h: string | null = null
  for (const i of items) { if (i.s > pos) break; h = i.text }
  return h
}

/** The text of the last heading on the page before `node` (outside embedded notes). */
function nearestHeadingBefore(doc: HTMLElement, node: Node | null): string | null {
  if (!node) return null
  let h: string | null = null
  for (const el of doc.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if (el.closest('.note-embed')) continue
    // Stop at the first heading that comes after the node.
    if (node.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !el.contains(node)) break
    h = (el.textContent ?? '').trim()
  }
  return h
}

/**
 * Widen a source range so emphasis it cuts through stays paired: a selection
 * starting inside *italics* would otherwise quote as "woods*". A marker left
 * unpaired is taken in from just outside the range, where there is one.
 */
export function balanceMarkers(text: string, from: number, to: number): [number, number] {
  for (let round = 0; round < 8; round++) {
    let changed = false
    for (const ch of ['*', '_', '=', '~', '`']) {
      // Count runs, not characters: "**" and "==" are one marker each.
      const slice = text.slice(from, to)
      let n = 0
      for (let i = 0; i < slice.length; i++) {
        if (slice[i] === ch && slice[i - 1] !== ch && slice[i - 1] !== '\\') n++
      }
      if (n % 2 === 0) continue
      // Take in the whole run just outside the range.
      if (text[from - 1] === ch) { while (text[from - 1] === ch) from--; changed = true }
      else if (text[to] === ch) { while (text[to] === ch) to++; changed = true }
    }
    if (!changed) break
  }
  return [from, to]
}
