// Parses and renders a document, or one piece of a long one, off the main
// thread, so a 5 MB file never freezes scrolling or typing while it loads.

import { renderPiece, type RenderOptions } from '../core/pipeline'

self.onmessage = (e: MessageEvent<{ id: number; index: number; piece: string; base: number; opts: RenderOptions }>) => {
  const { id, index, piece, base, opts } = e.data
  const t0 = performance.now()
  const result = renderPiece(piece, base, opts)
  ;(self as unknown as Worker).postMessage({ id, index, ...result, ms: performance.now() - t0 })
}
