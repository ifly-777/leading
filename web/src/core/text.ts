// Plain displayed text of an mdast subtree, including Leading's custom nodes.

export function textOf(node: any): string {
  if (!node) return ''
  if (node.type === 'wikilink') return node.display
  if (node.type === 'image') return node.alt ?? ''
  if (typeof node.value === 'string' && node.type !== 'html' && node.type !== 'yaml') return node.value
  if (Array.isArray(node.children)) return node.children.map(textOf).join('')
  return ''
}
