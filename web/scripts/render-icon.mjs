// Renders the icon's two layers (docs/icon/layers.html) to transparent
// 1024 × 1024 PNGs inside mac/Resources/AppIcon.icon/Assets. Uses the same
// WebKit as the tests, so Literata draws exactly as it does in the app.
//   node web/scripts/render-icon.mjs
import { webkit } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const browser = await webkit.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 2048 } })
await page.goto('file://' + root + 'docs/icon/layers.html')
await page.evaluate(() => document.fonts.ready)
for (const id of ['stroke', 'letter']) {
  await page.locator('#' + id).screenshot({ path: root + `mac/Resources/AppIcon.icon/Assets/${id}.png`, omitBackground: true })
}
await browser.close()
console.log('✓ icon layers rendered')
