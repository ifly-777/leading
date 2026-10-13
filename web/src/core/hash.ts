// A fingerprint of the text, identical in JavaScript and Swift: FNV-1a (32-bit)
// over UTF-16 code units, the unit both sides use for offsets. The app uses
// it to confirm that its copy of the document matches the editor's.
// (The Swift twin is TextMirror.fingerprint in mac/Sources/LeadingCore.)

export function fingerprint(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
