// Reading progress: a thin rule under the title bar showing how far through
// the file, and "14 min left" at the foot of the window while scrolling.
// Measured in words, not pixels: tables, images and code take far more height
// than reading time, and long pages lay out far-away blocks only roughly.

import type { Block } from '../core/pipeline'

/** Brysbaert (2019): the average adult reads English non-fiction silently at about 238 words a minute. */
export const WORDS_PER_MINUTE = 238

/** Words before each block: cum[b] is the words in blocks 0..b-1, cum[n] the total. */
export function cumulativeWords(blocks: Pick<Block, 'text'>[]): Float64Array {
  const cum = new Float64Array(blocks.length + 1)
  for (let i = 0; i < blocks.length; i++) {
    let n = 0
    // Counting runs of non-space is quick and close enough for a time estimate.
    for (const _ of blocks[i].text.matchAll(/\S+/g)) n++
    cum[i + 1] = cum[i] + n
  }
  return cum
}

/** Fraction read and words left, with the top block `b` scrolled `into` (0..1) of its way past. */
export function progressAt(cum: Float64Array, b: number, into: number): { fraction: number; wordsLeft: number } {
  const total = cum[cum.length - 1]
  if (!total) return { fraction: 1, wordsLeft: 0 }
  const i = Math.max(0, Math.min(b, cum.length - 2))
  const read = cum[i] + (cum[i + 1] - cum[i]) * Math.max(0, Math.min(1, into))
  return { fraction: read / total, wordsLeft: total - read }
}

export function timeLeftLabel(wordsLeft: number, wpm = WORDS_PER_MINUTE): string {
  const min = wordsLeft / wpm
  if (wordsLeft <= 0) return 'The end'
  if (min < 1) return 'Less than a minute left'
  if (min < 60) return `${Math.round(min)} min left`
  const h = Math.floor(min / 60)
  const m = Math.round(min - h * 60)
  return m ? `${h} h ${m} min left` : `${h} h left`
}

/** The two marks on the page. Showing and hiding is the view's decision. */
export class ProgressMark {
  private rule: HTMLElement
  private label: HTMLElement
  private fade = 0

  constructor(win: HTMLElement) {
    this.rule = document.createElement('div')
    this.rule.className = 'progress-rule'
    this.rule.setAttribute('aria-hidden', 'true')
    this.label = document.createElement('div')
    this.label.className = 'progress-left'
    this.label.setAttribute('aria-hidden', 'true')
    win.append(this.rule, this.label)
    this.hide()
  }

  /** Draw the rule; `scrolling` also shows the time left for a moment. */
  show(fraction: number, wordsLeft: number, scrolling: boolean): void {
    this.rule.hidden = false
    this.rule.style.setProperty('--read', String(Math.max(0, Math.min(1, fraction))))
    this.label.textContent = timeLeftLabel(wordsLeft)
    if (!scrolling) return
    this.label.hidden = false
    this.label.classList.add('on')
    clearTimeout(this.fade)
    this.fade = window.setTimeout(() => this.label.classList.remove('on'), 1500)
  }

  hide(): void {
    this.rule.hidden = true
    this.label.hidden = true
    this.label.classList.remove('on')
  }
}
