// Photographs docs/video/film.html one frame at a time in WebKit (the engine
// the app itself uses): render(t) for each frame, then a screenshot.
//   node web/scripts/film-frames.mjs <page-url> <out-dir> <seconds> <fps> <width>x<height>
import { webkit } from 'playwright'
const [url, out, seconds, fps, size] = process.argv.slice(2)
const [width, height] = size.split('x').map(Number)
const browser = await webkit.launch()
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
await page.goto(url)
await page.evaluate(() => setup())
const frames = Math.round(Number(seconds) * Number(fps))
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => render(t), i / Number(fps))
  await page.screenshot({ path: `${out}/${String(i).padStart(4, '0')}.png` })
  if (i % 60 === 0) process.stdout.write(`  ${Math.round(i / Number(fps))} s\r`)
}
await browser.close()
