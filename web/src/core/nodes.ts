// Custom mdast node types Leading adds on top of CommonMark + GFM.

import type { Parent, PhrasingContent, Node } from 'mdast'

export type HighlightSlot = 'yellow' | 'green' | 'blue' | 'pink' | 'orange'

export interface Highlight extends Parent {
  type: 'highlight'
  slot: HighlightSlot
  /** How it is written in the file: ==text== or <mark …>…</mark> */
  syntax: 'eq' | 'mark'
  /** The literal colour from the file, kept so unknown colours are not lost */
  hex?: string
  children: PhrasingContent[]
}

export interface WikiLink extends Node {
  type: 'wikilink'
  target: string
  heading?: string
  alias?: string
  embed: boolean
  display: string
}

export interface Caps extends Parent {
  type: 'caps'
  children: PhrasingContent[]
}

export interface Callout extends Parent {
  type: 'callout'
  calloutType: string
  fold: '' | '+' | '-'
  title: PhrasingContent[]
}

declare module 'mdast' {
  interface PhrasingContentMap { highlight: Highlight; wikilink: WikiLink; caps: Caps }
  interface RootContentMap { highlight: Highlight; wikilink: WikiLink; caps: Caps; callout: Callout }
  interface BlockContentMap { callout: Callout }
}
