// Reading settings: defaults, allowed ranges, and how they become CSS.
// The stylesheet reads only custom properties and data attributes, so the
// settings panel (prototype now, native popover later) never touches CSS rules.

import type { HighlightSlot } from './nodes'

export type FontId = 'literata' | 'newyork' | 'charter' | 'atkinson' | 'quattro' | 'custom'
export type Theme = 'system' | 'light' | 'sepia' | 'dark'
export type Measure = 'narrow' | 'medium' | 'wide'
export type HighlightStyle = 'marker' | 'lowlight' | 'underline'

export interface Settings {
  font: FontId
  customFont: string
  monoFont: 'sfmono' | 'iamono'
  size: number // px
  lineHeight: number
  measure: Measure
  theme: Theme
  letterSpacing: number // em
  wordSpacing: number // em
  paragraphStyle: 'space' | 'indent'
  paragraphSpacing: number // em, used in 'space' mode
  align: 'left' | 'justify'
  highlightStyle: HighlightStyle
  zebra: boolean
  outlineOpen: boolean
  /** Curly quotes, dashes and ellipses as you type in edit mode */
  smartTyping: boolean
  /** The colour ⇧⌘H applies */
  lastHighlight: HighlightSlot
  /**
   * The reader's own display colours for each slot (light also serves sepia).
   * Only how Leading shows a colour changes; files keep the standard hex.
   */
  highlightColors: { light: Partial<Record<HighlightSlot, string>>; dark: Partial<Record<HighlightSlot, string>> }
}

export const DEFAULTS: Settings = {
  font: 'literata',
  customFont: '',
  monoFont: 'sfmono',
  size: 19,
  lineHeight: 1.5,
  measure: 'medium',
  theme: 'system',
  letterSpacing: 0,
  wordSpacing: 0,
  paragraphStyle: 'space',
  paragraphSpacing: 0.8,
  align: 'left',
  highlightStyle: 'marker',
  zebra: false,
  outlineOpen: false,
  smartTyping: true,
  lastHighlight: 'yellow',
  highlightColors: { light: {}, dark: {} },
}

export const RANGES = {
  size: { min: 14, max: 28, step: 1 },
  lineHeight: { min: 1.2, max: 2.0, step: 0.05 },
  letterSpacing: { min: -0.02, max: 0.12, step: 0.005 },
  wordSpacing: { min: 0, max: 0.16, step: 0.01 },
  paragraphSpacing: { min: 0, max: 2, step: 0.1 },
} as const

/** Target characters per line for each measure setting. */
export const MEASURE_CHARS: Record<Measure, number> = { narrow: 55, medium: 66, wide: 80 }

export const FONTS: Record<Exclude<FontId, 'custom'>, { label: string; family: string; variable: boolean }> = {
  literata: { label: 'Literata', family: '"Literata", ui-serif, Georgia, serif', variable: true },
  // ui-serif is how WebKit names the system serif, New York.
  newyork: { label: 'New York', family: 'ui-serif, "New York", Georgia, serif', variable: true },
  charter: { label: 'Charter', family: '"Charter", "Charter BT", Georgia, serif', variable: false },
  atkinson: { label: 'Atkinson Hyperlegible Next', family: '"Atkinson Hyperlegible Next", system-ui, sans-serif', variable: true },
  quattro: { label: 'iA Writer Quattro', family: '"iA Writer Quattro V", system-ui, sans-serif', variable: true },
}

export const MONO_FONTS = {
  sfmono: { label: 'SF Mono', family: 'ui-monospace, "SF Mono", Menlo, monospace' },
  iamono: { label: 'iA Writer Mono', family: '"iA Writer Mono V", ui-monospace, monospace' },
}

export function fontFamily(s: Settings): string {
  if (s.font === 'custom' && s.customFont.trim()) return `"${s.customFont.trim().replace(/"/g, '')}", ui-serif, serif`
  return FONTS[s.font === 'custom' ? 'literata' : s.font].family
}

// ---------------------------------------------------------------------------
// Look-and-feel values tuned by eye in the Stage 1 prototype. They are not
// user settings; the prototype exposes them so the defaults can be chosen.

export interface ThemeColors {
  bg: string; fg: string; muted: string; rule: string; codeBg: string; link: string
  search: string
  hlFill: Record<HighlightSlot, string>
  hlLine: Record<HighlightSlot, string>
}

export interface Tuning {
  headingRatio: number
  darkWeight: number // body weight in dark mode (variable fonts only)
  lightWeight: number
  outlineSize: number // px
  outlineIdleOpacity: number
  themes: Record<'light' | 'sepia' | 'dark', ThemeColors>
}

