import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
const root=process.argv[2]??'docs/audits/evidence/PB3-UX-STATES-20261117'
const json=async name=>JSON.parse(await readFile(path.join(root,name),'utf8'))
const manifest=await json('manifest.json')
for(const f of manifest.files){
  assert(!f.path.includes('..')&&!path.isAbsolute(f.path))
  const bytes=await readFile(path.join(root,f.path))
  assert.equal(bytes.length,f.bytes,f.path)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.path)
}
const geometry=await json('geometry.json')
assert.equal(geometry.status,'PASS');assert.equal(geometry.viewports.length,3)
assert.equal(geometry.failures.length,0)
for(const viewport of geometry.viewports)for(const screen of Object.values(viewport.screens))
  for(const [name,ref] of Object.entries(screen.reference))for(const key of ['x','y','w','h'])assert.equal(screen.app[name][key],ref[key])
for(const viewport of geometry.viewports){
  for(const [name,contract] of Object.entries(viewport.contracts??{})){
    const properties=name==='cameraAssignment'?['font','background','padding','radius','lineHeight']:['font','color','background','padding','radius','lineHeight']
    for(const [anchor,ref] of Object.entries(contract.reference)){
      assert(ref&&contract.app[anchor],`${name}/${anchor} missing`)
      for(const property of properties)assert.equal(contract.app[anchor][property],ref[property],`${name}/${anchor}/${property}`)
    }
  }
}
const pixels=await json('pixel-comparison.json')
assert.equal(pixels.length,30)
for(const pair of pixels){assert.equal(pair.status,'PASS');assert.equal(pair.different_pixels,0)}
for(const [file,count] of [['e2e-results.json',151],['production-e2e.json',10]]){
  const e=await json(file)
  assert.equal(e.exitCode,0);assert.equal(e.stats.expected,count)
  assert.equal(e.stats.unexpected,0);assert.equal(e.stats.skipped,0);assert.equal(e.stats.flaky,0)
}
const sources=await json('canonical-sources.json')
assert.equal(sources.checked,117)
for(const f of sources.files){
 const bytes=await readFile(f.path)
 assert.equal(bytes.length,f.bytes)
 assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex'),f.gitBlob)
}
console.log(JSON.stringify({status:'PASS',artifacts:manifest.files.length,canonicalSources:117}))
