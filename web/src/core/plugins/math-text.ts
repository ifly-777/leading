// Inline math with single dollars, by Obsidian's rules, so prices stay prose.
//
// micromark-extension-math (run with singleDollarTextMath off) handles $$…$$.
// A single $ opens math only when the next character is not a space, and
// closes it only when the character before is not a space and the one after
// is not a digit. So "$x^2$" is math, while "it costs $5 and $10" is text.
// Like code spans, math is found by the tokenizer, before emphasis and
// escapes: "$a*b*c$" and "$\{x\}$" reach KaTeX exactly as written.
//
// The tokens are the ones mdast-util-math already turns into `inlineMath`.
// Adapted from micromark-extension-math's math-text.js (MIT, Titus Wormer).

import type { Code, Construct, Effects, Extension, Resolver, State, Token, TokenizeContext } from 'micromark-util-types'

const DOLLAR = 36
const SPACE = 32
const isLineEnding = (code: Code) => code !== null && code < -2
const isDigit = (code: Code) => code !== null && code >= 48 && code <= 57

function tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let prev: Code = null
  let token: Token

  return start

  function start(code: Code): State | undefined {
    effects.enter('mathText')
    effects.enter('mathTextSequence')
    effects.consume(code)
    return afterOpen
  }

  function afterOpen(code: Code): State | undefined {
    // "$$" belongs to the stock construct; "$ " and a lone "$" at the end are prose.
    if (code === DOLLAR || code === SPACE || code === null || isLineEnding(code)) return nok(code)
    effects.exit('mathTextSequence')
    return between(code)
  }

  function between(code: Code): State | undefined {
    // Single-dollar math stays on one line, as in Obsidian.
    if (code === null || isLineEnding(code)) return nok(code)
    if (code === DOLLAR) {
      token = effects.enter('mathTextSequence')
      effects.consume(code)
      return afterClose
    }
    if (code === SPACE) {
      effects.enter('space')
      effects.consume(code)
      effects.exit('space')
      prev = code
      return between
    }
    effects.enter('mathTextData')
    return data(code)
  }

  function data(code: Code): State | undefined {
    if (code === null || code === SPACE || code === DOLLAR || isLineEnding(code)) {
      effects.exit('mathTextData')
      return between(code)
    }
    effects.consume(code)
    prev = code
    return data
  }

  function afterClose(code: Code): State | undefined {
    // A space before it: this $ cannot close, so the opening one was a price
    // ("$3.50 vs $x$"). Give up here; the next $ gets its own try.
    if (prev === SPACE) return nok(code)
    // A digit after it ("$x$5"), or a second $: text inside the math, keep looking.
    if (isDigit(code) || code === DOLLAR) {
      token.type = 'mathTextData'
      prev = DOLLAR
      return data(code)
    }
    effects.exit('mathTextSequence')
    effects.exit('mathText')
    return ok(code)
  }
}

/** Join the spaces and data between the dollars into one data token, as the stock resolver does. */
const resolve: Resolver = (events) => {
  const head = 3
  const tail = events.length - 4
  let enter: number | undefined
  let tailExit = tail + 1
  for (let i = head; i <= tailExit; i++) {
    if (enter === undefined) {
      if (i !== tailExit) enter = i
    } else if (i === tailExit) {
      events[enter][1].type = 'mathTextData'
      if (i !== enter + 2) {
        events[enter][1].end = events[i - 1][1].end
        events.splice(enter + 2, i - enter - 2)
        tailExit -= i - enter - 2
        i = enter + 2
      }
      enter = undefined
    }
  }
  return events
}

/** Not after another $ or an escaping backslash. */
function previous(this: TokenizeContext, code: Code): boolean {
  return code !== DOLLAR || this.events[this.events.length - 1][1].type === 'characterEscape'
}

const singleDollarMath: Construct = { name: 'mathTextSingle', tokenize, resolve, previous }

export function obsidianMathText(): Extension {
  return { text: { [DOLLAR]: singleDollarMath } }
}
