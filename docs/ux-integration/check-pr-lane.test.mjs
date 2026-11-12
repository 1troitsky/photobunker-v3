import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { inspect } from './check-pr-lane.mjs'

test('isolated UX files are allowed, including new preview and tests', () => {
  const r = inspect({branch:'ux/visual-review',files:[
    'apps/web/src/ui/fieldwork/FieldworkButton.vue',
    'tools/ux-review/index.html',
    'tests/ux-review/screenshot.spec.ts',
    'docs/ux-integration/WORKSTREAMS.json'
  ]})
  assert.equal(r.failures.length,0)
})
test('UX branch cannot alter AppShell, global CSS, Viewer or original UX sources', () => {
  const r=inspect({branch:'ux/fieldwork-viewer',files:[
    'apps/web/src/App.vue','apps/web/src/styles.css',
    'apps/web/src/router.ts','apps/web/src/views/FileViewerView.vue',
    'docs/ux/browser/viewer/accepted-file-viewer-v1-standalone.html'
  ]})
  assert.equal(r.failures.length,5)
})
test('renamed/deleted reserved paths are visible to git --no-renames', () => {
  assert.equal(inspect({branch:'ux/other',files:['apps/web/src/views/PhotoBrowserView.vue']}).failures.length,1)
})
test('normal product branches are not blocked by UX sandbox path guard', () => {
  assert.deepEqual(inspect({branch:'p2/viewer-working',files:['apps/web/src/views/FileViewerView.vue']}).failures,[])
})
test('integration branch requires explicit dependency and overlap declaration', () => {
  const missing=inspect({branch:'integration/ux-shell',files:['apps/web/src/App.vue'],body:'just do it'})
  assert.ok(missing.failures.length>=5)
  const valid=inspect({branch:'integration/ux-shell',files:['apps/web/src/App.vue'],body:[
    'Lane: UX-INTEGRATION',
    'Source PR / exact base SHA: #140 @ 16c92d48bca319896e9a748189394820c3809c09',
    'Screen IDs / nav edges N-05 / journeys J-14',
    'Existing ownership checked: #139, #140',
    'Overlap with other open PRs: DECLARED; owned integration only',
    'Verification: NOT TESTED'
  ].join('\n')})
  assert.equal(valid.failures.length,0)
})
