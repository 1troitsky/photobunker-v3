export type UserFolder={id:string;parentId:string|null;name:string;createdAt:number}
export type FolderWorkspace={
  version:1
  folders:Record<string,UserFolder>
  placements:Record<string,string>
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const FILE=/^(photo|media):[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const control=/[\u0000-\u001f\u007f]/
export const MAX_FOLDERS=300
export const MAX_PLACEMENTS=10000
export function emptyWorkspace():FolderWorkspace{
  return {version:1,folders:{},placements:{}}
}
export function cleanFolderName(raw:string):string{
  if(typeof raw!=='string'||control.test(raw))throw Error('browser.folder_invalid_name')
  const name=raw.trim()
  if(name.length<1||name.length>80||name==='.'||name==='..'||name.includes('/'))
    throw Error('browser.folder_invalid_name')
  return name
}
function assertId(id:string):void{
  if(!UUID.test(id))throw Error('browser.folder_invalid_id')
}
export function validateWorkspace(raw:unknown):FolderWorkspace{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('browser.folder_invalid_state')
  const s=raw as FolderWorkspace
  if(s.version!==1||!s.folders||!s.placements
    ||typeof s.folders!=='object'||Array.isArray(s.folders)
    ||typeof s.placements!=='object'||Array.isArray(s.placements))
    throw Error('browser.folder_invalid_state')
  const folders=Object.entries(s.folders)
  const entries=Object.entries(s.placements)
  if(folders.length>MAX_FOLDERS||entries.length>MAX_PLACEMENTS)
    throw Error('browser.folder_limit')
  const siblingNames=new Set<string>()
  for(const [key,folder] of folders){
    assertId(key)
    if(!folder||folder.id!==key||!Number.isSafeInteger(folder.createdAt)
      ||folder.createdAt<0||folder.parentId!==null
      &&(typeof folder.parentId!=='string'||!UUID.test(folder.parentId)))
      throw Error('browser.folder_invalid_state')
    if(cleanFolderName(folder.name)!==folder.name)
      throw Error('browser.folder_invalid_name')
    const siblingKey=(folder.parentId??'root')+'\\0'
      +folder.name.toLocaleLowerCase('ru')
    if(siblingNames.has(siblingKey))throw Error('browser.folder_duplicate_name')
    siblingNames.add(siblingKey)
  }
  for(const [key,id] of entries){
    if(!FILE.test(key)||!UUID.test(id)||!Object.hasOwn(s.folders,id))
      throw Error('browser.folder_invalid_placement')
  }
  // Check parents and prohibit cycles, orphaned folders and deep chains.
  for(const [id,folder] of folders){
    let cursor=folder.parentId,steps=0
    while(cursor!==null){
      if(++steps>MAX_FOLDERS||cursor===id)
        throw Error('browser.folder_cycle')
      const parent=s.folders[cursor]
      if(!parent)throw Error('browser.folder_missing_parent')
      cursor=parent.parentId
    }
  }
  return s
}
function clone(s:FolderWorkspace):FolderWorkspace{
  return {version:1,folders:{...s.folders},placements:{...s.placements}}
}
export function addFolder(s:FolderWorkspace,name:string,parentId:string|null,
  id:string,createdAt:number):FolderWorkspace{
  const label=cleanFolderName(name);assertId(id)
  if(parentId!==null&&!Object.hasOwn(s.folders,parentId))
    throw Error('browser.folder_missing_parent')
  if(Object.hasOwn(s.folders,id))throw Error('browser.folder_exists')
  if(Object.keys(s.folders).length>=MAX_FOLDERS)throw Error('browser.folder_limit')
  if(!Number.isSafeInteger(createdAt)||createdAt<0)throw Error('browser.folder_invalid_time')
  if(Object.values(s.folders).some(f=>f.parentId===parentId
    &&f.name.toLocaleLowerCase()===label.toLocaleLowerCase()))
    throw Error('browser.folder_duplicate_name')
  const next=clone(s)
  next.folders[id]={id,parentId,name:label,createdAt}
  return next
}
export function renameFolder(s:FolderWorkspace,id:string,name:string):FolderWorkspace{
  const folder=s.folders[id]
  if(!folder)throw Error('browser.folder_missing')
  const label=cleanFolderName(name)
  if(Object.values(s.folders).some(f=>f.id!==id&&f.parentId===folder.parentId
    &&f.name.toLocaleLowerCase()===label.toLocaleLowerCase()))
    throw Error('browser.folder_duplicate_name')
  const next=clone(s)
  next.folders[id]={...folder,name:label}
  return next
}
export function moveFolder(s:FolderWorkspace,id:string,parentId:string|null):FolderWorkspace{
  const folder=s.folders[id]
  if(!folder)throw Error('browser.folder_missing')
  if(parentId!==null&&!Object.hasOwn(s.folders,parentId))
    throw Error('browser.folder_missing_parent')
  if(id===parentId)throw Error('browser.folder_cycle')
  let parent=parentId,depth=0
  while(parent!==null){
    if(++depth>MAX_FOLDERS||parent===id)throw Error('browser.folder_cycle')
    parent=s.folders[parent]?.parentId??null
  }
  if(Object.values(s.folders).some(f=>f.id!==id&&f.parentId===parentId
    &&f.name.toLocaleLowerCase()===folder.name.toLocaleLowerCase()))
    throw Error('browser.folder_duplicate_name')
  const next=clone(s)
  next.folders[id]={...folder,parentId}
  return next
}
export function moveFile(s:FolderWorkspace,fileKey:string,folderId:string|null):FolderWorkspace{
  if(!FILE.test(fileKey))throw Error('browser.folder_invalid_file')
  if(folderId!==null&&!Object.hasOwn(s.folders,folderId))
    throw Error('browser.folder_missing')
  if(folderId!==null&&!Object.hasOwn(s.placements,fileKey)
    &&Object.keys(s.placements).length>=MAX_PLACEMENTS)
    throw Error('browser.folder_limit')
  const next=clone(s)
  if(folderId===null)delete next.placements[fileKey]
  else next.placements[fileKey]=folderId
  return next
}
export function moveFiles(
  s:FolderWorkspace,fileKeys:readonly string[],folderId:string|null,
):FolderWorkspace{
  if(!Array.isArray(fileKeys)||fileKeys.length<1||fileKeys.length>200
    ||new Set(fileKeys).size!==fileKeys.length)
    throw Error('browser.folder_invalid_selection')
  if(folderId!==null&&!Object.hasOwn(s.folders,folderId))
    throw Error('browser.folder_missing')
  for(const fileKey of fileKeys)
    if(typeof fileKey!=='string'||!FILE.test(fileKey))
      throw Error('browser.folder_invalid_file')
  const next=clone(s)
  for(const fileKey of fileKeys){
    if(folderId===null)delete next.placements[fileKey]
    else next.placements[fileKey]=folderId
  }
  if(Object.keys(next.placements).length>MAX_PLACEMENTS)
    throw Error('browser.folder_limit')
  return next
}
export function removeEmptyFolder(s:FolderWorkspace,id:string):FolderWorkspace{
  if(!Object.hasOwn(s.folders,id))throw Error('browser.folder_missing')
  if(Object.values(s.folders).some(f=>f.parentId===id)
    ||Object.values(s.placements).includes(id))
    throw Error('browser.folder_not_empty')
  const next=clone(s)
  delete next.folders[id]
  return next
}
export function folderPath(s:FolderWorkspace,id:string|null):UserFolder[]{
  const result:UserFolder[]=[]
  let cursor=id,steps=0
  while(cursor!==null){
    if(++steps>MAX_FOLDERS)throw Error('browser.folder_cycle')
    const folder=s.folders[cursor]
    if(!folder)throw Error('browser.folder_missing')
    result.unshift(folder);cursor=folder.parentId
  }
  return result
}
export function folderChildren(s:FolderWorkspace,parentId:string|null):UserFolder[]{
  return Object.values(s.folders)
    .filter(f=>f.parentId===parentId)
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'))
}
