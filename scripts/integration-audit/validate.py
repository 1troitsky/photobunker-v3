#!/usr/bin/env python3
"""Check published evidence against Git sources and local private-fixture canaries."""
import argparse,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--private-run',action='append',default=[],type=Path);args=p.parse_args()
folder=ROOT/'docs/audits/pr46'
documents={p.name:json.loads(p.read_text()) for p in folder.glob('*.json')}
static=documents['STATIC-EVIDENCE.json'];assert len(static['sourceFilesPreserved'])==20
assert all(p['preserved'] for p in static['sourceFilesPreserved'])
assert static['migrations']['unchangedBase']==18 and len(static['migrations']['added'])==1
initial=documents['INTEGRATED-EVIDENCE.json'];final=documents['JOURNEY-VERIFIED-EVIDENCE.json']
assert initial['exitCode']==1 and final['exitCode']==0
assert sum(b['stats']['expected'] for b in initial['browsers'].values())==4
assert initial['migration-comparison']['unchanged'] and initial['migration-comparison']['v1NullScopes']
proofs=[p for b in final['browsers'].values() for t in b['tests'] for r in t['results'] for p in r['proofs']]
journey=next(p for p in proofs if p['scenario']=='integrated-A-B-A')
assert journey['versions']==[2,2,2] and journey['submitted']=={'photo':1,'media':2}
assert journey['grantLostAck']==journey['submissionLostAck']==1 and journey['grantExactReplays']==2
assert journey['recipientPlaintextHashesMatch'] and journey['contributorOriginalsMatch']
assert final['privacy-scan']=={'databaseScanned':True,'containerLogExit':0,'databaseCanariesAbsent':True,'logCanariesAbsent':True}
for doc in documents.values():
 if isinstance(doc,dict) and 'qaFilesSha256' in doc:
  for path,digest in doc['qaFilesSha256'].items():
   raw=subprocess.check_output(['git','show',doc['qaSourceSha']+':'+path],cwd=ROOT)
   assert hashlib.sha256(raw).hexdigest()==digest,path
published=''.join(p.read_text() for p in folder.glob('*.json'))+(ROOT/'docs/audits/P1-26-INDEPENDENT-INTEGRATION-AUDIT-20261110.md').read_text()
assert 'PB2.' not in published
for directory in args.private_run:
 for line in (directory/'compose.env').read_text().splitlines():
  key,value=line.split('=',1)
  if key not in ('PB3_RUN_DIR','PB3_REPO_ROOT'):assert json.loads(value) not in published,key
 if (directory/'private-canaries.json').exists():
  for value in json.loads((directory/'private-canaries.json').read_text()):assert value not in published
print('PASS: evidence counts/proofs, exact QA source hashes, no fixture credentials/private canaries in publication')
