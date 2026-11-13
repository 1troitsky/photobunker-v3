import json,subprocess,collections,pathlib
import os
out=pathlib.Path(os.environ.get('PB3_AUDIT_OUTPUT','/private/tmp/pb3-global-audit-20261113')).resolve()
prs=[json.loads(x) for x in (out/'pulls.jsonl').read_text().splitlines()]
main='da7327b8c9c440dae3dc864b3245b9f9f4ad14eb';tip='f4bce2e1ab3e5ad72ec1d7e8c8f4d7517e286faa'
def git(*args):return subprocess.check_output(['git',*args])
def ancestor(a,b):return subprocess.run(['git','merge-base','--is-ancestor',a,b],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
def tree(sha):
 d={}
 for entry in git('ls-tree','-rz','--full-tree',sha).split(b'\0'):
  if entry:
   meta,name=entry.split(b'\t',1);mode,kind,blob=meta.decode().split();d[name.decode()]={'mode':mode,'blob':blob}
 return d
mt=tree(main);tt=tree(tip);bybranch={p['head']['ref']:p['number'] for p in prs};rows=[]
for p in prs:
 n=p['number'];h=p['head']['sha'];actual=git('rev-parse',f'refs/remotes/origin/global-audit-pr-{n}').decode().strip()
 mb=git('merge-base',p['base']['sha'],h).decode().strip()
 files=git('diff','--name-only','-z',mb,h).decode().strip('\0').split('\0');files=[f for f in files if f]
 ht=tree(h);matches=[f for f in files if ht.get(f)==tt.get(f)]
 am=ancestor(h,main);at=ancestor(h,tip)
 cat='ALREADY_MAIN_ANCESTRY' if am else 'IN_BUNDLE_ANCESTRY' if at else 'CONTENT_EQUIVALENT' if files and len(matches)==len(files) else 'PARTIAL_OR_EVOLVED' if matches else 'DIVERGENT_OR_DEFERRED'
 r={**p,'ref_sha_at_fetch':actual,'head_drift':h!=actual,'merge_base':mb,'parent_pr':bybranch.get(p['base']['ref']) or next((other['number'] for other in prs if other['head']['sha']==p['base']['sha'] and other['number']!=n and p['base']['ref']!='main'),None),'main_ancestor':am,'bundle_ancestor':at,'category':cat,'changed_count':len(files),'exact_match_count':len(matches),'changed_paths':files,'different_paths':[f for f in files if f not in matches]}
 rows.append(r)
counts=dict(collections.Counter(r['category'] for r in rows if r['state']=='open'))
proof={'main':main,'bundle':tip,'main_tree':git('rev-parse',main+'^{tree}').decode().strip(),'bundle_tree':git('rev-parse',tip+'^{tree}').decode().strip(),'all_prs':len(rows),'open_prs':sum(r['state']=='open' for r in rows),'open_categories':counts,'rows':rows}
(out/'graph.json').write_text(json.dumps(proof,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({k:v for k,v in proof.items() if k!='rows'},indent=2))
for r in rows:
 if r['state']=='open' and r['category']!='IN_BUNDLE_ANCESTRY':print(r['number'],r['category'],str(r['exact_match_count'])+'/'+str(r['changed_count']),r['title'])

# Complete branch presence + non-mutating merge feasibility evidence. merge-tree
# writes objects only; no branch, index or working-tree ref is changed.
heads_file=out/'remote-heads.txt'
heads={line.split()[1].removeprefix('refs/heads/'):line.split()[0]
       for line in heads_file.read_text().splitlines()} if heads_file.exists() else {}
for row in proof['rows']:
 row['base_branch_exists']=row['base']['ref'] in heads
 if row['number'] in [262,263,63,64,251,292,81,267,266,84,158]:
  result=subprocess.run(['git','merge-tree','--write-tree',tip,row['head']['sha']],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  row['merge_tree_exit']=result.returncode
  row['merge_conflicts']=[line for line in result.stdout.splitlines() if line.startswith('CONFLICT')]
(out/'graph.json').write_text(json.dumps(proof,indent=2,ensure_ascii=False)+'\n')
lines=['digraph PR_dependencies {','rankdir=LR;']
for row in proof['rows']:
 lines.append(f'pr{row["number"]} [label="#{row["number"]} {row["category"]}"];')
 if row['parent_pr']:lines.append(f'pr{row["parent_pr"]} -> pr{row["number"]};')
lines.append('}')
(out/'dependencies.dot').write_text('\n'.join(lines)+'\n')
