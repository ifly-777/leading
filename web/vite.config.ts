import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// The "browser" build of this package decodes entities with document.createElement,
// which does not exist inside Web Workers. Its plain build works everywhere.
const plain = (p: string) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url))

// The prototype page is served from web/; the Mac app build (Stage 2) adds its own entry.
export default defineConfig({
  root: '.',
  resolve: { alias: { 'decode-named-character-reference': plain('decode-named-character-reference/index.js') } },
  server: { port: 5173, strictPort: true },
  // `npm run build` makes the page the Mac app loads. Relative paths, because
  // the app serves it from its own leading:// address, not a web server.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'safari18',
    rollupOptions: { input: { app: fileURLToPath(new URL('./app.html', import.meta.url)) } },
  },
  worker: { format: 'es' },
  test: { include: ['test/unit/**/*.test.ts'] },
} as any)
