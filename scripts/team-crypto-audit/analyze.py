#!/usr/bin/env python3
"""Deterministic ancestry/patch/source evidence; never changes Git refs."""
import hashlib,json,subprocess,sys
from collections import defaultdict
from pathlib import Path
root=Path(sys.argv[1]).resolve()
base='ee0cbe6836b5359e971319dfc8ae91ef695c7d42'
heads=['157909c9b414f7d4ea8591b683b69913946a42c3','b45028d46b56c37173cafdc7bcd311b65c042e15',
       '70d6a1e55b7fee8b56cece70f483fba5589346ef','03bcc0880521ebcc9145f134233d39be6a339c2c',
       '41fa666b3cc54d351ce0d916fecf6e44973c97a5']
def git(*args):return subprocess.check_output(['git',*args],cwd=root)
target=git('rev-parse','HEAD').decode().strip()
labels=[50,51,52,53,56]
if target!=heads[-1]:
    assert subprocess.run(['git','merge-base','--is-ancestor',heads[-1],target],cwd=root).returncode==0
    heads.append(target);labels.append('separate-fix')
subprocess.run(['git','diff','--exit-code',heads[-1]],cwd=root,check=True)
stages=[];parent=base
for number,head in zip(labels,heads):
    ancestor=subprocess.run(['git','merge-base','--is-ancestor',parent,head],cwd=root).returncode
    assert ancestor==0
    stages.append({'pr':number,'base':parent,'head':head,'ancestryExitCode':ancestor,
      'commits':len(git('rev-list',parent+'..'+head).splitlines()),
      'changedFiles':git('diff','--name-only',parent,head).decode().splitlines()})
    parent=head
patches=defaultdict(list)
for commit in git('rev-list','--no-merges',base+'..'+heads[-1]).decode().splitlines():
    patch=git('show','--format=','--patch',commit)
    pid=subprocess.check_output(['git','patch-id','--stable'],input=patch,cwd=root).decode().split()
    if pid:patches[pid[0]].append(commit)
duplicates={k:v for k,v in patches.items()if len(v)>1}
assert not duplicates
files=git('diff','--name-only',base,heads[-1]).decode().splitlines()
source={p:hashlib.sha256((root/p).read_bytes()).hexdigest()for p in files}
conflicts=[p for p in files if any(line.startswith((b'<<<<<<< ',b'>>>>>>> '))for line in(root/p).read_bytes().splitlines())]
assert not conflicts
print(json.dumps({'status':'PASS','base':base,'target':heads[-1],'stages':stages,
  'duplicateStablePatches':duplicates,'conflictMarkers':conflicts,'sourceSha256':source,
  'limits':'Ancestry and patch checks prove code inclusion; semantic contracts are covered separately by review and runtime tests.'},indent=2))
