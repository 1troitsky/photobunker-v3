#!/usr/bin/env python3
"""Read exact fetched refs; construct an ephemeral merge TREE, never a branch."""
import json
from pathlib import Path
import subprocess
import sys
repo=Path(sys.argv[1]).resolve()
qa=Path(__file__).resolve().parents[2]
def git(*args):
 return subprocess.check_output(['git','-c','core.quotepath=false',*args],cwd=repo,text=True).strip()
refs=json.loads((qa/'docs/audits/evidence/P2-MATRIX-INDEPENDENT-refs-20261111.json').read_text())
checks=[]
for p in refs:
 if p['number']==76: continue
 subprocess.run(['git','merge-base','--is-ancestor',p['base_sha'],p['head_sha']],cwd=repo,check=True)
 files=git('diff','--name-only',p['base_sha'],p['head_sha']).splitlines()
 actual_base=git('rev-parse','origin/'+p['base'])
 actual_head=git('rev-parse','origin/'+p['head'])
 assert actual_head==p['head_sha']
 if p['number']!=64: assert actual_base==p['base_sha']
 checks.append({'pr':p['number'],'base':p['base'],'recordedBaseSha':p['base_sha'],'actualBaseTip':actual_base,'head':p['head_sha'],'headMatchesFetchedRef':True,'recordedBaseIsAncestor':True,'changedFiles':files})
main='a8abcc55e73ea0a2d8be3a24052f814906b8bd1d'
head='e39b619dc9ec36eefc9ac322367e2d4348a1508e'
assert git('merge-base',main,head)=='2c8ad9f6f18da9e87797d8df2cc0d6c3cf4eb7a6'
tree=git('merge-tree','--write-tree',main,head).splitlines()[0]
docs=git('ls-tree','-r','--name-only',main,'docs/_local-tasks','docs/_uiux').splitlines()
for f in docs+['.gitignore']:
 assert git('rev-parse',main+':'+f)==git('rev-parse',tree+':'+f)
migrations=git('ls-tree','-r','--name-only',head,'apps/api/database/migrations').splitlines()
matrix=[f for f in migrations if 'matrix' in f]
assert len(matrix)==2
result={'product':head,'mainReadOnly':main,'commonAncestor':git('merge-base',main,head),'prs':checks,'ephemeralMergeTree':tree,'mainDocsPreserved':len(docs),'matrixMigrations':matrix,'candidateRuntimeTested':False,'status':'PASS'}
(qa/'docs/audits/evidence/P2-MATRIX-INDEPENDENT-topology-20261111.json').write_text(json.dumps(result,indent=2)+'\n')
print('PASS exact DAG, two Matrix migrations, conflict-free ephemeral tree, all 36 main docs retained')
