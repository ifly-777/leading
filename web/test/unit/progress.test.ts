import { expect, test } from 'vitest'
import { cumulativeWords, progressAt, timeLeftLabel } from '../../src/reader/progress'

const blocks = [{ text: 'One two three' }, { text: '' }, { text: 'four  five\nsix seven' }]

test('words before each block add up, empty blocks count nothing', () => {
  expect(Array.from(cumulativeWords(blocks))).toEqual([0, 3, 3, 7])
})

test('progress counts the part of the top block already scrolled past', () => {
  const cum = cumulativeWords(blocks)
  expect(progressAt(cum, 0, 0)).toEqual({ fraction: 0, wordsLeft: 7 })
  expect(progressAt(cum, 2, 0.5)).toEqual({ fraction: 5 / 7, wordsLeft: 2 })
  // Out-of-range inputs are clamped rather than producing nonsense.
  expect(progressAt(cum, 9, 3).fraction).toBe(1)
  expect(progressAt(cum, -1, -1).fraction).toBe(0)
  expect(progressAt(cumulativeWords([{ text: '' }]), 0, 0)).toEqual({ fraction: 1, wordsLeft: 0 })
})

test('time left reads naturally at 238 words a minute', () => {
  expect(timeLeftLabel(0)).toBe('The end')
  expect(timeLeftLabel(100)).toBe('Less than a minute left')
  expect(timeLeftLabel(238 * 14)).toBe('14 min left')
  expect(timeLeftLabel(238 * 60)).toBe('1 h left')
  expect(timeLeftLabel(238 * 95)).toBe('1 h 35 min left')
})
