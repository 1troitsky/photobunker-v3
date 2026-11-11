#!/usr/bin/env python3
"""Create ONLY a disposable local audit stack. Never contacts production data.

Usage: setup.py PRODUCT_WORKTREE PRIVATE_RUN_DIRECTORY
Requires Docker, OpenSSL, Node22/pnpm and installed frozen product dependencies.
The product source and security gates remain unchanged. No public ports.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

product, run = (Path(x).resolve() for x in sys.argv[1:])
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=product, text=True).strip() == 'e39b619dc9ec36eefc9ac322367e2d4348a1508e'
run.mkdir(mode=0o700)
run.chmod(0o700)
project = 'pb3-p2-audit-' + secrets.token_hex(4)
def cmd(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)

(run/'synapse').mkdir(mode=0o777)
(run/'synapse').chmod(0o777)
cmd(['docker','run','--rm','-v',f'{run}/synapse:/data',
     '-e','SYNAPSE_SERVER_NAME=matrix.pb3-audit.test','-e','SYNAPSE_REPORT_STATS=no',
     'matrixdotorg/synapse:v1.161.0','generate'])
config = run/'synapse/homeserver.yaml'
config.write_text(config.read_text()+'\nregistration_shared_secret: "'+secrets.token_hex(32)+'"\n')
cmd(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2',
     '-subj','/CN=matrix.pb3-audit.test',
     '-addext','subjectAltName=DNS:matrix.pb3-audit.test',
     '-keyout',str(run/'tls.key'),'-out',str(run/'tls.crt')])
(run/'tls.key').chmod(0o600)
(run/'ca.ini').write_text('openssl.cafile=/audit/tls.crt\ncurl.cainfo=/audit/tls.crt\n')
(run/'nginx.conf').write_text('''server {
 listen 443 ssl;
 server_name matrix.pb3-audit.test;
 ssl_certificate /audit/tls.crt;
 ssl_certificate_key /audit/tls.key;
 access_log off;
 location / { proxy_pass http://synapse:8008; proxy_set_header Host $host; }
}
''')
(run/'.env').write_text('DB_PASSWORD='+secrets.token_hex(32)+'\nAPP_KEY=base64:'+base64.b64encode(secrets.token_bytes(32)).decode()+'\n')
(run/'.env').chmod(0o600)
(product/'apps/api/vendor').mkdir(exist_ok=True)
# Copy a frozen existing dependency install only if its lock is identical.
gitdir=Path(subprocess.check_output(['git','rev-parse','--path-format=absolute','--git-common-dir'],cwd=product,text=True).strip())
existing=gitdir.parent/'apps/api/composer.lock'
assert existing.read_bytes()==(product/'apps/api/composer.lock').read_bytes()
compose={
 'name':project,
 'services':{
  'postgres':{'image':'postgres:18-alpine','environment':{'POSTGRES_DB':'pb3_audit','POSTGRES_USER':'pb3','POSTGRES_PASSWORD':'${DB_PASSWORD}'},'tmpfs':['/var/lib/postgresql'], 'healthcheck':{'test':['CMD-SHELL','pg_isready -U pb3 -d pb3_audit'],'interval':'2s','timeout':'2s','retries':30}},
  'synapse':{'image':'matrixdotorg/synapse:v1.161.0','volumes':[f'{run}/synapse:/data'],'environment':{'SYNAPSE_LOG_LEVEL':'WARNING'}},
  'matrix':{'image':'nginx:1.28-alpine','depends_on':['synapse'],'volumes':[f'{run}:/audit:ro',f'{run}/nginx.conf:/etc/nginx/conf.d/default.conf:ro'], 'networks':{'default':{'aliases':['matrix.pb3-audit.test']}},'ports':['127.0.0.1:443:443']},
  'api':{'image':'pb3-local-acceptance-php:8.4.27','working_dir':'/app','depends_on':{'postgres':{'condition':'service_healthy'},'matrix':{'condition':'service_started'}},'env_file':['.env'],
   'environment':{'APP_ENV':'local','APP_DEBUG':'false','APP_URL':'http://127.0.0.1:5175','APP_PUBLIC_URL':'http://127.0.0.1:5175','DB_CONNECTION':'pgsql','DB_HOST':'postgres','DB_DATABASE':'pb3_audit','DB_USERNAME':'pb3','SESSION_COOKIE':'pb3_p2_audit_session','SESSION_DRIVER':'file','SESSION_SECURE_COOKIE':'false','CACHE_STORE':'file','LOG_CHANNEL':'stderr','PB3_ENABLE_PHOTO_CLEANUP':'false','PB3_MATRIX_HOMESERVER_URL':'https://matrix.pb3-audit.test'},
   'volumes':[f'{product}/apps/api:/app:ro','frozen-vendor:/app/vendor:ro','api-storage:/app/storage','api-cache:/app/bootstrap/cache',f'{run}:/audit:ro',f'{run}/ca.ini:/usr/local/etc/php/conf.d/zz-audit-ca.ini:ro'],
   'ports':['127.0.0.1:8002:8000'],'command':['php','artisan','serve','--host=0.0.0.0','--port=8000','--no-reload']}
 },'volumes':{'frozen-vendor':{'external':True,'name':'pb3-local_vendor'},'api-storage':{},'api-cache':{}}}
(run/'compose.json').write_text(json.dumps(compose,indent=2))
base=['docker','compose','--env-file',str(run/'.env'),'-f',str(run/'compose.json')]
cmd(base+['up','-d','--wait','--wait-timeout','90','postgres','synapse','matrix'])
cmd(base+['run','--rm','--no-deps','api','sh','-c','mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs storage/app/private && php artisan migrate --force --no-ansi'])
cmd(base+['up','-d','api'])
accounts={}
for name in ['alice','bob','third']:
 password=secrets.token_hex(32)
 cmd(base+['exec','-T','synapse','register_new_matrix_user','-c','/data/homeserver.yaml','-u',name,'-p',password,'--no-admin','http://localhost:8008'])
 accounts[name]={'user':name,'password':password}
(run/'accounts.json').write_text(json.dumps(accounts));(run/'accounts.json').chmod(0o600)
qa=Path(__file__).resolve().parents[2]
adapt='' if os.getenv('PB3_AUDIT_STOCK_PROXY')=='1' else 'c.server.proxy["/matrix/v1"]={target:"http://127.0.0.1:8002",changeOrigin:false}; '
(run/'vite.config.mjs').write_text('import factory from '+json.dumps(str(product/'apps/web/vite.config.ts'))+';\nexport default e=>{const c=factory(e); for(const p of Object.values(c.server.proxy))p.target="http://127.0.0.1:8002"; '+adapt+'c.server.port=5175; c.server.strictPort=true; return c;};\n')
log=open(run/'vite.log','w')
vite=subprocess.Popen(['pnpm','exec','vite','--config',str(run/'vite.config.mjs')],cwd=product/'apps/web',stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
(run/'runtime.json').write_text(json.dumps({'product':str(product),'project':project,'vitePid':vite.pid,'baseURL':'http://127.0.0.1:5175','matrixOrigin':'https://matrix.pb3-audit.test','vendorLockSha256':hashlib.sha256(existing.read_bytes()).hexdigest()},indent=2))
print('Disposable audit runtime ready:',run)
