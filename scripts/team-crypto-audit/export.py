#!/usr/bin/env python3
"""Allowlisted audit evidence. Never export raw Playwright traces or errors."""
import argparse,base64,hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--qa-source',required=True)
p.add_argument('--chain',required=True,type=Path)
p.add_argument('runs',nargs='+',type=Path)
a=p.parse_args()
assert re.fullmatch('[a-f0-9]{40}',a.qa_source)
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
git('cat-file','-e',a.qa_source+'^{commit}')
def specs(s):
    yield from s.get('specs',[])
    for c in s.get('suites',[]):yield from specs(c)
def normalize(v,source,run):
    if isinstance(v,str):return v.replace(str(ROOT),'$QA').replace(source,'$PRODUCT').replace(str(run),'$RUN').replace(str(run).removeprefix('/private'),'$RUN')
    if isinstance(v,list):return [normalize(x,source,run)for x in v]
    if isinstance(v,dict):return {k:normalize(x,source,run)for k,x in v.items()}
    return v
results=[]
for path in a.runs:
    run=path.resolve();summary=json.loads((run/'summary.json').read_text())
    private_values=[]
    envfile=run/'compose.env'
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            key,value=line.split('=',1)
            if key in ['PB3_TEST_PASSWORD','PB3_TEST_APP_KEY','PB3_TEST_S3_KEY','PB3_TEST_S3_SECRET']:
                private_values.append(json.loads(value))
    # The maintained runner records its actual --key argument for Garage.
    # It is a disposable credential and must still never be published.
    for check in summary['results']:
        args=check.get('command')
        if args and '--key' in args:
            args[args.index('--key')+1]='[redacted-disposable-key-id]'
    browsers={}
    for file in run.glob('*.json'):
        report=json.loads(file.read_text())
        if not isinstance(report,dict)or'suites'not in report:continue
        tests=[]
        for s in specs(report):
            for t in s['tests']:
                executions=[]
                for r in t['results']:
                    proof=[]
                    for att in r.get('attachments',[]):
                        if att['name']=='audit-proof':
                            data=base64.b64decode(att['body'])if'body'in att else Path(att['path']).read_bytes()
                            proof+=json.loads(data)
                    executions.append({'status':r['status'],'durationMs':r['duration'],'proofs':proof})
                tests.append({'file':s['file'],'title':s['title'],'status':t['status'],'executions':executions})
        browsers[file.stem]={'stats':report['stats'],'tests':tests}
    versions={}
    for name,file,pattern in [
      ('php','php-security-floor',r'verified: ([\d.]+)'),('postgres','postgres-version',r'PostgreSQL\) ([\d.]+)'),
      ('garage','garage-version',r'garage v([\d.]+)'),('node','node-version',r'(?m)^(v[\d.]+)$'),
      ('pnpm','pnpm-version',r'(?m)^(10\.[\d.]+)$'),('composer','composer-version',r'Composer version ([\d.]+)'),
      ('chromium','chromium-version',r'(?m)^([\d]+\.[\d.]+)$'),('playwright','playwright-version',r'Version ([\d.]+)'),
      ('macOS','os-version',r'ProductVersion:\s*([\d.]+)')]:
        log=run/(file+'.log');m=re.search(pattern,log.read_text())if log.exists()else None
        if m:versions[name]=m.group(1)
    details={'id':run.name,'productSha':summary['base'],'checks':summary['results'],'versions':versions,'browsers':browsers,
      'exitCode':int(any(x['status']=='FAIL'for x in summary['results']))}
    counts={}
    for file,pattern,key in [('vitest',r'Tests\s+(\d+) passed','vitestPassed'),
        ('phpunit',r'OK \((\d+) tests, (\d+) assertions\)','phpunit')]:
        logfile=run/(file+'.log')
        match=re.search(pattern,logfile.read_text())if logfile.exists()else None
        if match:counts[key]=[int(x)for x in match.groups()]
    details['testCounts']=counts
    if(run/'privacy-scan.json').exists():details['privacy']=json.loads((run/'privacy-scan.json').read_text())
    # Instrumentation writes only an explicit metadata schema; still select
    # fields again here rather than forwarding an arbitrary report.
    events=[]
    for file in run.glob('media-network-*.json'):
        for e in json.loads(file.read_text()):
            events.append({k:e[k]for k in ['at','path','method','status','accept','mime','grant']if k in e})
    if events:details['mediaTransport']=events
    safe=normalize(details,summary['source_root'],run)
    serialized=json.dumps(safe)
    canaries=run/'private-canaries.json'
    if canaries.exists():private_values+=json.loads(canaries.read_text())
    assert all(secret not in serialized for secret in private_values if secret), 'Private value in export'
    results.append(safe)
paths=git('ls-tree','-r','--name-only',a.qa_source,'scripts/team-crypto-audit','tests/team-crypto-audit',
          'scripts/local-acceptance','tests/local-acceptance').decode().splitlines()
manifest={path:hashlib.sha256(git('show',a.qa_source+':'+path)).hexdigest()for path in paths}
print(json.dumps({'auditedProductSha':'41fa666b3cc54d351ce0d916fecf6e44973c97a5','reproductionSourceSha':a.qa_source,
 'sourceNote':'QA evolved between the preserved runs. This SHA/manifest identifies the delivered reproduction harness, not an invented per-run source snapshot.',
 'qaSourceSha256':manifest,'chain':json.loads(a.chain.read_text()),'runs':results,
 'preservedOriginalAudit':{'pr':55,'head':'7f653a590ab4a0b44a1e576ee4e5ea9ad07183bc',
   'evidence':'https://github.com/1troitsky/photobunker-v3/blob/7f653a590ab4a0b44a1e576ee4e5ea9ad07183bc/docs/audits/evidence/P1-29B-TEAM-CRYPTO-AUDIT-local.json'},
 'diagnostics':[
  {'run':'pb3-acceptance-hvoodmzb','check':'media-diagnostic','classification':'TEST_READINESS','error':'participants fetch raced online hydration; HTML/JSON parse error retained'},
  {'classification':'QA_HARNESS','error':'Old spaced-string import replacement missed compact product imports; passive transport instrumentation was absent. Regex replacement now asserts exactly one match.'},
  {'classification':'ENVIRONMENT','command':'pnpm install --offline --frozen-lockfile','exitCode':1,'error':'ERR_PNPM_NO_OFFLINE_TARBALL; normal frozen install then succeeded'}],
 'unexecuted':['native Safari','physical iPhone','physical Android','production migration load/locks','PHP 8.5 locally',
 'true overlapping PostgreSQL transactions (HTTP fixture uses one PHP server worker)','freshness against total device/cache rollback','external specialist cryptographic audit'],
 'privacyPolicy':'Only command metadata, statuses, counts, public hashes and allowlisted boolean proofs. Raw errors, traces, keys, identities, canaries, media, cookies and credentials remain private.'},indent=2,ensure_ascii=False))
