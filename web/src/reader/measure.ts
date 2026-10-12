// Calibrates line length per font. "66 characters" is a different width in
// Literata than in Atkinson, so we measure the font's average character
// width on real prose (spaces included), with the reader's letter and word
// spacing applied, and set the column in em from that.

const SAMPLE =
  'A reader rarely notices good typography. What registers is that the page feels easy, ' +
  'that the eye moves without effort from the end of one line to the start of the next, ' +
  'and that an hour has passed. Bad setting is felt at once, though seldom named.'

/** Average advance width of one character, in em, as currently styled inside `host`. */
export async function avgCharEm(host: HTMLElement): Promise<number> {
  const family = getComputedStyle(host).fontFamily
  try {
    // Make sure the bundled font is ready, or we would measure the fallback.
    await document.fonts.load(`100px ${family}`, SAMPLE)
  } catch { /* system fonts need no loading */ }
  const probe = document.createElement('span')
  probe.textContent = SAMPLE
  // Inherit family, weight and spacing from the column; only the size is fixed.
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px;left:-99999px;top:0;text-indent:0'
  host.appendChild(probe)
  const w = probe.getBoundingClientRect().width
  probe.remove()
  return w / 100 / SAMPLE.length
}
