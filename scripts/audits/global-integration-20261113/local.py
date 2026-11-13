import os,json,pathlib,secrets,subprocess,time,datetime,sys
# LOCAL ONLY. GITHUB_ACTIONS=true below is guard compatibility for the original
# disposable fixtures; this runner never claims a local run is GitHub-hosted CI.
os.umask(0o077)
D=pathlib.Path(os.environ.get('PB3_AUDIT_OUTPUT','/private/tmp/pb3-global-audit-20261113')).resolve()
W=pathlib.Path(os.environ.get('PB3_AUDIT_WORKSPACE',str(pathlib.Path(__file__).resolve().parents[3]))).resolve()
if D==W or W in D.parents:raise RuntimeError('Keep private fixtures outside the repository')
D.mkdir(parents=True,exist_ok=True,mode=0o700)
(D/'runtime').mkdir(exist_ok=True,mode=0o700)
if len(sys.argv)<2:raise SystemExit('Usage: local.py setup|backend|phpunit|frontend|e2e|fault')
LEDGER=D/'commands.json';CF=D/'compose.json'
def run(name,args,cwd=None,env=None,timeout=900):
 start=time.monotonic();path=D/(name+'-'+str(time.time_ns())+'.log')
 env=dict(os.environ) if env is None else env.copy()
 env['TMPDIR']=str((D/'runtime').resolve())
 with path.open('w') as f:r=subprocess.run(args,cwd=cwd or W,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 os.chmod(path,0o600)
 import fcntl
 with LEDGER.open('a+') as ledger:
  fcntl.flock(ledger,fcntl.LOCK_EX);ledger.seek(0);raw=ledger.read()
  rows=json.loads(raw) if raw else []
  rows.append({'name':name,'command':args,'exit':r.returncode,'elapsed_seconds':round(time.monotonic()-start,3),'artifact':path.name,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
  ledger.seek(0);ledger.truncate();ledger.write(json.dumps(rows,indent=2)+'\n');ledger.flush()
 print(name,'exit',r.returncode,flush=True)
 if r.returncode: print(path.read_text()[-2500:]);raise RuntimeError(name)
 return path.read_text()
def dc(*a):return ['docker','compose','-f',str(CF),*a]
def fault():
 remote='/audit/fault-'+secrets.token_hex(4)
 run('fault-directory',dc('exec','-T','api','mkdir','-p',remote))
 prefix=dc('exec','-T','-e','RUNNER_TEMP='+remote,'-e','P4_FAULT_FIXTURE='+remote+'/pb3-p4-fault-fixture.json','api','php','tests/integration/p4-fault-matrix/garage-outage.php')
 run('fault-prepare',prefix+['prepare'])
 run('fault-stop-garage',dc('stop','-t','5','garage'))
 try:run('fault-s3-down',prefix+['s3-down'])
 finally:run('fault-restart-garage',dc('start','garage'))
 for i in range(20):
  if subprocess.run(dc('exec','-T','garage','/garage','status'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(1)
 else:raise RuntimeError('Garage restart timeout')
 run('fault-recover',prefix+['recover'])
if sys.argv[1]=='setup':
 if CF.exists():raise RuntimeError('Existing fixture: never overwrite or reprovision it')
 (W/'apps/api/vendor').mkdir(exist_ok=True)
 project='pb3-global-20261113-'+secrets.token_hex(3)
 for p in [D/'runtime',D/'bin']:p.mkdir(exist_ok=True,mode=0o700)
 dbpw=secrets.token_hex(24)
 garage='metadata_dir = "/var/lib/garage/meta"\ndata_dir = "/var/lib/garage/data"\ndb_engine = "sqlite"\nreplication_factor = 1\nrpc_bind_addr = "127.0.0.1:3901"\nrpc_public_addr = "127.0.0.1:3901"\nrpc_secret = "'+secrets.token_hex(32)+'"\n[s3_api]\ns3_region = "garage"\napi_bind_addr = "0.0.0.0:3900"\n'
 (D/'garage.toml').write_text(garage);os.chmod(D/'garage.toml',0o600)
 baseenv={'APP_ENV':'testing','APP_DEBUG':'false','APP_KEY':'base64:'+__import__('base64').b64encode(secrets.token_bytes(32)).decode(),'APP_URL':'http://127.0.0.1:5173','APP_PUBLIC_URL':'http://127.0.0.1:5173','DB_CONNECTION':'pgsql','DB_HOST':'127.0.0.1','DB_PORT':'5432','DB_DATABASE':'pb3_ci_p0','DB_USERNAME':'pb3_ci','DB_PASSWORD':dbpw,'SESSION_DRIVER':'file','SESSION_SECURE_COOKIE':'false','CACHE_STORE':'array','LOG_CHANNEL':'stderr','S3_ENDPOINT':'http://127.0.0.1:3900','S3_REGION':'garage','S3_BUCKET':'pb3-ci-p0','PB3_ISOLATED_STORAGE_SMOKE':'1','GITHUB_ACTIONS':'true','RUNNER_TEMP':'/audit','P4_FAULT_FIXTURE':'/audit/pb3-p4-fault-fixture.json','PB3_ENABLE_BROWSER_ARCHIVE':'true','PB3_ENABLE_PHOTO_CLEANUP':'false'}
 def php(image):return {'image':image,'network_mode':'service:anchor','working_dir':'/app','env_file':[str(D/'api.env')],'volumes':[str(W/'apps/api')+':/app:ro','vendor:/app/vendor','storage:/app/storage','bootstrap:/app/bootstrap/cache',str(D/'runtime')+':/audit'],'command':['php','artisan','serve','--host=0.0.0.0','--port=8000','--no-reload']}
 compose={'name':project,'services':{'anchor':{'image':'alpine:3.22','command':['sleep','infinity'],'ports':['127.0.0.1:8000:8000','127.0.0.1:3900:3900']},'postgres':{'image':'postgres:18-alpine','network_mode':'service:anchor','environment':{'POSTGRES_DB':'pb3_ci_p0','POSTGRES_USER':'pb3_ci','POSTGRES_PASSWORD':dbpw},'volumes':['postgres:/var/lib/postgresql'],'healthcheck':{'test':['CMD','pg_isready','-U','pb3_ci','-d','pb3_ci_p0'],'interval':'2s','timeout':'2s','retries':30}},'garage':{'image':'dxflrs/garage:v2.5.0','network_mode':'service:anchor','command':['/garage','server'],'volumes':[str(D/'garage.toml')+':/etc/garage.toml:ro','garage-meta:/var/lib/garage/meta','garage-data:/var/lib/garage/data']},'api':php('pb3-local-acceptance-php:8.4.27'),'php85':php('pb3-team-audit-php:8.5.12')},'volumes':{x:{} for x in ['vendor','storage','bootstrap','postgres','garage-meta','garage-data']}}
 CF.write_text(json.dumps(compose,indent=2));os.chmod(CF,0o600)
 (D/'api.env').write_text('\n'.join(k+'='+v for k,v in baseenv.items())+'\n');os.chmod(D/'api.env',0o600)
 run('compose-up-infra',dc('up','-d','--wait','anchor','postgres','garage'))
 for i in range(20):
  r=subprocess.run(dc('exec','-T','garage','/garage','status'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if r.returncode==0:break
  time.sleep(1)
 else:raise RuntimeError('Garage startup timeout')
 node=run('garage-node',dc('exec','-T','garage','/garage','node','id','-q')).strip().split('@')[0]
 run('garage-layout',dc('exec','-T','garage','/garage','layout','assign','-z','audit','-c','1G',node))
 run('garage-apply',dc('exec','-T','garage','/garage','layout','apply','--version','1'))
 run('garage-bucket',dc('exec','-T','garage','/garage','bucket','create','pb3-ci-p0'))
 keytext=run('private-garage-key',dc('exec','-T','garage','/garage','key','create','audit-key'))
 import re
 baseenv['S3_ACCESS_KEY']=re.search(r'Key ID:\s*(\S+)',keytext)[1]
 baseenv['S3_SECRET_KEY']=re.search(r'Secret key:\s*(\S+)',keytext)[1]
 (D/'api.env').write_text('\n'.join(k+'='+v for k,v in baseenv.items())+'\n')
 run('garage-grant',dc('exec','-T','garage','/garage','bucket','allow','--read','--write','--owner','pb3-ci-p0','--key','audit-key'))
 run('composer-install',dc('run','--rm','--no-deps','api','composer','install','--no-interaction','--no-progress','--prefer-dist'))
 run('runtime-directories',dc('run','--rm','--no-deps','api','mkdir','-p','storage/framework/sessions','storage/framework/cache/data','storage/framework/views','storage/logs'))
 run('migrate',dc('run','--rm','--no-deps','api','php','artisan','migrate','--force'))
 run('api-up',dc('up','-d','api'))
 wrapper=D/'bin/php';wrapper.write_text('#!/usr/bin/env python3\nimport os,sys\nos.execvp("docker",'+repr(dc('exec','-T','-w','/app','api','php'))+'+sys.argv[1:])\n');wrapper.chmod(0o700)
 print('Ready isolated project',project,flush=True)
elif sys.argv[1] in ('backend','phpunit'):
 for name,service in [('84','api'),('85','php85')]:
  prefix=dc('exec','-T',service) if service=='api' else dc('run','--rm','--no-deps',service)
  run('runtime'+name,prefix+['php','-r','require "vendor/autoload.php"; echo PHP_VERSION," / ",Illuminate\\Foundation\\Application::VERSION,PHP_EOL;'])
  unitflags=['-e','SESSION_DRIVER=array','-e','CACHE_STORE=array','-e','DB_CONNECTION=sqlite','-e','DB_DATABASE=:memory:','-e','APP_URL=https://localhost','-e','PB3_ENABLE_BROWSER_ARCHIVE=false']
  unitprefix=dc('exec','-T',*unitflags,service) if service=='api' else dc('run','--rm','--no-deps',*unitflags,service)
  run('phpunit'+name,unitprefix+['php','vendor/bin/phpunit','--colors=never','--cache-directory=/audit/phpunit'+name+'.cache'])
 if sys.argv[1]=='phpunit':sys.exit(0)
 run('route-list',dc('exec','-T','api','php','artisan','route:list'))
 run('migration-status',dc('exec','-T','api','php','artisan','migrate:status'))
 run('pg-quota-races',dc('exec','-T','api','php','tests/integration/p1-quota-postgres-race.php'))
 run('garage-smoke',dc('exec','-T','api','php','tests/integration/garage-postgres-smoke.php'))
 run('garage-lifecycle',dc('exec','-T','api','php','tests/integration/lifecycle-garage-smoke.php'))
 fault()
elif sys.argv[1]=='fault':
 fault()
elif sys.argv[1]=='frontend':
 for n,args in [('typecheck',['pnpm','typecheck']),('vitest',['pnpm','test:web']),('build',['pnpm','build']),('ux-source',['node','docs/ux-integration/verify-source.mjs']),('ux-lane',['node','--test','docs/ux-integration/check-pr-lane.test.mjs']),('release-integrity',['node','--test','scripts/release-integrity/integrity.test.mjs'])]:run(n,args)
elif sys.argv[1]=='e2e':
 env=os.environ.copy();env['PATH']=str(D/'bin')+':'+env['PATH']
 run('chromium',['pnpm','exec','playwright','test','--config','tests/playwright.config.ts','--reporter=json','--output='+str(D/'test-results')],env=env,timeout=1500)
