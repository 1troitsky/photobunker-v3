#!/usr/bin/env python3
"""Issue #25: one isolated integrated run, one bounded recheck per failing test."""
import argparse, base64, json, os, re, subprocess, sys
from pathlib import Path
from run import Acceptance, ROOT
TARGET='039762d3bec173b767cbb8898bda92d01e413f26'
QA_BASE='07297a690265a362f8dbaa22f74976e2ebb74405'

def specs(report):
    def walk(s):
        yield from s.get('specs',[])
        for child in s.get('suites',[]):yield from walk(child)
    yield from walk(report)

def proofs(path,name):
    if not path.exists():return []
    out=[]
    for spec in specs(json.loads(path.read_text())):
        for t in spec['tests']:
            for r in t['results']:
                for a in r.get('attachments',[]):
                    if a['name']==name:
                        out.append(json.loads(base64.b64decode(a['body']) if 'body' in a else Path(a['path']).read_bytes()))
    return out

class Round3(Acceptance):
    def browser(self,name,config,*extra,product=False):
        return self.command(name,['pnpm','exec','playwright','test','--config',str(config),'--output',str(self.directory/name),'--reporter=line,json',*extra],
            cwd=self.source_root if product else ROOT,timeout=600,
            env={'PLAYWRIGHT_JSON_OUTPUT_NAME':str(self.directory/(name+'.json')),'PB3_ACCEPTANCE_ARTIFACTS':str(self.directory)})[0]
    def browsers(self):
        if not self.command('chromium-install',['pnpm','exec','playwright','install','chromium'],cwd=self.source_root)[0]:return
        self.command('os-version',['sw_vers'])
        self.command('safari-version',['/usr/libexec/PlistBuddy','-c','Print :CFBundleShortVersionString','/Applications/Safari.app/Contents/Info.plist'])
        self.command('playwright-version',['pnpm','exec','playwright','--version'])
        self.command('chromium-version',['node','--input-type=module','-e','import {chromium} from "@playwright/test";const b=await chromium.launch();console.log(b.version());await b.close()'])
        self.background('vite',['pnpm','--filter','@pb3/web','exec','vite','--host','127.0.0.1','--port','5173','--strictPort'],cwd=self.source_root)
        self.background('preview',['pnpm','--filter','@pb3/web','exec','vite','preview','--host','127.0.0.1','--port','4173','--strictPort'],cwd=self.source_root)
        if not self.health('vite-ready','http://127.0.0.1:5173/settings'):return
        preview=self.health('preview-ready','http://127.0.0.1:4173/settings')
        config=ROOT/'tests/local-acceptance/playwright.config.ts'
        if preview:self.browser('performance-before',config,'performance.spec.ts')
        suites=[
          ('round3-boundaries',config,['round3-boundaries.spec.ts','--repeat-each','3'],False),
          ('camera-reload',config,['camera-reload.spec.ts','round3-camera.spec.ts'],False),
          ('product-e2e',self.source_root/'tests/playwright.config.ts',[],True),
          ('round3-security',config,['round3-security.spec.ts'],False),
          ('lost-ack-stability',config,['resilience.spec.ts','--grep','ciphertext survives','--repeat-each','3'],False),
          ('acceptance-e2e',config,['resilience.spec.ts','--grep-invert','ciphertext survives|cold offline reload'],False),
          ('offline-readiness',config,['offline-readiness.spec.ts'],False),
        ]
        failed=[]
        for name,cfg,args,product in suites:
            if not self.browser(name,cfg,*args,product=product):failed.append((name,cfg,product))
        # No automatic retry-until-green: retain originals, ONE independent recheck per failing spec.
        for name,cfg,product in failed:
            path=self.directory/(name+'.json')
            if not path.exists():continue
            unique={s['title']:s for s in specs(json.loads(path.read_text())) if any(t['status']=='unexpected' for t in s['tests'])}
            for index,(title,spec) in enumerate(unique.items()):
                self.browser(name+'-recheck-'+str(index+1),cfg,Path(spec['file']).name,'--grep','^'+re.escape(title)+'$',product=product)
        self.command('safari',['python3',str(ROOT/'scripts/local-acceptance/safari-smoke.py'),str(self.directory)],timeout=90,optional=True)
        # Read-only device discovery; no pairing, permissions or owner prompts.
        code="import json,shutil,subprocess; p=subprocess.run(['system_profiler','SPUSBDataType','-json'],capture_output=True,text=True,timeout=20); raw=p.stdout.lower(); print(json.dumps({'usbInventoryExit':p.returncode,'iosUsbCandidate':'iphone' in raw or 'ipad' in raw,'adbAvailable':bool(shutil.which('adb'))}));"
        self.command('physical-device-discovery',['python3','-c',code])
        if preview:self.browser('performance-after',config,'performance.spec.ts')
        self.inspect()
    def inspect(self):
        bootstrap="if(getenv('APP_ENV')!=='testing'||getenv('DB_DATABASE')!=='pb3_ci_p0'||getenv('PB3_ISOLATED_STORAGE_SMOKE')!=='1')exit(1);require 'vendor/autoload.php';$app=require 'bootstrap/app.php';$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();"
        code=bootstrap+"echo json_encode(['events'=>Illuminate\\Support\\Facades\\DB::table('assignment_state_events_v1')->get(['assignment_id','state','occurred_at_ms']),'photos'=>Illuminate\\Support\\Facades\\DB::table('photo_records')->get(['id','account_id','state'])],JSON_THROW_ON_ERROR);"
        ok,raw=self.dc('round3-db-inspection','exec','-T','api','php','-r',code)
        if ok:
            data=json.loads(raw);(self.directory/'fixture-state.json').write_text(json.dumps(data))
            comparisons=[]
            for p in proofs(self.directory/'round3-boundaries.json','round3-boundary-timing'):
                boundary=next(e['occurred_at_ms'] for e in data['events'] if e['assignment_id']==p['assignmentId'] and e['state']=='finished')
                comparisons.append({**p,'occurredAtMs':int(boundary),'sameSecond':p['capturedAt']//1000==int(boundary)//1000,'beforeFinish':p['capturedAt']<int(boundary)})
            (self.directory/'boundary-comparisons.json').write_text(json.dumps(comparisons,indent=2))
            self.command('round3-trusted-boundaries',['python3','-c',"import json,sys;x=json.load(open(sys.argv[1]));print(json.dumps(x));assert len(x)==3 and all(v['sameSecond'] and v['beforeFinish'] for v in x)",str(self.directory/'boundary-comparisons.json')])
        canaries=self.directory/'private-canaries.json'
        if canaries.exists():
            ok,dump=self.dc('private-database-scan','exec','-T','postgres','pg_dump','-U','pb3_ci','--data-only','pb3_ci_p0',private=True)
            logs=subprocess.run(self.compose+['logs','--no-color'],env={**os.environ,**self.compose_values},capture_output=True,text=True,timeout=60)
            values=json.loads(canaries.read_text());result={'databaseScanExecuted':ok,'containerLogScanExit':logs.returncode,'databasePlaintextAbsent':all(v not in dump for v in values),'logsPlaintextAbsent':all(v not in logs.stdout for v in values)}
            (self.directory/'privacy-scan.json').write_text(json.dumps(result))
            self.command('round3-private-canary-scan',['python3','-c',"import json,sys;x=json.load(open(sys.argv[1]));print(json.dumps(x));assert all(x[k] for k in ['databaseScanExecuted','databasePlaintextAbsent','logsPlaintextAbsent']) and x['containerLogScanExit']==0",str(self.directory/'privacy-scan.json')])

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',required=True,type=Path);args=p.parse_args()
    if subprocess.check_output(['git','-C',str(args.source_root),'rev-parse','HEAD'],text=True).strip()!=TARGET:p.error('Pinned product HEAD mismatch; STOP')
    if subprocess.check_output(['git','-C',str(args.source_root),'status','--porcelain'],text=True).strip():p.error('Product worktree is dirty; STOP')
    a=Round3(source_root=args.source_root,source_ref=TARGET)
    try:a.run()
    except (Exception,KeyboardInterrupt) as e:
        a.results.append({'name':'runner','status':'FAIL','exit_code':1,'reason':str(e)});print('Runner interrupted:',e,flush=True)
    finally:a.cleanup()
    print('Summary:',a.directory/'summary.json',flush=True)
    sys.exit(1 if any(x['status']=='FAIL' for x in a.results) else 0)
