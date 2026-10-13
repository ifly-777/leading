// The five highlight colours, and how each is written to disk.
//
// Each slot always writes the same fixed hex (Highlightr's defaults), so files
// stay stable when a reader re-tunes how a colour looks on screen. Yellow is
// written as ==text==, which Obsidian renders natively.
// All five are Highlightr's defaults (src/settings/settingsData.ts), checked
// in Stage 4; Highlightr writes them as <mark style="background: #…;">.

import type { HighlightSlot } from './nodes'

export const SLOTS: HighlightSlot[] = ['yellow', 'green', 'blue', 'pink', 'orange']

export const STORED_HEX: Record<HighlightSlot, string> = {
  yellow: '#FFF3A3A6',
  green: '#BBFABBA6',
  blue: '#ADCCFFA6',
  pink: '#FFB8EBA6',
  orange: '#FFB86CA6',
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)) as [number, number, number]
}

/** Nearest slot for any colour found in a file, so foreign colours still adapt to themes. */
export function slotForColor(color: string | undefined): HighlightSlot {
  if (!color) return 'yellow'
  const lower = color.toLowerCase()
  // Highlightr's class mode and named CSS colours carry the hue in the name.
  for (const s of SLOTS) if (lower.includes(s)) return s
  if (lower.includes('red') || lower.includes('purple')) return 'pink'
  if (lower.includes('cyan')) return 'blue'
  const c = rgb(color)
  if (!c) return 'yellow'
  // Compare hues: a reader thinks "red is nearer pink than orange", which RGB
  // distance gets wrong. Greys (no clear hue) fall back to yellow.
  const h = hue(c)
  if (h === null) return 'yellow'
  let best: HighlightSlot = 'yellow'
  let bestD = Infinity
  for (const s of SLOTS) {
    const d = Math.abs(((hue(rgb(STORED_HEX[s])!)! - h + 540) % 360) - 180)
    if (d < bestD) { bestD = d; best = s }
  }
  return best
}

function hue([r, g, b]: [number, number, number]): number | null {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max - min < 24) return null
  const d = max - min
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** Pull the colour out of a <mark …> tag's style or class attribute. */
export function colorFromMarkTag(tag: string): string | undefined {
  const style = /style\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
  const bg = style && /background(?:-color)?\s*:\s*([^;]+)/i.exec(style)?.[1]
  if (bg) return bg.trim()
  return /class\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
}
