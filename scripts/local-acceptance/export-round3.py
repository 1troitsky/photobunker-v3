#!/usr/bin/env python3
"""Allowlisted Round3 evidence; no raw errors, credentials, GPS, images or traces."""
import base64, hashlib, json, re, subprocess, sys
from pathlib import Path
from round3 import TARGET, QA_BASE, specs
run=Path(sys.argv[1]).resolve()
root=Path(__file__).resolve().parents[2]
summary=json.loads((run/'summary.json').read_text())
source=Path(summary['source_root'])
def normalize(x):
    if isinstance(x,str):return x.replace(str(source),'$PRODUCT').replace(str(root),'$QA').replace(str(run),'$RUN')
    if isinstance(x,list):return [normalize(v) for v in x]
    if isinstance(x,dict):return {k:normalize(v) for k,v in x.items()}
    return x
reports={}
allow={'round3-boundary-proof','round3-boundary-timing','round3-camera-proof','round3-metadata-proof','round3-pregrant-proof','round3-history-proof','lost-ack-proof','camera-hydration-observation','offline-bootstrap-observation','production-navigation-timings'}
for path in sorted(run.glob('*.json')):
    try:report=json.loads(path.read_text())
    except (ValueError,OSError):continue
    if not isinstance(report,dict) or 'suites' not in report:continue
    entries=[]
    for s in specs(report):
        for t in s['tests']:
            entry={'title':s['title'],'file':s['file'],'status':t['status'],'results':[]}
            for r in t['results']:
                item={'status':r['status'],'durationMs':r['duration']}
                for a in r.get('attachments',[]):
                    if a['name'] in allow:
                        raw=base64.b64decode(a['body']) if 'body' in a else Path(a['path']).read_bytes()
                        item.setdefault('proofs',[]).append({'name':a['name'],'value':json.loads(raw)})
                entry['results'].append(item)
            entries.append(entry)
    reports[path.stem]={'stats':report['stats'],'tests':entries}
versions={}
for name,log,pattern in [
 ('node','node-version',r'v22\.\d+\.\d+'),('pnpm','pnpm-version',r'(?m)^10\.20\.0$'),
 ('php','php-security-floor',r'PHP security floor verified: ([\d.]+)'),('composer','composer-version',r'Composer version ([\d.]+)'),
 ('postgres','postgres-version',r'PostgreSQL\) ([\d.]+)'),('garage','garage-version',r'garage v([\d.]+)'),
 ('playwright','playwright-version',r'Version ([\d.]+)'),('chromium','chromium-version',r'(?m)^(\d+\.\d+\.\d+\.\d+)$'),
 ('nativeSafari','safari-version',r'(?m)^(26\.[\d.]+)$'),('macOS','os-version',r'ProductVersion:\s*([\d.]+)'),
 ('laravel','composer-install',r'laravel/framework \(v([\d.]+)\)')]:
    p=run/(log+'.log');m=re.search(pattern,p.read_text()) if p.exists() else None
    versions[name]=(m.group(1) if m.lastindex else m.group()) if m else 'NOT VERIFIED'
counts={}
for name,pattern in [('vitest',r'Tests\s+(\d+) passed'),('phpunit',r'OK \((\d+) tests, (\d+) assertions\)')]:
    m=re.search(pattern,(run/(name+'.log')).read_text());counts[name]=[int(v) for v in m.groups()] if m else None
files={}
for directory in ['scripts/local-acceptance','tests/local-acceptance']:
    for p in sorted((root/directory).glob('*round3*')):
        if p.is_file():files[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
output={'issue':25,'productSha':TARGET,'qaBaselineSha':QA_BASE,'qaHarnessSha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
 'runId':run.name,'startedUtcEpoch':summary['started'],'versions':versions,'counts':counts,'checks':summary['results'],'browsers':reports,'qaFileSha256':files,
 'privacy':'Only allowlisted synthetic IDs, times, ciphertext hashes, states, counts and boolean checks. No errors, raw bodies, traces, images, GPS or keys.'}
for name in ['boundary-comparisons','privacy-scan']:
    p=run/(name+'.json')
    if p.exists():output[name]=json.loads(p.read_text())
safari=run/'safari.log'
if safari.exists():
    text=safari.read_text()
    output['nativeSafari']={'status':'NOT TESTED' if 'NOT TESTED' in text else 'SEE CHECK','phase':next((x for x in ['driver-status','session-creation','navigate-settings','indexeddb-webcrypto','resize-screenshot'] if x in text),None),'settingsChanged':False}
print(json.dumps(normalize(output),indent=2,ensure_ascii=False))
