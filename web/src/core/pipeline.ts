// The Markdown pipeline: source text → mdast (with exact positions) → HTML,
// one string per top-level block so long documents can be painted
// progressively. Pure functions; runs on the main thread or in a worker.

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { frontmatter } from 'micromark-extension-frontmatter'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { math } from 'micromark-extension-math'
import { mathFromMarkdown } from 'mdast-util-math'
import { toHast, defaultHandlers, type Handlers, type State } from 'mdast-util-to-hast'
import { raw } from 'hast-util-raw'
import { sanitize, defaultSchema, type Schema } from 'hast-util-sanitize'
import { toHtml } from 'hast-util-to-html'
import { trimLines } from 'trim-lines'
import YAML from 'yaml'
import katex from 'katex'
import type { Root } from 'mdast'
import type { Element, ElementContent, Root as HastRoot, Properties } from 'hast'
import './nodes'
import type { Callout, Highlight, WikiLink } from './nodes'
import { transformCallouts } from './plugins/callout'
import { transformInline } from './plugins/inline'
import { smarten } from './plugins/smartquotes'
import { obsidianMathText } from './plugins/math-text'
import { classifyTables } from './tables'
import { textOf } from './text'
import { blockText, isUnsearched } from './search-index'

export interface OutlineItem { depth: number; text: string; id: string; s: number; /** top-level block holding it */ b: number }
export interface Block {
  html: string
  s: number
  e: number
  /** Displayed text, for the search index (see search-index.ts for the rule) */
  text: string
}
export interface RenderResult { blocks: Block[]; outline: OutlineItem[] }
export interface RenderOptions {
  /** URL prefix for local images, relative to the document. Null: show alt text only.
   *  Plain data (not a function) so options can cross into a Web Worker. */
  imageBase?: string | null
}

export function parse(src: string): Root {
  const tree = fromMarkdown(src, {
    // Obsidian needs ~~double~~ tildes for strikethrough; a single ~ is literal.
    // Math: $$…$$ from the stock extension, single dollars by Obsidian's rules (see math-text.ts).
    extensions: [gfm({ singleTilde: false }), frontmatter(['yaml']), math({ singleDollarTextMath: false }), obsidianMathText()],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml']), mathFromMarkdown()],
  })
  transformCallouts(tree, src)
  transformInline(tree, src)
  classifyTables(tree)
  smarten(tree)
  return tree
}

// Source range as data attributes; every highlightable run carries one.
function pos(node: any): Properties {
  const p = node.position
  return p ? { dataS: p.start.offset, dataE: p.end.offset } : {}
}

