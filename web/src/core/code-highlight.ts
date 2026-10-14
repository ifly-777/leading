// Colour for code blocks: highlight.js grammars through lowlight, which
// returns a hast tree, so highlighting happens in the parsing workers with
// the rest of the block and the colours arrive with the first paint.
// Only blocks that name their language are coloured: guessing is slow and
// often wrong. The set below covers what turns up in notes; each grammar is
// a few kilobytes, so rare languages are left out to keep opening quick.

import { createLowlight } from 'lowlight'
import type { ElementContent } from 'hast'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import latex from 'highlight.js/lib/languages/latex'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import objectivec from 'highlight.js/lib/languages/objectivec'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, latex, lua, makefile,
  markdown, objectivec, perl, php, python, r, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml,
})
// Names notes use that the grammars do not register themselves.
lowlight.registerAlias({ bash: ['sh', 'zsh', 'console'], xml: ['html', 'svg', 'plist'], ini: ['toml'], javascript: ['jsx', 'mjs'], typescript: ['tsx'] })

/** A huge block is shown plain: colouring it would hold up the page. */
const MAX_CHARS = 100_000

/** The coloured contents of a code block, or null to leave it plain. */
export function highlightCode(lang: string | null | undefined, code: string): ElementContent[] | null {
  if (!lang || code.length > MAX_CHARS) return null
  const name = lang.toLowerCase()
  if (!lowlight.registered(name)) return null
  try {
    return lowlight.highlight(name, code).children as ElementContent[]
  } catch {
    return null
  }
}
