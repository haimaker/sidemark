// Checks the landing page. Run from the repository root: node site/check.mjs
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from '../packages/core/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const md = readFileSync(join(here, 'public', 'commentmark.md'), 'utf8')
const html = readFileSync(join(here, 'public', 'index.html'), 'utf8')
const css = readFileSync(join(here, 'public', 'styles.css'), 'utf8')
const failures = []

// (a) The Source view is the file, byte for byte.
const pre = html.match(/<pre class="source" id="source">([\s\S]*?)<\/pre>/)
if (!pre) {
  failures.push('Source view: no <pre class="source" id="source"> in index.html')
} else {
  const text = pre[1]
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
  // An HTML parser drops one newline directly after <pre>.
  if (text.startsWith('\n')) failures.push('Source view: starts with a newline, which the HTML parser drops')
  if (text !== md) {
    let i = 0
    while (i < text.length && text[i] === md[i]) i++
    failures.push(`Source view: differs from commentmark.md at offset ${i}: ${JSON.stringify(text.slice(i, i + 40))} vs ${JSON.stringify(md.slice(i, i + 40))}`)
  }
}

// (b) The file is a clean CommentMark document with four anchored threads.
const doc = parse(md)
const anchored = doc.threads.filter((t) => t.attachment.kind === 'anchored' && t.attachment.via === 'anchors')
if (doc.threads.length !== 4 || anchored.length !== 4) {
  failures.push(`parse: expected 4 anchored threads, got ${anchored.length} of ${doc.threads.length}`)
}
if (doc.strayAnchors.length) failures.push(`parse: ${doc.strayAnchors.length} stray anchors`)
if (doc.malformedRows.length) failures.push(`parse: ${doc.malformedRows.length} malformed rows`)

// (c) No remote resources and no scripts.
if (/<script/i.test(html)) failures.push('index.html contains <script')
for (const m of html.matchAll(/\bsrc\s*=\s*["']?\s*(https?:)?\/\//gi)) failures.push(`index.html: remote src= at ${m.index}`)
for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
  const tag = m[0]
  const href = tag.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? ''
  if (/^(https?:)?\/\//i.test(href) && !/\brel\s*=\s*["']?canonical\b/i.test(tag)) failures.push(`index.html: remote <link href>: ${tag}`)
}
for (const [name, text] of [['index.html', html], ['styles.css', css]]) {
  for (const m of text.matchAll(/url\(\s*["']?\s*(https?:)?\/\//gi)) failures.push(`${name}: remote url() at ${m.index}`)
  if (/@import/i.test(text)) failures.push(`${name}: @import`)
}

if (failures.length) {
  console.error(`check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(`check passed: Source view matches commentmark.md (${md.length} chars); 4 anchored threads, 0 stray anchors, 0 malformed rows; no remote resources or scripts.`)
