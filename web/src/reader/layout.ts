// Where the reading column, the outline and wide tables go, for a given
// window width. Pure arithmetic so it can be unit-tested; layout.apply()
// writes the result as CSS variables.

export interface LayoutInput {
  width: number // usable width of the reading window, px
  fontPx: number
  measureEm: number // chosen line length, in em of the body font
  narrowEm: number // the "Narrow" setting: the outline may never squeeze the text below this
  outlineOpen: boolean
}

export interface LayoutResult {
  colLeft: number
  colW: number
  outline: 'hidden' | 'margin' | 'popover'
  outlineLeft: number
  outlineW: number
  availLeft: number // the area wide tables may use
  availW: number
}

const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function computeLayout(i: LayoutInput): LayoutResult {
  const gutter = clamp(20, i.width * 0.06, 72)
  const maxCol = i.width - 2 * gutter
  const colW = Math.max(0, Math.min(i.measureEm * i.fontPx, maxCol))
  const narrowW = Math.min(i.narrowEm * i.fontPx, colW)
  const outlineW = clamp(150, i.width * 0.17, 230)
  const gap = clamp(28, i.width * 0.035, 56)
  const centred = (i.width - colW) / 2
  const plain: LayoutResult = {
    colLeft: centred, colW, outline: 'hidden', outlineLeft: 0, outlineW,
    availLeft: gutter, availW: maxCol,
  }
  if (!i.outlineOpen) return plain

  const withOutline = (colLeft: number, w: number): LayoutResult => {
    const outlineLeft = colLeft + w + gap
    return { colLeft, colW: w, outline: 'margin', outlineLeft, outlineW, availLeft: gutter, availW: outlineLeft - gap - gutter }
  }
  // 1. Wide window: the outline fits in the right margin; the column stays centred.
  if (i.width - (centred + colW) >= gap + outlineW + gutter) return withOutline(centred, colW)
  // 2. Shift the column left just enough to make room.
  const shifted = i.width - gutter - outlineW - gap - colW
  if (shifted >= gutter) return withOutline(shifted, colW)
  // 3. Shorten the line, but never below the Narrow measure.
  const squeezed = i.width - 2 * gutter - outlineW - gap
  if (squeezed >= narrowW) return withOutline(gutter, squeezed)
  // 4. No room: the text keeps its place and the outline floats as a popover.
  return { ...plain, outline: 'popover' }
}

export function applyLayout(root: HTMLElement, r: LayoutResult): void {
  const px = (n: number) => Math.round(n) + 'px'
  root.style.setProperty('--col-left', px(r.colLeft))
  root.style.setProperty('--col-w', px(r.colW))
  root.style.setProperty('--avail-w', px(r.availW))
  // Relative to the column's left edge, which is where the bleed wrapper starts.
  root.style.setProperty('--avail-offset', px(r.availLeft - r.colLeft))
  root.style.setProperty('--outline-left', px(r.outlineLeft))
  root.style.setProperty('--outline-w', px(r.outlineW))
}
