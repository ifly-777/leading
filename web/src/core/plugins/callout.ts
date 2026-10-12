// Obsidian callouts: a blockquote whose first line is "[!type]" (optionally
// "+" or "-" for foldable) followed by an optional title.

import type { Parent, PhrasingContent, Root, Paragraph, Blockquote } from 'mdast'
import type { Callout } from '../nodes'
import { sliceText } from './inline'

const HEAD = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/

function toCallout(bq: Blockquote, src: string): Callout | null {
  const first = bq.children[0]
  if (first?.type !== 'paragraph') return null
  const t = first.children[0]
  if (t?.type !== 'text' || !t.position) return null
  const m = HEAD.exec(t.value)
  if (!m) return null

  // The title is everything on the first line; the rest of that paragraph is body.
  const inline: PhrasingContent[] = [sliceText(t, m[0].length, t.value.length, src), ...first.children.slice(1)]
  const title: PhrasingContent[] = []
  const rest: PhrasingContent[] = []
  let inTitle = true
  for (const c of inline) {
    if (!inTitle) { rest.push(c); continue }
    if (c.type === 'text' && c.value.includes('\n')) {
      const nl = c.value.indexOf('\n')
      if (nl > 0) title.push(sliceText(c, 0, nl, src))
      if (nl + 1 < c.value.length) rest.push(sliceText(c, nl + 1, c.value.length, src))
      inTitle = false
    } else if (c.type === 'break') {
      inTitle = false
    } else if (!(c.type === 'text' && c.value === '')) {
      title.push(c)
    }
  }
  const children = [...bq.children.slice(1)]
  if (rest.length) {
    const body: Paragraph = {
      type: 'paragraph', children: rest,
      position: { start: rest[0].position!.start, end: first.position!.end },
    }
    children.unshift(body)
  }
  return {
    type: 'callout', calloutType: m[1].toLowerCase(), fold: m[2] as Callout['fold'],
    title, children: children as Callout['children'], position: bq.position,
  }
}

export function transformCallouts(root: Root, src: string): void {
  const walk = (node: Parent) => {
    node.children.forEach((c, i) => {
      if (c.type === 'blockquote') {
        const co = toCallout(c, src)
        if (co) node.children[i] = co as any
      }
      const now = node.children[i]
      if ('children' in now) walk(now as Parent)
    })
  }
  walk(root)
}
