// `npm run proto`: makes sure the stress file exists, starts the dev server,
// and opens the prototype in Safari (WebKit is what the app will use).

import { existsSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const stress = fileURLToPath(new URL('../test/fixtures/stress-5mb.md', import.meta.url))
if (!existsSync(stress)) execFileSync(process.execPath, [fileURLToPath(new URL('./gen-stress.mjs', import.meta.url))], { stdio: 'inherit' })

const server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)) })
await server.listen()
const url = 'http://localhost:5173/prototype.html'
console.log(`\nLeading prototype: ${url}\nPress Ctrl-C here to stop.\n`)
spawn('open', ['-a', 'Safari', url], { stdio: 'ignore' })
