#!/usr/bin/env python3
"""Offline, deterministic checks of the archived audit evidence. No LLM/API."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument('--git', action='store_true', help='Also verify local Git objects and canonical UX files')
args = parser.parse_args()
root = args.root.resolve()
evidence = root / 'docs/audits/evidence/PB3-ALL-20261116'
checks = []

def check(name, condition):
    checks.append({'name': name, 'pass': bool(condition)})

def read(name):
    return json.loads((evidence / name).read_text())

manifest = read('artifact-manifest.json')
for name, expected in manifest.items():
    p = evidence / name
    check('artifact present: ' + name, p.is_file())
    if p.is_file():
        data = p.read_bytes()
        check('artifact SHA256: ' + name, hashlib.sha256(data).hexdigest() == expected['sha256'])
        check('artifact size: ' + name, len(data) == expected['bytes'])

prs = read('pr-register.json')
issues = read('issues-audit.json')['issues']
branches = read('branch-register.json')
proof = read('closure-proof.json')
events = read('closure-register.json')
frontend = read('frontend-audit.json')
summary = read('inventory-summary.json')
graph = read('all-commit-graph.json')
check('all 285 PRs', len(prs) == len({p['number'] for p in prs}) == 285)
check('all 129 Issues', len(issues) == len({p['number'] for p in issues}) == 129)
check('all 289 original branches', len(branches) == len({p['branch'] for p in branches}) == 289)
check('all PR HEADs are immutable SHA', all(re.fullmatch(r'[0-9a-f]{40}', p['head_sha']) for p in prs))
check('PR and Issue numbers disjoint', not ({p['number'] for p in prs} & {p['number'] for p in issues}))
check('0 open PR', proof['open_prs'] == 0)
check('0 open Issues', proof['open_issues'] == 0)
check('all post-close PR/Issues confirmed closed', proof['all_prs_closed'] and proof['all_issues_closed'])
check('all source numbers retained', not proof['missing_pr_ids'] and not proof['missing_issue_ids'])
check('all original remote branches retained', not proof['missing_branches'])
check('no original remote branch head changed', not proof['branch_head_changes'])
check('main local/remote unchanged', proof['local_main'] == proof['remote_main'] == '8ed66c438d090efd218efa80b027f0b2f854db4b')
check('no merge', proof['merge_executed'] is False)
check('no new PR', proof['new_pr_created'] is False)
check('all 414 archival operations recorded', len(events) == len({(p['kind'], p['number']) for p in events}) == 414)
check('no closure error', all(p['result'] in ['closed', 'already_closed'] for p in events))
check('all PR operations correspond to register', {p['number'] for p in events if p['kind'] == 'pr'} == {p['number'] for p in prs})
check('all Issue operations correspond to register', {p['number'] for p in events if p['kind'] == 'issue'} == {p['number'] for p in issues})
check('unresolved Issues not marked completed', all(p.get('state_reason') == 'not_planned' for p in events if p['kind'] == 'issue' and p['result'] == 'closed'))
check('22 screen rows', len(frontend['screens']) == 22)
check('23 root HTML sources', len(frontend['html_census']) == 23)
check('all frontend source branches represented', len(frontend['branches']) == 289)
source = read('ux-baseline-proof.json')
check('117 canonical source files retained', source['source_count'] == source['main_count'] == 117 and not source['missing'] and not source['extra'] and not source['different'])
merge = read('main-merge-reconstruction.json')
check('five first-parent merge trees reproduced', len(merge) == 5 and all(x['exit_code'] == 0 and x['auto_tree_matches_actual'] for x in merge))
check('15 historical merge reviews', len(read('all-main-merge-analysis.json')) == 15)
jobs = read('pr412-ci-summary.json')['job_counts']
passed = sum(x['count'] for x in jobs if x['result'] == 'passed')
failed = sum(x['count'] for x in jobs if x['result'] == 'failed')
check('exact #412 CI: 124/135 pass and 11 fail', passed == 124 and failed == 11 and passed + failed == 135)
ci = read('ci-head-register.json')
check('all 286 exact-head CI records', len(ci) == len({x['sha'] for x in ci}) == 286)
check('CI statuses accounted for', dict(collections.Counter(x['status'] for x in ci)) == {'PASS': 244, 'FAIL': 41, 'NO_CHECKS': 1})
check('all source commits indexed', len(graph) == len({x['sha'] for x in graph}) == summary['reachable_commits'])
check('every PR HEAD in preserved graph', {p['head_sha'] for p in prs} <= {x['sha'] for x in graph})
check('every branch HEAD in preserved graph', {p['sha'] for p in branches} <= {x['sha'] for x in graph})
check('private source bundle verified', read('git-preservation.json')['verify_exit'] == 0)

if args.git:
    def git(*command):
        return subprocess.check_output(['git', '-C', str(root), *command])
    check('actual local main matches proof', git('rev-parse', 'refs/heads/main').decode().strip() == proof['local_main'])
    canonical = json.loads((root / 'docs/ux-integration/SOURCE-MANIFEST.json').read_text())['files']
    check('canonical manifest has 117 paths', len(canonical) == 117)
    for file in canonical:
        data = (root / file['path']).read_bytes()
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        check('canonical UX bytes: ' + file['path'], blob == file['git_blob_sha1'] and len(data) == file['size'])
    check('audit branch apps match exact #412 source', git('diff', '--name-only', summary['frontend_source'], 'HEAD', '--', 'apps').strip() == b'')

result = {'pass': all(x['pass'] for x in checks), 'checks': len(checks),
          'failed': [x['name'] for x in checks if not x['pass']], 'network_used': False,
          'product_acceptance_claimed': False, 'git_mode': args.git}
(evidence / 'audit-verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
raise SystemExit(0 if result['pass'] else 1)
