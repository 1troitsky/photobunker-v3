#!/usr/bin/env python3
"""Deterministic QA scope/sanitization/syntax gate; no LLM or live credentials."""
import ast
import json
from pathlib import Path
import re
import subprocess
import sys
qa=Path(__file__).resolve().parents[2]
product=Path(sys.argv[1]).resolve()
def git(root,*args):
 return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
assert git(product,'rev-parse','HEAD')=='e39b619dc9ec36eefc9ac322367e2d4348a1508e'
assert not git(product,'status','--porcelain')
assert git(qa,'branch','--show-current')=='qa/p2-matrix-independent-local-20261111'
files=set(git(qa,'diff','--name-only','e39b619dc9ec36eefc9ac322367e2d4348a1508e').splitlines()+git(qa,'ls-files','--others','--exclude-standard').splitlines())
for name in files:
 assert name.startswith(('scripts/p2-matrix-audit/','docs/audits/P2-MATRIX-INDEPENDENT-','docs/audits/evidence/P2-MATRIX-INDEPENDENT-')),name
 assert not name.endswith(('.sql','.log','.pem','.key','.zip','.png','.webm')),name
patterns=[rb'PB2\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\.',rb'syt_[A-Za-z0-9_-]{20,}',rb'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----']
for name in files:
 data=(qa/name).read_bytes()
 for pattern in patterns: assert not re.search(pattern,data),f'Secret-like payload: {name}'
for f in (qa/'docs/audits/evidence').glob('P2-MATRIX-INDEPENDENT-*.json'):
 data=json.loads(f.read_text())
 for r in (data.get('results',[]) if isinstance(data,dict) else []):assert r['status'] in ['PASS','FAIL','BLOCKED','NOT TESTED']
for f in Path(__file__).parent.glob('*.py'):ast.parse(f.read_text(),str(f))
for f in Path(__file__).parent.glob('*.mjs'):subprocess.run(['node','--check',str(f)],check=True)
runtime=json.loads((qa/'docs/audits/evidence/P2-MATRIX-INDEPENDENT-runtime-20261111.json').read_text())
by_id={r['id']:r for r in runtime['results']}
assert by_id['M-02-GENUINE-RECOVERY-KEY-ROTATION']['status']=='FAIL'
assert by_id['M-02-GENUINE-RECOVERY-KEY-ROTATION']['rev2EscrowGet']==409
assert by_id['M-02-GENUINE-RECOVERY-KEY-ROTATION']['validRootSignedRev2Post']==409
assert by_id['M-01-FULL-PB3-MATRIX']['status']=='BLOCKED'
ui=json.loads((qa/'docs/audits/evidence/P2-MATRIX-INDEPENDENT-ui-20261111.json').read_text())
assert len(ui['results'])==4 and all(r['status']=='PASS' for r in ui['results'])
print('PASS QA-only scope, exact untouched product, valid evidence, syntax, no exported key/token patterns; product M-02 remains FAIL')
