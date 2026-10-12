import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import { parse, render } from '../../src/core/pipeline'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'

// Rough Node timing of the 5 MB stress file; the real gate runs in WebKit.
test.skipIf(!process.env.BENCH)('5 MB parse timing (Node)', () => {
  const src = readFileSync(new URL('../fixtures/stress-5mb.md', import.meta.url), 'utf8')
  let t = performance.now()
  fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const bare = performance.now() - t
  t = performance.now()
  const tree = parse(src)
  const full = performance.now() - t
  t = performance.now()
  const r = render(tree)
  const rend = performance.now() - t
  process.stdout.write(`bare remark+gfm ${bare.toFixed(0)} ms | our parse ${full.toFixed(0)} ms | render ${rend.toFixed(0)} ms | ${r.blocks.length} blocks | html ${(r.blocks.reduce((n, b) => n + b.html.length, 0) / 1e6).toFixed(1)} MB\n`)
}, 120_000)
