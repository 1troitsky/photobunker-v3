#!/usr/bin/env python3
"""Bounded inspection/revocation of ONLY the current disposable QA fixture."""
import json, os, re, subprocess, sys
from pathlib import Path
run=Path(os.environ['PB3_ACCEPTANCE_ARTIFACTS']).resolve()
summary=json.loads((run/'summary.json').read_text())
assert run.name.startswith('pb3-acceptance-') and re.fullmatch('pb3-accept-[0-9a-f]{10}',summary['project'])
values=dict(line.split('=',1) for line in (run/'compose.env').read_text().splitlines())
values={k:json.loads(v) for k,v in values.items()}
assert Path(values['PB3_RUN_DIR']).resolve()==run
assert values['PB3_REPO_ROOT']==summary['source_root']
action,*ids=sys.argv[1:]
assert all(re.fullmatch('[0-9a-f-]{36}',x) for x in ids)
bootstrap="if(getenv('APP_ENV')!=='testing'||getenv('DB_DATABASE')!=='pb3_ci_p0'||getenv('PB3_ISOLATED_STORAGE_SMOKE')!=='1')exit(1);require 'vendor/autoload.php';$app=require 'bootstrap/app.php';$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();"
if action=='grant-count' and len(ids)==1:
    code=f"echo Illuminate\\Support\\Facades\\DB::table('photo_access_grants')->where('owner_account_id','{ids[0]}')->count();"
elif action=='revoke-invite' and len(ids)==2:
    # Test fixture fault injection; no product revocation API exists yet.
    code=f"$q=Illuminate\\Support\\Facades\\DB::table('assignment_invites_v1')->where('assignment_id','{ids[0]}')->where('recipient_account_id','{ids[1]}')->where('state','accepted');if($q->count()!==1)exit(2);echo $q->update(['state'=>'revoked']);"
else:raise SystemExit('Unsupported fixture action')
command=['docker','compose','--project-name',summary['project'],'--env-file',str(run/'compose.env'),'-f',str(Path(__file__).with_name('compose.yml')),'exec','-T','api','php','-r',bootstrap+code]
result=subprocess.run(command,env={**os.environ,**values},capture_output=True,text=True,timeout=30)
if result.returncode:raise SystemExit('Isolated fixture command failed: '+str(result.returncode))
print(result.stdout.strip())
