import pathlib,subprocess,tarfile,io,json
import os
D=pathlib.Path(os.environ.get('PB3_AUDIT_OUTPUT','/private/tmp/pb3-global-audit-20261113')).resolve();W=pathlib.Path(os.environ.get('PB3_AUDIT_WORKSPACE',str(pathlib.Path(__file__).resolve().parents[3]))).resolve()
CF=D/'compose.json';c=json.loads(CF.read_text());project=c['name']
(D/'runtime/upgrade-proof.php').write_text((pathlib.Path(__file__).parent/'upgrade-proof.php').read_text())
# The snapshot is exact read-only main code; no extra branch/worktree or main change.
root=D/'main-snapshot';root.mkdir(exist_ok=True)
data=subprocess.check_output(['git','archive','da7327b8c9c440dae3dc864b3245b9f9f4ad14eb','apps/api'],cwd=W)
assert not any(root.iterdir()),'Refuse overwrite snapshot'
with tarfile.open(fileobj=io.BytesIO(data)) as t:
 members=t.getmembers()
 for member in members:
  destination=(root/member.name).resolve()
  assert str(destination).startswith(str(root.resolve())+'/') and not member.issym() and not member.islnk()
 t.extractall(root,members=members)
(root/'apps/api/vendor').mkdir()
anchor=subprocess.check_output(['docker','compose','-f',str(CF),'ps','-q','anchor'],text=True).strip()
def run(name,args):
 with (D/(name+'.log')).open('w') as f:r=subprocess.run(args,cwd=W,stdout=f,stderr=subprocess.STDOUT,timeout=120)
 print(name,r.returncode,flush=True)
 if r.returncode:print((D/(name+'.log')).read_text()[-1500:]);raise RuntimeError(name)
run('upgrade-create-db',['docker','compose','-f',str(CF),'exec','-T','postgres','createdb','-U','pb3_ci','pb3_upgrade_audit'])
def cli(source,*args):
 return ['docker','run','--rm','--network','container:'+anchor,'--env-file',str(D/'api.env'),'-e','DB_DATABASE=pb3_upgrade_audit','-e','SESSION_DRIVER=array','-v',str(source)+':/app:ro','-v',project+'_vendor:/app/vendor:ro','-v',project+'_upgrade-storage:/app/storage','-v',project+'_upgrade-bootstrap:/app/bootstrap/cache','-v',str(D/'runtime')+':/audit','-w','/app','pb3-local-acceptance-php:8.4.27',*args]
run('upgrade-main-migrate',cli(root/'apps/api','php','artisan','migrate','--force'))
run('upgrade-seed',cli(root/'apps/api','php','/audit/upgrade-proof.php','seed'))
run('upgrade-head-migrate',cli(W/'apps/api','php','artisan','migrate','--force'))
run('upgrade-verify',cli(W/'apps/api','php','/audit/upgrade-proof.php','verify'))
