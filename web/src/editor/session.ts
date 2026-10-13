// Everything edit mode needs, loaded on demand: the reading page starts without
// CodeMirror (about half the page's script), and the view imports this module
// the first time the reader presses ⌘E, or quietly a moment after a document
// opens, whichever comes first.

import { SourceEditor, type EditorHost } from './editor'
import { EditorFind } from './editor-find'
import { FormatPopover } from './format-popover'

export interface EditorSession { editor: SourceEditor; find: EditorFind; popover: FormatPopover }

export function createEditorSession(host: HTMLElement, win: HTMLElement, frame: HTMLElement, cb: Omit<EditorHost, 'onSelection'>): EditorSession {
  let popover: FormatPopover | null = null
  const editor = new SourceEditor(host, { ...cb, onSelection: (v) => popover?.update(v) })
  popover = new FormatPopover(win, frame, (f) => editor.format(f))
  return { editor, find: new EditorFind(editor), popover }
}
