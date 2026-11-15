/**
 * Device-only presentation settings for the accepted Browser v3.
 * These values contain no account ID, folder ID, media name, location,
 * decrypted metadata, or signed retention/authorization decisions.
 */
export type BrowserOpeningSection='all'|'personal'|'assignments'|'archive'
export const BROWSER_OPEN_FIRST_KEY='pb3-browser-open-first-v1'
export const BROWSER_FOLDERS_FIRST_KEY='pb3-browser-folders-first-v1'
type StorageLike=Pick<Storage,'getItem'|'setItem'>
function safeStorage():StorageLike|null{
  try{return typeof window!=='undefined'?window.localStorage:null}
  catch{return null}
}
export function readBrowserOpeningSection(
  storage:StorageLike|null=safeStorage(),
):BrowserOpeningSection{
  try{
    const value=storage?.getItem(BROWSER_OPEN_FIRST_KEY)
    if(value==='all'||value==='personal'||value==='assignments'
      ||value==='archive')return value
  }catch{/* Browser is usable if storage is denied. */}
  return 'all'
}
export function saveBrowserOpeningSection(
  section:BrowserOpeningSection,storage:StorageLike|null=safeStorage(),
):boolean{
  if(!['all','personal','assignments','archive'].includes(section))return false
  try{
    if(!storage)return false
    storage.setItem(BROWSER_OPEN_FIRST_KEY,section)
    return true
  }catch{return false}
}
export function readBrowserFoldersFirst(
  storage:StorageLike|null=safeStorage(),
):boolean{
  try{return storage?.getItem(BROWSER_FOLDERS_FIRST_KEY)!=='0'}
  catch{return true}
}
export function saveBrowserFoldersFirst(
  enabled:boolean,storage:StorageLike|null=safeStorage(),
):boolean{
  try{
    if(!storage)return false
    storage.setItem(BROWSER_FOLDERS_FIRST_KEY,enabled?'1':'0')
    return true
  }catch{return false}
}