export const TUNING: Tuning = {
  headingRatio: 1.2,
  darkWeight: 370,
  lightWeight: 400,
  outlineSize: 13,
  outlineIdleOpacity: 0.5,
  themes: {
    light: {
      bg: '#FBF8F2', fg: '#2B2824', muted: '#837B70', rule: '#E4DDD1', codeBg: '#F3EEE5', link: '#2F5F8F', search: '#7A5CFA',
      hlFill: { yellow: '#FBE59B', green: '#CFEBC3', blue: '#CFE0F7', pink: '#F7D0E2', orange: '#F9D6AE' },
      hlLine: { yellow: '#D9A900', green: '#4C9A4F', blue: '#3B7BC8', pink: '#C8538A', orange: '#D9812A' },
    },
    sepia: {
      bg: '#F4EAD5', fg: '#3D3226', muted: '#8A7A64', rule: '#E0D3B9', codeBg: '#EDE1C8', link: '#5A4A8A', search: '#7A5CFA',
      hlFill: { yellow: '#F0D97F', green: '#CBDDAE', blue: '#C6D5E0', pink: '#EBC5CB', orange: '#EDC594' },
      hlLine: { yellow: '#B98F00', green: '#4F8B45', blue: '#3C6F9E', pink: '#B04F6F', orange: '#C06D1F' },
    },
    dark: {
      bg: '#1E1D1B', fg: '#DCD6CC', muted: '#8E877C', rule: '#34322E', codeBg: '#282623', link: '#8FB5E0', search: '#A08BFF',
      hlFill: { yellow: '#5B4C1C', green: '#2D4A2E', blue: '#263E5C', pink: '#5A2E45', orange: '#5E3E1F' },
      hlLine: { yellow: '#D8B84B', green: '#7DBA77', blue: '#72A5E2', pink: '#DE82AC', orange: '#E59D58' },
    },
  },
}

/**
 * The underline colour for a reader's own fill colour (Lowlight and Underline
 * styles): the same hue, deeper on light paper and brighter on dark.
 */
export function lineFor(fill: string, dark: boolean): string {
  const m = /^#?([0-9a-f]{6})/i.exec(fill.trim())
  if (!m) return fill
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  // A clear hue at a readable lightness; greys stay grey.
  const sat = d < 0.08 ? 0 : 65
  return `hsl(${h.toFixed(0)} ${sat}% ${dark ? 68 : 42}%)`
}

export function resolveTheme(t: Theme, prefersDark: boolean): 'light' | 'sepia' | 'dark' {
  return t === 'system' ? (prefersDark ? 'dark' : 'light') : t
}

/** Write settings onto the document root as CSS variables and data attributes. */
export function applySettings(root: HTMLElement, s: Settings, tuning: Tuning, opts: { prefersDark: boolean; avgCharEm: number }): void {
  const theme = resolveTheme(s.theme, opts.prefersDark)
  const c = tuning.themes[theme]
  const v = (k: string, val: string | number) => root.style.setProperty(k, String(val))
  v('--font-body', fontFamily(s))
  v('--font-mono', MONO_FONTS[s.monoFont].family)
  v('--size', s.size + 'px')
  v('--lh', s.lineHeight)
  // The measure is set in em, calibrated per font from its average character width.
  v('--measure', (MEASURE_CHARS[s.measure] * opts.avgCharEm).toFixed(3) + 'em')
  v('--measure-narrow', (MEASURE_CHARS.narrow * opts.avgCharEm).toFixed(3) + 'em')
  v('--ls', s.letterSpacing + 'em')
  v('--ws', s.wordSpacing + 'em')
  v('--para', s.paragraphStyle === 'space' ? s.paragraphSpacing + 'em' : '0')
  v('--indent', s.paragraphStyle === 'indent' ? '1.5em' : '0')
  v('--ratio', tuning.headingRatio)
  const variable = s.font === 'custom' || FONTS[s.font].variable
  v('--weight', theme === 'dark' && variable ? tuning.darkWeight : tuning.lightWeight)
  v('--outline-size', tuning.outlineSize + 'px')
  v('--outline-idle', tuning.outlineIdleOpacity)
  for (const [k, val] of Object.entries(c)) {
    if (typeof val === 'string') v('--' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), val)
  }
  const own = (theme === 'dark' ? s.highlightColors?.dark : s.highlightColors?.light) ?? {}
  for (const [slot, val] of Object.entries(c.hlFill)) {
    const mine = own[slot as HighlightSlot]
    v(`--hl-${slot}`, mine ?? val)
    v(`--hl-${slot}-line`, mine ? lineFor(mine, theme === 'dark') : c.hlLine[slot as HighlightSlot])
  }
  root.dataset.theme = theme
  root.dataset.align = s.align
  root.dataset.para = s.paragraphStyle
  root.dataset.hlStyle = s.highlightStyle
  root.dataset.zebra = String(s.zebra)
}
