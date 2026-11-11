import {describe,expect,it} from 'vitest'
import {
  emptyWorkspace,addFolder,renameFolder,moveFolder,moveFile,
  removeEmptyFolder,folderChildren,folderPath,validateWorkspace,
} from './folders'
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const c='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const file='media:'+c
describe('P2 encrypted user folders domain',()=>{
  it('creates nested folders and paths; keeps original state immutable',()=>{
    const empty=emptyWorkspace()
    const root=addFolder(empty,'Съёмки',null,a,100)
    const nested=addFolder(root,'День 1',a,b,200)
    expect(empty.folders).toEqual({})
    expect(folderChildren(nested,null).map(x=>x.name)).toEqual(['Съёмки'])
    expect(folderPath(nested,b).map(x=>x.name)).toEqual(['Съёмки','День 1'])
    expect(validateWorkspace(nested)).toBe(nested)
  })
  it('rejects path escapes, duplicates, orphan and cyclic reparenting',()=>{
    const s=addFolder(addFolder(emptyWorkspace(),'Root',null,a,1),'Child',a,b,2)
    expect(()=>addFolder(s,'../etc',null,c,3)).toThrow('browser.folder_invalid_name')
    expect(()=>addFolder(s,'root',null,c,3)).toThrow('browser.folder_duplicate_name')
    expect(()=>addFolder(s,'bad/name',null,c,3)).toThrow('browser.folder_invalid_name')
    expect(()=>renameFolder(s,b,'ROOT')).toBeDefined()
    expect(()=>moveFolder(s,a,b)).toThrow('browser.folder_cycle')
    expect(()=>moveFolder(s,a,'not-found')).toThrow('browser.folder_missing_parent')
    expect(()=>validateWorkspace({
      ...s,folders:{...s.folders,[a]:{...s.folders[a],parentId:b}},
    })).toThrow('browser.folder_cycle')
  })
  it('moves references without changing immutable file identifiers or owner media',()=>{
    const s=addFolder(emptyWorkspace(),'Files',null,a,1)
    const m=moveFile(s,file,a)
    expect(m.placements[file]).toBe(a)
    expect(s.placements).toEqual({})
    const back=moveFile(m,file,null)
    expect(back.placements).toEqual({})
    expect(()=>moveFile(m,'media:../../escape',a))
      .toThrow('browser.folder_invalid_file')
    expect(()=>moveFile(s,file,b)).toThrow('browser.folder_missing')
  })
  it('refuses folder deletion while a child or file is assigned',()=>{
    const s=addFolder(addFolder(emptyWorkspace(),'A',null,a,1),'B',a,b,2)
    expect(()=>removeEmptyFolder(s,a)).toThrow('browser.folder_not_empty')
    const m=moveFile(s,file,b)
    expect(()=>removeEmptyFolder(m,b)).toThrow('browser.folder_not_empty')
    const removed=removeEmptyFolder(s,b)
    expect(Object.keys(removed.folders)).toEqual([a])
    expect(removeEmptyFolder(removed,a).folders).toEqual({})
  })
  it('rejects forged references and inconsistent stored structure',()=>{
    const s=addFolder(emptyWorkspace(),'A',null,a,1)
    const bad={...s,placements:{[file]:b}}
    expect(()=>validateWorkspace(bad)).toThrow('browser.folder_invalid_placement')
    const missingParent={...s,folders:{...s.folders,[a]:{...s.folders[a],parentId:b}}}
    expect(()=>validateWorkspace(missingParent)).toThrow('browser.folder_missing_parent')
  })
})
