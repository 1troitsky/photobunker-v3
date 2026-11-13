import {
  emptyWorkspace,validateWorkspace,
} from './folders'
import type {FolderWorkspace,UserFolder} from './folders'

/** Three-way comparison happens only after client signature+AEAD verification. */
export type ConflictSide='local'|'cloud'
export type FolderMergeConflict={
  key:string;kind:'folder'|'placement';id:string
  local:string;cloud:string
}
export type FolderMergeResult={
  workspace:FolderWorkspace|null
  conflicts:FolderMergeConflict[]
  structuralError:string|null
}
type FolderOrMissing=UserFolder|undefined

function sameFolder(a:FolderOrMissing,b:FolderOrMissing):boolean{
  return a===b||(a!==undefined&&b!==undefined
    &&a.id===b.id&&a.name===b.name&&a.parentId===b.parentId
    &&a.createdAt===b.createdAt)
}
function folderDescription(f:FolderOrMissing):string{
  return f===undefined?'Удалена':
    f.name+(f.parentId===null?' (корень)':' (родитель '+f.parentId+')')
}
function placementDescription(
  value:string|undefined,workspace:FolderWorkspace,
):string{
  return value===undefined?'Мои файлы':
    workspace.folders[value]?.name??'Папка '+value
}
export function mergeFolderWorkspaces(
  base:FolderWorkspace,local:FolderWorkspace,cloud:FolderWorkspace,
  choices:Readonly<Record<string,ConflictSide>>={},
):FolderMergeResult{
  for(const w of [base,local,cloud])validateWorkspace(w)
  const result=emptyWorkspace()
  const conflicts:FolderMergeConflict[]=[]
  const ids=new Set([
    ...Object.keys(base.folders),...Object.keys(local.folders),
    ...Object.keys(cloud.folders),
  ])
  for(const id of [...ids].sort()){
    const before=base.folders[id],ours=local.folders[id],theirs=cloud.folders[id]
    const localChanged=!sameFolder(before,ours)
    const cloudChanged=!sameFolder(before,theirs)
    const different=!sameFolder(ours,theirs)
    const key='folder:'+id
    if(localChanged&&cloudChanged&&different){
      conflicts.push({
        key,kind:'folder',id,
        local:folderDescription(ours),cloud:folderDescription(theirs),
      })
    }
    const useCloud=(localChanged&&cloudChanged&&different)
      ?choices[key]==='cloud':!localChanged
    const selected=useCloud?theirs:ours
    if(selected)result.folders[id]={...selected}
  }
  const files=new Set([
    ...Object.keys(base.placements),...Object.keys(local.placements),
    ...Object.keys(cloud.placements),
  ])
  for(const id of [...files].sort()){
    const before=base.placements[id],ours=local.placements[id],
      theirs=cloud.placements[id]
    const localChanged=ours!==before,cloudChanged=theirs!==before
    const different=ours!==theirs,key='placement:'+id
    if(localChanged&&cloudChanged&&different){
      conflicts.push({
        key,kind:'placement',id,
        local:placementDescription(ours,local),
        cloud:placementDescription(theirs,cloud),
      })
    }
    const useCloud=(localChanged&&cloudChanged&&different)
      ?choices[key]==='cloud':!localChanged
    const selected=useCloud?theirs:ours
    if(selected!==undefined)result.placements[id]=selected
  }
  if(conflicts.some(x=>choices[x.key]!=='cloud'&&choices[x.key]!=='local'))
    return {workspace:null,conflicts,structuralError:null}
  try{
    validateWorkspace(result)
  }catch(e){
    // Folder delete vs child insert, cyclic moves, duplicate sibling names,
    // orphan placements and limits must never be "resolved" by silently
    // dropping the other device's metadata.
    return {workspace:null,conflicts,
      structuralError:e instanceof Error?e.message:'browser.merge_invalid_result'}
  }
  return {workspace:result,conflicts,structuralError:null}
}
