import {describe,it,expect} from 'vitest'
import {
  addFolder,moveFile,moveFolder,renameFolder,removeEmptyFolder,emptyWorkspace,
} from './folders'
import {mergeFolderWorkspaces} from './folder-merge'
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const c='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const d='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const file='photo:'+d
describe('signed E2EE folder three-way merge (pure client domain)',()=>{
  it('merges independent additions, moves and file placements without discarding either side',()=>{
    const base=addFolder(emptyWorkspace(),'Original',null,a,1)
    const local=addFolder(base,'Offline B',null,b,2)
    const cloud=moveFile(addFolder(base,'Online A',null,c,3),file,c)
    const result=mergeFolderWorkspaces(base,local,cloud)
    expect(result.conflicts).toEqual([])
    expect(result.structuralError).toBeNull()
    expect(Object.values(result.workspace!.folders).map(x=>x.name).sort())
      .toEqual(['Offline B','Online A','Original'])
    expect(result.workspace!.placements[file]).toBe(c)
  })
  it('requires an explicit per-item choice on simultaneous folder rename',()=>{
    const base=addFolder(emptyWorkspace(),'Shared',null,a,1)
    const local=renameFolder(base,a,'My label')
    const cloud=renameFolder(base,a,'Their label')
    const undecided=mergeFolderWorkspaces(base,local,cloud)
    expect(undecided.workspace).toBeNull()
    expect(undecided.conflicts).toMatchObject([{
      key:'folder:'+a,kind:'folder',local:'My label (корень)',cloud:'Their label (корень)',
    }])
    expect(mergeFolderWorkspaces(base,local,cloud,{['folder:'+a]:'local'})
      .workspace!.folders[a]?.name).toBe('My label')
    expect(mergeFolderWorkspaces(base,local,cloud,{['folder:'+a]:'cloud'})
      .workspace!.folders[a]?.name).toBe('Their label')
  })
  it('requires independent explicit choices when same file was moved into different folders',()=>{
    let base=addFolder(emptyWorkspace(),'A',null,a,1)
    base=addFolder(base,'B',null,b,2)
    const local=moveFile(base,file,a),cloud=moveFile(base,file,b)
    const key='placement:'+file
    expect(mergeFolderWorkspaces(base,local,cloud).conflicts.map(x=>x.key))
      .toEqual([key])
    expect(mergeFolderWorkspaces(base,local,cloud,{[key]:'local'})
      .workspace!.placements[file]).toBe(a)
    expect(mergeFolderWorkspaces(base,local,cloud,{[key]:'cloud'})
      .workspace!.placements[file]).toBe(b)
  })
  it('refuses unsafe structural merges, including duplicate sibling names and orphan children',()=>{
    const base=emptyWorkspace()
    const local=addFolder(base,'Same',null,a,1)
    const cloud=addFolder(base,'same',null,b,2)
    const duplicate=mergeFolderWorkspaces(base,local,cloud)
    expect(duplicate.workspace).toBeNull()
    expect(duplicate.structuralError).toBe('browser.folder_duplicate_name')
    const parent=addFolder(emptyWorkspace(),'Parent',null,a,1)
    const offline=removeEmptyFolder(parent,a)
    const online=addFolder(parent,'Child',a,b,2)
    const orphan=mergeFolderWorkspaces(parent,offline,online)
    expect(orphan.workspace).toBeNull()
    expect(orphan.structuralError).toBe('browser.folder_missing_parent')
  })
  it('refuses unresolved deletion vs modification and unsafe cyclic reparenting',()=>{
    let base=addFolder(emptyWorkspace(),'A',null,a,1)
    base=addFolder(base,'B',null,b,2)
    const local=removeEmptyFolder(base,a)
    const cloud=renameFolder(base,a,'Changed')
    const result=mergeFolderWorkspaces(base,local,cloud)
    expect(result.conflicts.map(x=>x.key)).toContain('folder:'+a)
    expect(result.workspace).toBeNull()
    expect(mergeFolderWorkspaces(base,local,cloud,{['folder:'+a]:'cloud'})
      .workspace!.folders[a]?.name).toBe('Changed')
    // Distinct moves can create a new cycle even when each snapshot is valid.
    const ours=moveFolder(base,a,b)
    const theirs=moveFolder(base,b,a)
    expect(mergeFolderWorkspaces(base,ours,theirs).structuralError)
      .toBe('browser.folder_cycle')
  })
  it('never treats a placement as file deletion or grants additional media permissions',()=>{
    const base=emptyWorkspace()
    const local=addFolder(base,'Only local',null,a,1)
    const cloud=addFolder(base,'Only cloud',null,b,2)
    const result=mergeFolderWorkspaces(base,local,cloud)
    expect(Object.keys(result.workspace!.placements)).toEqual([])
    expect(Object.keys(base.folders)).toEqual([])
    expect(Object.keys(local.folders)).toEqual([a])
    expect(Object.keys(cloud.folders)).toEqual([b])
  })
})
