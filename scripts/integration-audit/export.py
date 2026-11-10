#!/usr/bin/env python3
"""Export allowlisted audit commands and proofs; raw traces/keys/media stay private."""
import base64,hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
run=Path(sys.argv[1]).resolve();qa_sha=sys.argv[2]
assert re.fullmatch('[a-f0-9]{40}',qa_sha)
subprocess.run(['git','cat-file','-e',qa_sha+'^{commit}'],cwd=ROOT,check=True)
summary=json.loads((run/'summary.json').read_text())
def normalize(value):
 if isinstance(value,str):
  return value.replace(str(ROOT),'$QA').replace(summary['source_root'],'$PRODUCT').replace(str(run),'$RUN').replace('/private/tmp/pb3-pr44-audit-base','$BASE44')
 if isinstance(value,list):return [normalize(v) for v in value]
 if isinstance(value,dict):return {k:normalize(v) for k,v in value.items()}
 return value
def specs(s):
 yield from s.get('specs',[])
 for child in s.get('suites',[]):yield from specs(child)
browsers={}
for file in sorted(run.glob('*.json')):
 try:report=json.loads(file.read_text())
 except (OSError,ValueError):continue
 if not isinstance(report,dict) or 'suites' not in report:continue
 tests=[]
 for s in specs(report):
  for t in s['tests']:
   entry={'title':s['title'],'file':s['file'],'status':t['status'],'results':[]}
   for r in t['results']:
    result={'status':r['status'],'durationMs':r['duration'],'proofs':[]}
    for a in r.get('attachments',[]):
     if a['name']=='audit-proof':
      raw=base64.b64decode(a['body']) if 'body' in a else Path(a['path']).read_bytes()
      result['proofs'].append(json.loads(raw))
    entry['results'].append(result)
   tests.append(entry)
 browsers[file.stem]={'stats':report['stats'],'tests':tests}
versions={}
for name,log,pattern in [('node','node-version',r'v22\.[\d.]+'),('pnpm','pnpm-version',r'(?m)^10\.20\.0$'),('php','php-security-floor',r'verified: ([\d.]+)'),('postgres','postgres-version',r'PostgreSQL\) ([\d.]+)'),('garage','garage-version',r'garage v([\d.]+)'),('composer','composer-version',r'Composer version ([\d.]+)'),('chromium','chromium-version',r'(?m)^(141\.[\d.]+)$'),('playwright','playwright-version',r'Version ([\d.]+)'),('macOS','os-version',r'ProductVersion:\s*([\d.]+)')]:
 p=run/(log+'.log');m=re.search(pattern,p.read_text()) if p.exists() else None
 versions[name]=(m.group(1) if m.lastindex else m.group()) if m else 'NOT VERIFIED IN THIS TARGETED RUN'
manifest={}
for path in subprocess.check_output(['git','ls-tree','-r','--name-only',qa_sha,'scripts/integration-audit','tests/integration-audit','scripts/local-acceptance','tests/local-acceptance'],cwd=ROOT,text=True).splitlines():
 manifest[path]=hashlib.sha256(subprocess.check_output(['git','show',qa_sha+':'+path],cwd=ROOT)).hexdigest()
result={'productSha':'2c1406586dd819357bd3fcc933985f616ce72d39','baselineSha':'f13ad76929916ecfbb2ef0d5fd7a5a284f680e02','securitySourceSha':'3a5f5cf1d5f96c5e903e0099261081919b3236e1',
 'qaSourceSha':qa_sha,'qaFilesSha256':manifest,'privateRunId':run.name,'startedUtcEpoch':summary['started'],'versions':versions,'checks':summary['results'],'browsers':browsers,
 'exitCode':1 if any(r['status']=='FAIL' for r in summary['results']) else 0,
 'privacy':'Only commands, exit codes, synthetic identifiers/timestamps, ciphertext hashes and boolean proofs; no raw errors, traces, credentials, keys, filenames, images or private instructions.',
 'unexecuted':['native Safari','physical iPhone/Android','cold offline trusted PWA','full CI rerun (intentionally not repeated)']}
for name in ['migration-comparison','privacy-scan']:
 p=run/(name+'.json')
 if p.exists():result[name]=json.loads(p.read_text())
print(json.dumps(normalize(result),indent=2,ensure_ascii=False))
