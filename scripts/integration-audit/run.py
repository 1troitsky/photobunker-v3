#!/usr/bin/env python3
"""PR46 independent integration audit, deliberately not a rerun of full CI."""
import argparse,importlib.util,json,os,re,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('maintained_acceptance',ROOT/'scripts/local-acceptance/run.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
TARGET='2c1406586dd819357bd3fcc933985f616ce72d39'
BASE='f13ad76929916ecfbb2ef0d5fd7a5a284f680e02'
class Audit(module.Acceptance):
 def __init__(self,baseline_root,**kwargs):
  super().__init__(**kwargs);self.baseline_root=baseline_root
 def browser(self,name,file):
  return self.command(name,['pnpm','exec','playwright','test','--config','tests/integration-audit/playwright.config.ts',file,'--output',str(self.directory/name),'--reporter=line,json'],
   cwd=ROOT,timeout=240,env={'PB3_ACCEPTANCE_ARTIFACTS':str(self.directory),'PLAYWRIGHT_JSON_OUTPUT_NAME':str(self.directory/(name+'.json'))})[0]
 def snapshot(self,name):
  ok,raw=self.dc(name,'exec','-T','api','php','audit-fixture-snapshot.php')
  if ok:(self.directory/(name+'.json')).write_text(raw)
  return json.loads(raw) if ok else None
 def run(self):
  for label,path,sha in [('product',self.source_root,TARGET),('baseline',self.baseline_root,BASE)]:
   if not self.command(label+'-head',['git','log','-1','--format=%H %s'],cwd=path)[0]:return
   if not self.command(label+'-source-clean',['git','diff','--exit-code',sha],cwd=path)[0]:return
  self.command('dependency-and-patch-audit',['python3','-B','scripts/integration-audit/analyze.py'])
  self.command('node-version',['node','--version']);self.command('pnpm-version',['pnpm','--version'])
  self.command('os-version',['sw_vers']);self.command('docker-version',['docker','version'])
  if not all(self.available(p) for p in (8000,5173,4173)):raise RuntimeError('Reserved fixture ports occupied; existing services unchanged')
  if not self.command('isolation-contract',['python3','-B','tests/local-acceptance/test_isolation.py'])[0]:return
  # Provision the exact old API; the frontend uses only backward-compatible v1 routes in the seed phase.
  product=self.source_root;self.source_root=self.baseline_root
  try:ok=self.provision()
  finally:self.source_root=product
  if not ok:return
  if not self.php('composer-install','composer','install','--no-interaction','--no-progress','--prefer-dist',timeout=900)[0]:return
  self.php('composer-version','composer','--version')
  self.php('php-version','php','-v')
  self.php('baseline-migrate','php','artisan','migrate','--force')
  shutil.copy2(ROOT/'scripts/integration-audit/fixture-snapshot.php',self.directory/'api/audit-fixture-snapshot.php')
  if not self.dc('api-baseline-up','up','-d','api')[0]:return
  if not self.health('api-baseline-ready','http://127.0.0.1:8000/api/readyz'):return
  self.background('vite',['pnpm','--filter','@pb3/web','exec','vite','--host','127.0.0.1','--port','5173','--strictPort'],cwd=self.source_root)
  if not self.health('vite-ready','http://127.0.0.1:5173/settings'):return
  self.command('playwright-version',['pnpm','exec','playwright','--version'])
  self.command('chromium-version',['node','--input-type=module','-e','import {chromium} from "@playwright/test";const b=await chromium.launch();console.log(b.version());await b.close()'])
  seed=self.browser('migration-seed','migration-seed.spec.ts')
  before=self.snapshot('before-upgrade')
  if not seed:raise RuntimeError('Old schema seed failed; no fabricated migration PASS')
  self.dc('api-upgrade-stop','stop','api')
  changed=subprocess.check_output(['git','diff','--name-only',BASE,TARGET,'--','apps/api'],cwd=ROOT,text=True).splitlines()
  for path in changed:
   target=self.directory/path.removeprefix('apps/')
   target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(self.source_root/path,target)
  self.compose_values['PB3_REPO_ROOT']=str(self.source_root);self.save_env()
  if not self.php('integration-migrate','php','artisan','migrate','--force')[0]:return
  self.php('migration-status','php','artisan','migrate:status')
  self.dc('api-integration-up','up','-d','--force-recreate','api')
  if not self.health('api-integration-ready','http://127.0.0.1:8000/api/readyz'):return
  after=self.snapshot('after-upgrade')
  comparison={'before':before,'after':after,'unchanged':all(before[t]['count']==after[t]['count'] and before[t]['stableRowsSha256']==after[t]['stableRowsSha256'] for t in before),
   'v1NullScopes':all(after[t]['assignmentColumn'] and after[t]['scopeNullCount']==after[t]['count'] for t in ['photo_access_grants','media_recipient_grants_v1'])}
  (self.directory/'migration-comparison.json').write_text(json.dumps(comparison,indent=2))
  self.command('migration-preservation-check',['python3','-c','import json,sys;x=json.load(open(sys.argv[1]));print(json.dumps(x));assert x["unchanged"] and x["v1NullScopes"]',str(self.directory/'migration-comparison.json')])
  self.browser('migration-upgrade','migration-upgrade.spec.ts')
  failed=[]
  for name,file in [('integrated-journey','journey.spec.ts'),('adversarial','adversarial.spec.ts'),('expiry','expiry.spec.ts')]:
   if not self.browser(name,file):failed.append((name,file))
  # Preserve every initial result. No loop-until-green; recheck is an explicit separate command.
  (self.directory/'failed-suites.json').write_text(json.dumps(failed))
  if (self.directory/'private-canaries.json').exists():
   values=json.loads((self.directory/'private-canaries.json').read_text())
   ok,dump=self.dc('private-database-scan','exec','-T','postgres','pg_dump','-U','pb3_ci','--data-only','pb3_ci_p0',private=True)
   logs=subprocess.run(self.compose+['logs','--no-color'],env={**os.environ,**self.compose_values},capture_output=True,text=True,timeout=40)
   result={'databaseScanned':ok,'containerLogExit':logs.returncode,'databaseCanariesAbsent':all(v not in dump for v in values),'logCanariesAbsent':all(v not in logs.stdout for v in values)}
   (self.directory/'privacy-scan.json').write_text(json.dumps(result))
   self.command('privacy-canary-check',['python3','-c','import json,sys;x=json.load(open(sys.argv[1]));print(json.dumps(x));assert x["databaseScanned"] and x["databaseCanariesAbsent"] and x["logCanariesAbsent"] and x["containerLogExit"]==0',str(self.directory/'privacy-scan.json')])
  self.command('product-source-after',['git','diff','--exit-code',TARGET],cwd=self.source_root)

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',required=True,type=Path);p.add_argument('--baseline-root',required=True,type=Path);args=p.parse_args()
 for path,sha in [(args.source_root,TARGET),(args.baseline_root,BASE)]:
  if subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip()!=sha:p.error('HEAD mismatch; stop')
 a=Audit(baseline_root=args.baseline_root,source_root=args.source_root,source_ref=TARGET)
 try:a.run()
 except (Exception,KeyboardInterrupt) as e:
  a.results.append({'name':'runner','status':'FAIL','exit_code':1,'reason':str(e)});print('Runner interrupted:',e,flush=True)
 finally:a.cleanup()
 print('Summary:',a.directory/'summary.json',flush=True)
 sys.exit(1 if any(x['status']=='FAIL' for x in a.results) else 0)