function el(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

const CALLOUT_ALIASES: Record<string, string> = {
  summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success',
  help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure',
  missing: 'failure', error: 'danger', cite: 'quote',
}

const SAFE_URL = /^(?:https?:|mailto:|#|\/|\.|[^:]*$)/i
const REMOTE = /^[a-z][a-z0-9+.\-]*:/i

export function slugify(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section'
}

/**
 * A formula's place in the tree: an empty span holding its number in `tex`.
 * KaTeX's HTML replaces it after the block is serialised (see `typeset`),
 * so its inline styles never meet the sanitiser. Only the TeX goes in, and
 * KaTeX escapes it, so nothing from the file reaches the page unescaped.
 */
function mathEl(tex: string[], value: string, display: boolean, node: any): Element {
  tex.push((display ? 'D' : 'I') + value)
  const slot = el('span', { dataTex: tex.length - 1 }, [])
  return el(display ? 'div' : 'span', { className: display ? ['math', 'display'] : ['math'], ...pos(node) }, [slot])
}

const SLOT = /<span data-tex="(\d+)"><\/span>/g

function typeset(html: string, tex: string[]): string {
  if (!html.includes('data-tex')) return html
  return html.replace(SLOT, (_, n) => {
    const t = tex[Number(n)]
    // A bad formula shows its source in the error colour; it never stops the page.
    return katex.renderToString(t.slice(1), { displayMode: t[0] === 'D', throwOnError: false, output: 'htmlAndMathml', trust: false, strict: 'ignore' })
  })
}

function makeHandlers(outline: OutlineItem[], opts: RenderOptions, tex: string[]): Handlers {
  const slugs = new Map<string, number>()
  return {
    text(state: State, node: any) {
      const t = { type: 'text' as const, value: trimLines(String(node.value)) }
      return node.position ? el('span', pos(node), [t]) : t
    },
    heading(state, node) {
      const e = defaultHandlers.heading(state, node)
      const text = textOf(node)
      let id = slugify(text)
      const n = slugs.get(id) ?? 0
      slugs.set(id, n + 1)
      if (n) id += '-' + n
      Object.assign(e.properties, { id, dir: 'auto', ...pos(node) })
      outline.push({ depth: node.depth, text, id, s: node.position?.start.offset ?? 0, b: 0 })
      return e
    },
    paragraph(state, node) {
      const e = defaultHandlers.paragraph(state, node) as Element
      e.properties.dir = 'auto' // Arabic, Hebrew and other RTL paragraphs flow correctly
      return e
    },
    math(state, node: any) {
      const e = mathEl(tex, node.value, true, node)
      state.patch(node, e)
      return e
    },
    inlineMath(state, node: any) {
      const e = mathEl(tex, node.value, false, node)
      state.patch(node, e)
      return e
    },
    code(state, node) {
      // GitHub writes display math as a ```math fence.
      if (node.lang === 'math') return mathEl(tex, node.value, true, node)
      // Mermaid draws on the page (reader/diagrams.ts); the source waits in the figure.
      if (node.lang === 'mermaid') {
        return el('figure', { className: ['diagram'], ...pos(node) }, [el('pre', { className: ['diagram-src'] }, [{ type: 'text', value: node.value }])])
      }
      const e = defaultHandlers.code(state, node)
      Object.assign(e.properties, pos(node))
      return e
    },
    inlineCode(state, node) {
      const e = defaultHandlers.inlineCode(state, node)
      Object.assign(e.properties, pos(node))
      return e
    },
    link(state, node) {
      const e = defaultHandlers.link(state, node)
      if (!SAFE_URL.test(node.url)) delete e.properties.href
      return e
    },
    image(state, node) {
      const url = node.url
      const local = !REMOTE.test(url) && opts.imageBase != null ? opts.imageBase + url : null
      if (!local) {
        // No network, ever: remote images show their description instead.
        return el('span', { className: ['img-blocked'], ...pos(node) }, [{ type: 'text', value: node.alt || url }])
      }
      return el('img', { src: local, alt: node.alt ?? '', loading: 'lazy', decoding: 'async', ...pos(node) }, [])
    },
    table(state, node) {
      const t = defaultHandlers.table(state, node)
      const wrap = el('div', { className: ['table-bleed'] }, [el('div', { className: ['table-scroll'] }, [t])])
      state.patch(node, wrap)
      return wrap
    },
    yaml(state, node: any) {
      let rows: ElementContent[] = []
      try {
        const data = YAML.parse(node.value)
        if (data && typeof data === 'object') {
          for (const [k, v] of Object.entries(data)) {
            const val = Array.isArray(v) ? v.join(', ') : v instanceof Date ? v.toISOString().slice(0, 10)
              : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
            rows.push(el('dt', {}, [{ type: 'text', value: k }]), el('dd', {}, [{ type: 'text', value: val }]))
          }
        }
      } catch {
        rows = [el('pre', {}, [{ type: 'text', value: node.value }])]
      }
      const e = el('details', { className: ['props'], ...pos(node) }, [
        el('summary', {}, [{ type: 'text', value: 'Properties' }]),
        el('dl', {}, rows),
      ])
      state.patch(node, e)
      return e
    },
    highlight(state, node: Highlight) {
      return el('mark', { className: ['hl'], dataC: node.slot, dataSyntax: node.syntax, dataHex: node.hex, ...pos(node) }, state.all(node as any))
    },
    wikilink(state, node: WikiLink) {
      return el('span', {
        className: node.embed ? ['wikilink', 'embed'] : ['wikilink'],
        dataTarget: node.target, dataHeading: node.heading, title: [node.target, node.heading].filter(Boolean).join(' › '), ...pos(node),
      }, [{ type: 'text', value: node.display }])
    },
    caps(state, node: any) {
      return el('span', { className: ['caps'] }, state.all(node))
    },
    callout(state, node: Callout) {
      const kind = CALLOUT_ALIASES[node.calloutType] ?? node.calloutType
      let title = state.all({ type: 'paragraph', children: node.title } as any)
      if (!title.length) title = [{ type: 'text', value: node.calloutType[0].toUpperCase() + node.calloutType.slice(1) }]
      const body = el('div', { className: ['callout-content'] }, state.wrap(state.all(node as any), true))
      const props = { className: ['callout'], dataCallout: kind, ...pos(node) }
      const e = node.fold
        ? el('details', { ...props, open: node.fold === '+' }, [el('summary', { className: ['callout-title'] }, title), body])
        : el('div', props, [el('div', { className: ['callout-title'] }, title), body])
      state.patch(node as any, e)
      return e
    },
  } as Handlers
}

// Raw HTML from the file is parsed and then sanitised: no scripts, no
// event handlers, no styles. Leading's own attributes are allowed through.
const SCHEMA: Schema = {
  ...defaultSchema,
  clobber: ['name'],
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark', 'u', 'details', 'summary', 'span', 'abbr', 'kbd', 'small', 'cite', 'figure', 'figcaption', 'section'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'data*', 'dir', 'id', 'title'],
    details: ['open'],
  },
}

// Block-level HTML containers that Markdown authors open and close around
// ordinary Markdown content (GitHub-style collapsible sections, centred divs).
const CONTAINER_TAG = /<(\/?)(details|div|section|figure|aside|center)\b[^>]*>/gi

/** Opened minus closed container tags in a piece of raw HTML. */
export function containerDepth(html: string): number {
  let d = 0
  for (const m of html.matchAll(CONTAINER_TAG)) d += m[1] ? -1 : 1
  return d
}

function hasRaw(node: any): boolean {
  if (node.type === 'raw') return true
  return Array.isArray(node.children) && node.children.some(hasRaw)
}

export function render(tree: Root, opts: RenderOptions = {}): RenderResult {
  const outline: OutlineItem[] = []
  const tex: string[] = []
  const hast = toHast(tree, { allowDangerousHtml: true, handlers: makeHandlers(outline, opts, tex) }) as HastRoot
  const blocks: Block[] = []
  // HTML blocks arrive as top-level "raw" nodes; everything else as elements.
  const kids = hast.children.filter((c) => c.type === 'element' || c.type === ('raw' as string))
  for (let k = 0; k < kids.length; k++) {
    // An HTML block that opens a container (<details>, <div>…) and leaves it
    // open swallows the following blocks up to its closing tag, as a browser
    // would: Markdown splits them apart at blank lines, HTML does not.
    const group = [kids[k]]
    let depth = kids[k].type === ('raw' as string) ? containerDepth((kids[k] as any).value) : 0
    while (depth > 0 && k + 1 < kids.length) {
      const next = kids[++k]
      group.push(next)
      if (next.type === ('raw' as string)) depth += containerDepth((next as any).value)
    }
    let node = group[0] as Element
    if (group.length > 1 || hasRaw(group[0])) {
      const cleaned = sanitize(raw({ type: 'root', children: group } as HastRoot), SCHEMA) as HastRoot
      const els = cleaned.children.filter((n): n is Element => n.type === 'element')
      // Exactly one element per block, so block n is always doc.children[n].
      node = els.length === 1 ? els[0] : el('div', { className: ['html-block'] }, els)
    }
    const s = (group[0].position?.start.offset ?? -1) as number
    const e = (group[group.length - 1].position?.end.offset ?? -1) as number
    Object.assign(node.properties, { dataB: blocks.length, ...(s >= 0 ? { dataS: s, dataE: e } : {}) })
    const text = blockText<any>(node, (n) => (isUnsearched(n.properties?.className) ? null : n.children ?? null), (n) => (n.type === 'element' ? n.tagName : null), (n) => (n.type === 'text' ? n.value : null))
    blocks.push({ html: typeset(toHtml(node), tex), s, e, text })
  }
  // Which block holds each heading (most are blocks themselves; some sit in callouts or lists).
  let b = 0
  for (const item of outline) {
    while (b + 1 < blocks.length && (blocks[b + 1].s < 0 || blocks[b + 1].s <= item.s)) b++
    item.b = b
  }
  return { blocks, outline }
}

export function renderMarkdown(src: string, opts: RenderOptions = {}): RenderResult {
  return render(parse(src), opts)
}

/** Move every position in the tree by `base`, for a piece cut from a longer file. */
export function shiftPositions(node: any, base: number, seen = new WeakSet<object>()): void {
  if (!base) return
  const p = node.position
  // Nodes built by our transforms can share a position object; shift each once.
  if (p && !seen.has(p)) {
    seen.add(p)
    p.start = { ...p.start, offset: p.start.offset + base }
    p.end = { ...p.end, offset: p.end.offset + base }
  }
  if (node.children) for (const c of node.children) shiftPositions(c, base, seen)
  if (node.title) for (const c of node.title) shiftPositions(c, base, seen)
}

/** Render one piece of a longer document; offsets come back absolute. */
export function renderPiece(piece: string, base: number, opts: RenderOptions = {}): RenderResult {
  const tree = parse(piece)
  // Transforms are done (they used piece-local offsets); now make them absolute.
  shiftPositions(tree, base)
  return render(tree, opts)
}
