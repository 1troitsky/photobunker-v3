#!/usr/bin/env node
// Offline and deterministic: verify exact Git blob content copied from PB2 PR #56
// plus internal documentation links and map ID coverage. Does not contact PB2.
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const docDir = join(root, 'docs/ux-integration')
const sourceRoot = join(root, 'docs/ux')
const errors = []
const manifest = JSON.parse(await readFile(join(docDir, 'SOURCE-MANIFEST.json'), 'utf8'))
const canonical = new Map(manifest.files.map(f => [f.path, f]))
async function walk(dir) {
  const all = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name)
    if (e.isDirectory()) all.push(...await walk(path))
    else if (e.isFile()) all.push(relative(root, path).split(sep).join('/'))
  }
  return all
}
const actual = (await walk(sourceRoot)).sort()
for (const path of actual) if (!canonical.has(path)) errors.push('Unexpected source file: ' + path)
for (const file of manifest.files) {
  if (!actual.includes(file.path)) { errors.push('Missing source file: ' + file.path); continue }
  const data = await readFile(resolve(root, file.path))
  const gitSha = createHash('sha1').update('blob ' + data.length + '\0').update(data).digest('hex')
  if (gitSha !== file.git_blob_sha1) errors.push('Modified source file: ' + file.path)
  if (data.length !== file.size) errors.push('Size mismatch: ' + file.path)
}
const expectedDocs = [
  'README.md', 'SCREEN-REGISTRY.md', 'NAVIGATION-MAP.md',
  'INTEGRATION-CONTRACTS.md', 'USER-JOURNEYS.md', 'GAPS-AND-DECISIONS.md',
  'VERIFY.md',
]
for (const name of expectedDocs) {
  const path = join(docDir, name)
  let markdown
  try { markdown = await readFile(path, 'utf8') }
  catch { errors.push('Missing mapping document: ' + name); continue }
  for (const m of markdown.matchAll(/\[[^\]\n]+\]\(([^)]+)\)/g)) {
    const url = m[1].trim().split(/\s+["']/)[0]
    if (/^(https?:|mailto:|#)/i.test(url)) continue
    const target = resolve(dirname(path), decodeURIComponent(url.split(/[?#]/)[0]))
    if (!target.startsWith(root + sep)) { errors.push('Link escapes repository: ' + name + ' → ' + url); continue }
    try { await stat(target) } catch { errors.push('Broken local link: ' + name + ' → ' + url) }
  }
}
async function checkNumbered(path, type, count, pattern) {
  let content
  try { content = await readFile(join(docDir, path), 'utf8') }
  catch { return }
  const ids = new Set([...content.matchAll(pattern)].map(m => Number(m[1])))
  for (let i = 1; i <= count; i++) if (!ids.has(i)) errors.push('Missing ' + type + '-' + String(i).padStart(2, '0') + ' in ' + path)
}
await checkNumbered('SCREEN-REGISTRY.md', 'S', 22, /\| S(\d{2}) \|/g)
await checkNumbered('NAVIGATION-MAP.md', 'N', 48, /\| N-(\d{2}) \|/g)
await checkNumbered('USER-JOURNEYS.md', 'J', 22, /\| J-(\d{2}) \|/g)
await checkNumbered('INTEGRATION-CONTRACTS.md', 'C', 12, /^## C-(\d{2})/gm)
await checkNumbered('GAPS-AND-DECISIONS.md', 'GAP', 18, /\| GAP-(\d{2}) \|/g)
console.log('PB2 source baseline: ' + manifest.files.length + ' files; doc links and map IDs checked.')
if (errors.length) { for (const e of errors) console.error('FAIL: ' + e); process.exitCode = 1 }
else console.log('PASS: exact PB2 source bytes, no extra files, links resolved, IDs present.')
