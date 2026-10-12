// Generates a deterministic ~5 MB Markdown file (about 800,000 words) for
// speed tests. Synthetic text from a seeded generator, so it contains no
// copyrighted material and is identical on every machine.

import { writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const out = fileURLToPath(new URL('../test/fixtures/stress-5mb.md', import.meta.url))
const TARGET = 5 * 1024 * 1024

// Small seeded PRNG (mulberry32): same sequence every run.
let seed = 20261012
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = (a) => a[Math.floor(rand() * a.length)]

const words = ('the of and a to in is was that for it with as on be at by this had not are but from or have an they which one you were all we her she there would their will when who him been has more if no out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three'.split(' '))
const rare = ['café', 'naïve', 'résumé', 'Zürich', 'São Paulo', 'façade', 'coöperate', 'NASA', 'ICAO', 'METAR', 'B777', 'FL350', 'it\'s', 'don\'t', '"quoted"', 'well--known', 'pause...', 'Leading', 'measure', 'kerning']
const slots = [['==', '=='], ['<mark style="background: #BBFABBA6;">', '</mark>'], ['<mark style="background: #ADCCFFA6;">', '</mark>']]

function sentence() {
  const n = 8 + Math.floor(rand() * 18)
  const w = []
  for (let i = 0; i < n; i++) w.push(rand() < 0.04 ? pick(rare) : pick(words))
  // Sprinkle inline formatting at realistic rates.
  if (rand() < 0.15) { const i = Math.floor(rand() * n); w[i] = `**${w[i]}**` }
  if (rand() < 0.12) { const i = Math.floor(rand() * n); w[i] = `*${w[i]}*` }
  if (rand() < 0.05) { const i = Math.floor(rand() * n); w[i] = `[${w[i]}](https://example.com/${i})` }
  if (rand() < 0.04) { const i = Math.floor(rand() * n); w[i] = '`' + w[i] + '`' }
  if (rand() < 0.08) { const [a, b] = pick(slots); const i = Math.floor(rand() * (n - 3)); w[i] = a + w[i]; w[i + 2] = w[i + 2] + b }
  const s = w.join(' ')
  return s[0].toUpperCase() + s.slice(1) + pick(['.', '.', '.', '?', '!', ';'])
}
const paragraph = () => Array.from({ length: 3 + Math.floor(rand() * 6) }, sentence).join(' ')

let md = '---\ntitle: Stress test\ntags: [stress, performance]\n---\n\n# A very long document\n\n'
let chapter = 0, section = 0
while (md.length < TARGET) {
  if (section % 12 === 0) md += `## Chapter ${++chapter}: ${sentence().slice(0, 40).replace(/[*`=\[\]<>"]/g, '')}\n\n`
  md += `### Section ${chapter}.${++section % 12 || 12}\n\n`
  for (let p = 0; p < 10; p++) {
    const r = rand()
    if (r < 0.06) md += Array.from({ length: 4 }, () => '- ' + sentence()).join('\n') + '\n\n'
    else if (r < 0.08) md += `> [!${pick(['note', 'tip', 'warning'])}] ${pick(words)}\n> ${sentence()}\n\n`
    else if (r < 0.095) md += '| Item | Value | Note |\n|---|---|---|\n' + Array.from({ length: 6 }, (_, i) => `| ${pick(words)} | ${Math.floor(rand() * 99999).toLocaleString('en')} | ${sentence()} |`).join('\n') + '\n\n'
    else if (r < 0.105) md += '```\n' + Array.from({ length: 5 }, sentence).join('\n') + '\n```\n\n'
    else if (r < 0.12) md += '> ' + paragraph() + '\n\n'
    else md += paragraph() + '\n\n'
  }
}
writeFileSync(out, md)
console.log(`stress-5mb.md: ${(statSync(out).size / 1048576).toFixed(2)} MB, ~${md.split(/\s+/).length.toLocaleString('en')} words`)
