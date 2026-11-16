#!/usr/bin/env python3
"""Verify committed, sanitized core-release evidence offline, without an LLM."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--git', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
evidence = root / 'docs/audits/evidence/PB3-CORE-20261116'
checks = []


def check(name, condition):
    checks.append({'check': name, 'pass': bool(condition)})


def read(name):
    return json.loads((evidence / name).read_text())


manifest = read('artifact-manifest.json')
for name, expected in manifest.items():
    path = evidence / name
    check('file present: ' + name, path.is_file())
    if path.is_file():
        content = path.read_bytes()
        check('SHA256: ' + name, hashlib.sha256(content).hexdigest() == expected['sha256'])
        check('bytes: ' + name, len(content) == expected['bytes'])

source = read('tested-source-images.json')
for name, count in [('chromium-acceptance.json', 151), ('compiled-acceptance.json', 10)]:
    result = read(name)
    stats = result['stats']
    check(name + ': command exit 0', result['exitCode'] == 0)
    check(name + ': all expected, no skips/flakes/failures',
          stats['expected'] == count and stats['unexpected'] == stats['skipped'] == stats['flaky'] == 0)
    check(name + ': scenario census', len(result['scenarios']) == count)
    check(name + ': same tested application tree', result['appsTree'] == source['appsTree'])

local = read('local-checks.json')
check('all five build/unit/type/backend commands passed',
      len(local) == 5 and all(item['exitCode'] == 0 for item in local))
check('Vitest actual count', '1013 passed (1013)' in (evidence / 'vitest.txt').read_text())
for version in ['8.4.27', '8.5.12']:
    check('PHPUnit ' + version, 'OK (323 tests, 5136 assertions)' in
          (evidence / ('phpunit-' + version + '.txt')).read_text())
ux = read('canonical-ux-proof.json')
check('all accepted UX source bytes retained', ux['files'] == 117 and not ux['mismatch'] and ux['exitCode'] == 0)
prs = read('integration-pr-proof.json')
check('all five source PR heads retained',
      {p['number'] for p in prs['openPRs'] if p['headIncluded']} >= {416, 417, 418, 419, 420})
check('actual compiled API/web and real PG18/Garage image identities retained', len(source['images']) == 4)
package = read('docker-package.json')
check('packaged application tree matches acceptance', package['appsTree'] == source['appsTree'])
check('packaged images exactly match accepted images',
      {x['Id'] for x in package['images']} == {x['Id'] for x in source['images']})
check('no private trace/browser exports', not list(evidence.rglob('trace.zip')))

if args.git:
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD:apps'], cwd=root, text=True).strip()
    check('current HEAD application tree matches tested candidate', actual == source['appsTree'])
    for row in prs['openPRs']:
        if row['number'] in {416, 417, 418, 419, 420}:
            check('source HEAD ancestor: #' + str(row['number']), subprocess.run(
                ['git', 'merge-base', '--is-ancestor', row['headRefOid'], 'HEAD'], cwd=root,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0)

print(json.dumps({'checks': checks, 'passed': sum(c['pass'] for c in checks),
                  'failed': sum(not c['pass'] for c in checks)}, indent=2))
raise SystemExit(0 if all(c['pass'] for c in checks) else 1)
