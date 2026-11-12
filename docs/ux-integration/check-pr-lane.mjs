#!/usr/bin/env node
// Read-only PB3 lane preflight. For UX sandbox PRs, fail on any modified path
// outside allocated isolated directories. No API tokens or network access.
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cfg = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'WORKSTREAMS.json'), 'utf8'))
const fail = message => { console.error('UX-LANE FAIL:', message); process.exitCode = 1 }
const allowed = path => cfg.ux_sandbox_allowed_roots.some(root => path.startsWith(root))
export function inspect({ branch, files, body = '' }) {
  if (branch.startsWith(cfg.ux_sandbox_branch_prefix)) {
    const prohibited = files.filter(p => !allowed(p))
    return {
      mode: 'UX-SANDBOX',
      failures: prohibited.map(p => 'UX sandbox may not modify shared/protected file: ' + p),
    }
  }
  if (branch.startsWith(cfg.integration_branch_prefix)) {
    const must = ['Lane: UX-INTEGRATION', 'Source PR / exact base SHA:', 'Screen IDs / nav edges', 'Existing ownership checked:', 'Overlap with other open PRs:', 'Verification:']
    const missing = must.filter(m => !body.includes(m))
    return { mode: 'UX-INTEGRATION', failures: missing.map(m => 'Missing PR preflight field: ' + m) }
  }
  return { mode: 'OTHER', failures: [] }
}

const runAsCommand = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (runAsCommand) {
  const branch = process.env.GITHUB_HEAD_REF || process.env.UX_BRANCH || ''
  const isUx = branch.startsWith(cfg.ux_sandbox_branch_prefix) || branch.startsWith(cfg.integration_branch_prefix)
  if (!branch) fail('Missing GITHUB_HEAD_REF or UX_BRANCH')
  else if (!isUx) console.log('UX-LANE SKIP: branch ' + branch + ' is outside UX lane; product lane uses its own integration review.')
  else {
    const base = process.env.PR_BASE_SHA, head = process.env.PR_HEAD_SHA
    if (!base || !head || !/^[0-9a-f]{40}$/.test(base) || !/^[0-9a-f]{40}$/.test(head)) fail('Missing or invalid PR_BASE_SHA / PR_HEAD_SHA')
    else {
      let changed = []
      try {
        const raw = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head], { encoding: 'utf8' })
        changed = raw.split('\0').filter(Boolean)
      } catch (err) {
        fail('Cannot compare PR refs; fetch full git history and base SHA. ' + String(err))
      }
      let body = ''
      try {
        const path = process.env.GITHUB_EVENT_PATH
        if (path) body = JSON.parse(await readFile(path, 'utf8')).pull_request?.body || ''
      } catch (err) { fail('Cannot read PR body: ' + String(err)) }
      const result = inspect({branch, files:changed, body})
      for (const msg of result.failures) fail(msg)
      console.log('UX-LANE', result.mode, changed.length, 'changed paths,', result.failures.length, 'violations.')
    }
  }
}
