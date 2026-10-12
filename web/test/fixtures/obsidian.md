---
title: Obsidian compatibility
aliases: [Obsidian test, Vault note]
tags:
  - reading
  - typography/leading
created: 2026-09-14
status: draft
rating: 4
---

# An Obsidian note

The front matter above should be hidden behind a single quiet *Properties* line. Open it to check the values. This note links to [[Typography]], to [[Reading list|my reading list]], to a heading in another note with [[Leading#History]], and to a block with [[Notes#^abc123]]. An embed looks like this: ![[diagram.png]]. Tags such as #reading and #typography/leading stay as plain text in v1.

## Callouts

> [!note]
> A plain note, with no title of its own, so the type becomes the title.

> [!note] A note with a title
> And a body that runs to a second sentence, so the spacing between title and body can be judged.

> [!abstract] Summary
> Abstract, summary and tl;dr share a colour.

> [!info] Info
> For information.

> [!todo] To do
> - [ ] Write the welcome document
> - [x] Choose the fonts

> [!tip] Tip
> Tip, hint and important share a colour.

> [!success] Done
> Success, check and done.

> [!question] Open question
> Does the outline need a filter box when opened with the mouse?

> [!warning] Warning
> Warning, caution and attention.

> [!failure] Failure
> Failure, fail and missing.

> [!danger] Danger
> Danger and error.

> [!bug] Bug
> A bug report.

> [!example] Example
> An example, with `inline code` and a [[wikilink]].

> [!quote] Quote
> "Typography exists to honour content." A quote callout uses the muted colour.

> [!warning]- Folded by default
> This callout starts closed. Click its title to open it.

> [!tip]+ Foldable, open by default
> This one starts open and can be closed.

> [!note] Nested callouts
> The outer callout.
> > [!warning] Inner
> > A callout inside a callout.

> An ordinary blockquote is not a callout. It should look calmer: a thin rule and slightly softer ink.

## Tasks and footnotes

- [x] Render callouts
- [x] Hide front matter
- [ ] Clickable wikilinks (not in v1)

Obsidian supports footnotes like this one.[^note]

[^note]: Footnotes appear at the end, set small.
