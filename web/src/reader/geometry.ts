// Vertical position of an element within the scroller, from offsets only.
// Rect queries (getBoundingClientRect) can force layout of skipped content
// and are avoided on long pages; offsets are answered from existing boxes.

export function topIn(el: HTMLElement, scroller: HTMLElement): number {
  let y = 0
  for (let e: HTMLElement | null = el; e && e !== scroller; e = e.offsetParent as HTMLElement | null) y += e.offsetTop
  return y
}
