#!/usr/bin/env python3
"""Deterministically reconstruct the security patch on P1-26; no checkout writes."""
import hashlib,json,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
TARGET='2c1406586dd819357bd3fcc933985f616ce72d39'
BASE='f13ad76929916ecfbb2ef0d5fd7a5a284f680e02'
SOURCE='3a5f5cf1d5f96c5e903e0099261081919b3236e1'
COMMON='3c499d672ad108ce1c2109c2b7a58e22f20f235b'
def git(*args,check=True):return subprocess.run(['git',*args],cwd=ROOT,check=check,capture_output=True)
def show(ref,path):
 r=git('show',ref+':'+path,check=False)
 return r.stdout if r.returncode==0 else None
assert git('merge-base',BASE,SOURCE).stdout.decode().strip()==COMMON
assert git('rev-parse',TARGET+'^').stdout.decode().strip()==BASE
paths=git('diff','--name-only',COMMON,SOURCE).stdout.decode().splitlines()
results=[]
with tempfile.TemporaryDirectory(prefix='pb3-review-tree-') as tmp:
 review=Path(tmp)
 for path in paths:
  if path=='docs/status/CURRENT.md':continue
  before=show(BASE,path)
  if before is not None:
   file=review/path;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(before)
 patch=git('diff','--binary',COMMON,SOURCE,'--','.',':!docs/status/CURRENT.md').stdout
 # Apply all source hunks to the real newer base, without index or product writes.
 applied=subprocess.run(['git','apply'],cwd=review,input=patch,capture_output=True)
 assert applied.returncode==0,applied.stderr.decode()
 for path in paths:
  if path=='docs/status/CURRENT.md':continue
  actual=(review/path).read_bytes();expected=show(TARGET,path)
  assert actual==expected,path
  results.append({'path':path,'sourceBlob':git('rev-parse',SOURCE+':'+path).stdout.decode().strip(),
    'integratedSha256':hashlib.sha256(actual).hexdigest(),'preserved':True,'overlap':show(COMMON,path)!=show(BASE,path)})
extra=set(git('diff','--name-only',BASE,TARGET).stdout.decode().splitlines())-set(paths)
assert extra=={'docs/audits/P1-26-P1-22-INTEGRATION-20261110.md'}
status0=show(BASE,'docs/status/CURRENT.md').decode().splitlines()
status1=show(TARGET,'docs/status/CURRENT.md').decode().splitlines()
assert all(line in status1 for line in status0)
base_migrations=git('ls-tree','-r','--name-only',BASE,'apps/api/database/migrations').stdout.decode().splitlines()
new_migrations=git('ls-tree','-r','--name-only',TARGET,'apps/api/database/migrations').stdout.decode().splitlines()
assert all(show(BASE,p)==show(TARGET,p) for p in base_migrations)
added=sorted(set(new_migrations)-set(base_migrations))
assert added==['apps/api/database/migrations/2026_11_10_000006_add_assignment_scoped_recipient_grants.php']
assert len(new_migrations)==len(set(Path(p).stem for p in new_migrations))
edges=json.loads((ROOT/'docs/audits/pr46/DEPENDENCIES.json').read_text())
for row in edges:
 for field in ['baseSha','headSha']:
  result=git('merge-base','--is-ancestor',row[field],TARGET,check=False)
  row[field+'IsAncestor']=result.returncode==0
  row[field+'ObjectAvailable']=result.returncode in (0,1)
product=[r for r in edges if r['number'] not in (13,17,19,27,45)]
assert all(r['headShaIsAncestor'] for r in product)
result={'productSha':TARGET,'baseSha':BASE,'sourceSha':SOURCE,'commonAncestor':COMMON,
 'patchAppliedExit':applied.returncode,'sourceFilesPreserved':results,'statusPreserved':True,'extraFiles':sorted(extra),
 'migrations':{'unchangedBase':len(base_migrations),'added':added,'unique':True},'dependencyGraph':edges}
(ROOT/'docs/audits/pr46/STATIC-EVIDENCE.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'sourceFilesPreserved':len(results),'overlappingFiles':[r['path'] for r in results if r['overlap']],
 'productPrAncestors':len(product),'oldMigrationsUnchanged':len(base_migrations),'newMigrations':added,'status':'PASS'}))
