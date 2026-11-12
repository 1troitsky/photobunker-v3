#!/usr/bin/env python3
"""Deterministic exact-source, QA scope, syntax and sanitized-evidence gate."""
import ast
import json
from pathlib import Path
import re
import subprocess
import sys
qa=Path(__file__).resolve().parents[2]
product=Path(sys.argv[1]).resolve()
sha='5f13992b94b90157a38d25b3fe27543e3e8642f1'
def git(root,*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
assert git(product,'rev-parse','HEAD')==sha
assert not git(product,'status','--porcelain')
changed=set(git(qa,'diff','--name-only',sha).splitlines()+git(qa,'ls-files','--others','--exclude-standard').splitlines())
for name in changed:
 assert name.startswith(('scripts/p2-matrix-reacceptance/','docs/audits/P2-MATRIX-REACCEPTANCE-','docs/audits/evidence/P2-MATRIX-REACCEPTANCE-')),name
 assert not name.endswith(('.log','.sql','.key','.pem','.png','.webm','.zip'))
 raw=(qa/name).read_bytes()
 for pattern in [rb'PB2\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\.',rb'syt_[A-Za-z0-9_-]{20,}',rb'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----']:
  assert not re.search(pattern,raw),name
 if name.endswith('.json'):
  json.loads(raw)
  assert not re.search(rb'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b',raw),name
for f in Path(__file__).parent.glob('*.py'):ast.parse(f.read_text(),str(f))
for f in Path(__file__).parent.glob('*.mjs'):subprocess.run(['node','--check',str(f)],check=True)
e=qa/'docs/audits/evidence/P2-MATRIX-REACCEPTANCE-20261112-runtime.json'
data=json.loads(e.read_text());assert data['product']==sha
by_id={r['id']:r for r in data['results']}
required=['VITE-ROUTING','M-02-ROTATION-RECOVERY-LOST-ACK','M-02-CHANGED-AKEK-ROOT','OTHER-DEVICE-REVOKE','M-03B-SELF-REVOKE-MATRIX-LOGOUT','M-03B-MATRIX-FAILURE-LOCAL-LOCK']
assert len(data['results'])==7
assert all(by_id[k]['status']=='PASS' for k in required)
assert by_id['EXCLUDED-GATES']['status']=='BLOCKED'
assert by_id['M-03B-SELF-REVOKE-MATRIX-LOGOUT']['samePreviousMatrixTokenHttp']==401
assert by_id['OTHER-DEVICE-REVOKE']['independentMatrixTokenHttp']==200
assert by_id['M-02-ROTATION-RECOVERY-LOST-ACK']['firstPostAcceptedBeforeAckLost']==201
assert by_id['M-02-ROTATION-RECOVERY-LOST-ACK']['replayHttp']==200
print('PASS exact untouched SHA81, six scoped assertions, excluded gates BLOCKED, QA-only files, syntax and sanitized evidence')
