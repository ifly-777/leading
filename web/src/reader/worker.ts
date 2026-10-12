// Parses and renders a document, or one piece of a long one, off the main
// thread, so a 5 MB file never freezes scrolling or typing while it loads.
// It also folds the piece's text for search, so the index is ready the
// moment parsing ends.

import { renderPiece, type RenderOptions } from '../core/pipeline'
import { fold } from '../core/fold'

self.onmessage = (e: MessageEvent<{ id: number; index: number; piece: string; base: number; opts: RenderOptions }>) => {
  const { id, index, piece, base, opts } = e.data
  const t0 = performance.now()
  const result = renderPiece(piece, base, opts)
  const folded = fold(result.blocks.map((b) => b.text).join('\n'))
  // Transfer the fold map instead of copying it.
  ;(self as unknown as Worker).postMessage({ id, index, ...result, folded, ms: performance.now() - t0 }, [folded.map.buffer])
}
