<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue'
import {RouterLink} from 'vue-router'
import {browserShellActions,clearBrowserShellActions}
  from '../features/browser/application/browser-shell-actions'
import {makeBrowserFolderThumbnail}
  from '../features/browser/application/browser-folder-thumbnail'
import {mayCopyPersonalMediaSource}
  from '../features/browser/application/personal-media-copy'
import {
  readBrowserOpeningSection,saveBrowserOpeningSection,
  readBrowserFoldersFirst,saveBrowserFoldersFirst,
} from '../features/browser/application/browser-display-preferences'
import type {BrowserOpeningSection}
  from '../features/browser/application/browser-display-preferences'
import {
  browserRetentionLabel,readBrowserDaysLeft,saveBrowserDaysLeft,
} from '../features/browser/application/browser-days-left'
import {
  captureBrowserReturnContext,takeBrowserReturn,
} from '../features/browser/application/browser-return-context'
import SharePanel from '../features/sharing/SharePanel.vue'
import MediaImportPanel from '../features/media/ui/MediaImportPanel.vue'
import MediaSharePanel from '../features/media/ui/MediaSharePanel.vue'
import {activeSession,reauthenticate} from '../features/identity/application/session'
import {
  flushOutbox,listLocalPhotos,listCloudPhotos,
  readLocalPhoto,readCloudPhoto,readLocalPhotoMetadata,readCloudPhotoMetadata,
} from '../features/photo-sync/application/p1-photo'
import type {StoredPhoto,CloudPhoto} from '../features/photo-sync/application/p1-photo'
import {
  listLocalMedia,listCloudMedia,readLocalMedia,readCloudMedia,
} from '../features/media/application/media-outbox'
import type {StoredMedia,CloudMedia} from '../features/media/application/media-outbox'
import {buildCatalog,filterCatalog,scopeCatalogFolders}
  from '../features/browser/application/catalog'
import {normalizePrivateSearch,searchPrivateMetadata,searchPrivateMetadataBatches}
  from '../features/browser/application/private-search'
import {loadBoundedCatalogIndex}
  from '../features/browser/application/bounded-catalog-expansion'
import {appendAuthenticatedCatalogPage}
  from '../features/browser/application/authenticated-catalog-page'
import type {PrivateSearchResult}
  from '../features/browser/application/private-search'
import type {CatalogFilter,CatalogSort,CatalogView,CatalogItem} from '../features/browser/application/catalog'
import {
  emptyWorkspace,folderChildren,folderPath,
} from '../features/browser/domain/folders'
import type {FolderWorkspace} from '../features/browser/domain/folders'
import {
  loadFolderWorkspace,changeFolderWorkspace,
} from '../features/browser/application/folder-workspace'
import {synchronizeFolderWorkspace} from '../features/browser/application/folder-cloud-sync'
import {
  getFolderLocalSync,listFolderConflictBackups,restoreFolderConflictBackup,
} from '../features/browser/application/folder-workspace'
import type {FolderConflictBackup} from '../features/browser/application/folder-workspace'
import {
  prepareFolderConflict,previewFolderConflict,applyFolderConflictPlan,
} from '../features/browser/application/folder-conflict-resolution'
import type {FolderConflictPlan} from '../features/browser/application/folder-conflict-resolution'
import type {ConflictSide} from '../features/browser/domain/folder-merge'
import {
  listArchivePage,signedArchiveAction,retryPendingArchiveAction,
  getPendingArchiveAction,inspectPendingArchiveAction,
  discardObsoleteArchiveAction,
} from '../features/browser/application/browser-archive'
import type {ArchivePendingInspection} from '../features/browser/application/browser-archive'
import {planArchiveBatch,executeArchiveBatch}
  from '../features/browser/application/archive-batch'
import {
  localArchivePreferences,effectiveArchivePreferenceValues,
  editArchivePreferences,synchronizeArchivePreferences,
  discardArchivePreferenceDraft,
} from '../features/browser/application/archive-preferences'
import type {
  ArchivePreferenceValues,
} from '../features/browser/application/archive-preferences'
import type {ArchivePending} from '../features/browser/application/archive-outbox'
import type {ArchiveEntry,ArchiveAction} from '../features/browser/application/browser-archive'

const localPhotos=ref<StoredPhoto[]>([])
const cloudPhotos=ref<CloudPhoto[]>([])
const localMedia=ref<StoredMedia[]>([])
const cloudMedia=ref<CloudMedia[]>([])
const photoCursor=ref<string|null>(null)
const mediaCursor=ref<string|null>(null)
const filter=ref<CatalogFilter>('all')
const sort=ref<CatalogSort>('newest')
const view=ref<CatalogView>('list')
const treeExpanded=ref<string[]>([])
const search=ref('')
// Ephemeral search UI preference, never persisted or sent to the server.
type SearchFolderScope='current'|'selected'|'all'
const searchFolderScope=ref<SearchFolderScope>('current')
const searchSelectedFolder=ref<string|null>(null)
// Search terms and decrypted match membership are VOLATILE: never persisted,
// synced or placed in a server query parameter.
const privateSearchResult=ref<PrivateSearchResult|null>(null)
const privateSearchBusy=ref(false)
const privateSearchError=ref('')
const privateSearchUnscanned=ref(0)
const privateSearchExpanded=ref(false)
const privateExpansionBusy=ref(false)
const privateExpansionStatus=ref('')
const privateSearchProgress=ref(0)
let privateExpansionEpoch=0
let privateSearchEpoch=0
let privateSearchTimer:ReturnType<typeof setTimeout>|null=null
const busy=ref(false)
const previewBusy=ref(false)
const status=ref('')
const error=ref('')
const selectedUrl=ref('')
const selectedType=ref<CatalogItem['type']|null>(null)
const selectedName=ref('')
const selectedDescription=ref('')
const selectedCategory=ref('')
const selectedTags=ref<string[]>([])
const selectedGps=ref<{latitude:number;longitude:number;accuracyMeters:number}|null>(null)
const selectedCaptured=ref<number|null>(null)
const selectedExpiry=ref<number|null>(null)
let generation=0
let previewGeneration=0
let folderEpoch=0
let folderSyncEpoch=0
const folderWorkspace=ref<FolderWorkspace>(emptyWorkspace())
const folderReady=ref(false)
const folderError=ref('')
const folderNotice=ref('')
const folderBusy=ref(false)
const folderSyncBusy=ref(false)
const folderSyncStatus=ref('')
const mergePlan=ref<FolderConflictPlan|null>(null)
const mergeChoices=ref<Record<string,ConflictSide>>({})
const mergePreview=computed(()=>mergePlan.value
  ?previewFolderConflict(mergePlan.value,mergeChoices.value):null)
const mergeBackups=ref<Omit<FolderConflictBackup,'row'>[]>([])
const selectedFolder=ref<string|null>(null)
let requestedFolderReturn:string|null|undefined
let scrollReturnKey:string|null=null
const createFolderOpen=ref(false)
const createFolderParent=ref('')
const uploadSheetOpen=ref(false)
const sharePhotoId=ref<string|null>(null)
const shareMediaId=ref<string|null>(null)
const shareFileKey=ref<string|null>(null)
const browserSettingsOpen=ref(false)
const showRemainingDays=ref(readBrowserDaysLeft())
const browserOpenFirst=ref<BrowserOpeningSection>(readBrowserOpeningSection())
const foldersFirst=ref(readBrowserFoldersFirst())
function updateBrowserOpenFirst(next:BrowserOpeningSection):void{
  if(saveBrowserOpeningSection(next))browserOpenFirst.value=next
}
function updateBrowserFoldersFirst(value:boolean):void{
  if(saveBrowserFoldersFirst(value))foldersFirst.value=value
}
const retentionClock=ref(Date.now())
let retentionTimer:ReturnType<typeof setInterval>|null=null
function updateRemainingDays(enabled:boolean):void{
  if(saveBrowserDaysLeft(enabled))showRemainingDays.value=enabled
}
function retentionLabel(expiresAt:number):string{
  return browserRetentionLabel(
    expiresAt,retentionClock.value,showRemainingDays.value,
  )
}
const newFolderName=ref('')
const editingFolderId=ref<string|null>(null)
const editFolderName=ref('')
const selectedKeys=ref<string[]>([])
const selectionMode=ref(false)
const bulkActionsOpen=ref(false)
function cancelSelectionMode():void{
  selectionMode.value=false
  selectedKeys.value=[]
  bulkActionsOpen.value=false
  closeFileMenu()
}
function closeBulkActions():void{
  bulkActionsOpen.value=false
  void nextTick(()=>document.querySelector<HTMLButtonElement>(
    '[data-testid="browser-selection-actions"]')?.focus())
}
const fileMenuKey=ref<string|null>(null)
const folderMenuId=ref<string|null>(null)
function closeFileMenu():void{
  fileMenuKey.value=null
  folderMenuId.value=null
}
function fileMenuEscape(key:string):void{
  closeFileMenu()
  void nextTick(()=>{
    const toggle=document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-file-menu-'+key+'"] button.browser-file-menu-toggle',
    )
    toggle?.focus()
  })
}
function toggleFolderMenu(id:string):void{
  if(!folders.value.some(folder=>folder.id===id))return
  folderMenuId.value=folderMenuId.value===id?null:id
  fileMenuKey.value=null
}
function folderMenuEscape():void{
  const id=folderMenuId.value
  closeFileMenu()
  if(id)void nextTick(()=>{
    document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-folder-menu-'+id+'"] button.browser-folder-menu-toggle',
    )?.focus()
  })
}
function toggleFileMenu(key:string):void{
  if(!visible.value.some(item=>item.key===key))return
  fileMenuKey.value=fileMenuKey.value===key?null:key
  folderMenuId.value=null
}
function onBrowserMenuPointerDown(event:PointerEvent):void{
  const el=event.target
  if(fileMenuKey.value||folderMenuId.value){
    if(!(el instanceof Element)||!el.closest(
      '.browser-file-menu-root,.browser-folder-menu-root',
    ))closeFileMenu()
  }
  if(bulkActionsOpen.value
    &&(!(el instanceof Element)||!el.closest('.browser-batch-actions-root')))
    bulkActionsOpen.value=false
}
const bulkDestination=ref('')
const archiveTab=ref<'all'|'archive'>('all')
type PrimarySection='all'|'personal'|'assignments'
const primarySection=ref<PrimarySection>('all')
function choosePrimarySection(next:PrimarySection|'archive'):void{
  if(next==='archive'){
    if(!archivePrefsShown.value.useArchive)return
    archiveTab.value='archive'
    primarySection.value='all'
  }else{
    archiveTab.value='all'
    primarySection.value=next
  }
  filter.value='all'
  search.value=''
  selectedFolder.value=null
  selectedKeys.value=[]
}
const archiveEntries=ref<ArchiveEntry[]>([])
const archiveCursor=ref<string|null>(null)
const archiveBusy=ref(false)
const archiveNotice=ref('')
const archiveBatchNotice=ref('')
const archiveBatchProgress=ref(0)
const archivePending=ref<ArchivePending|null>(null)
const archivePendingError=ref('')
const archiveInspection=ref<ArchivePendingInspection|null>(null)
type ArchiveLocalPrefs=Awaited<ReturnType<typeof localArchivePreferences>>
const archivePrefs=ref<ArchiveLocalPrefs|null>(null)
let archivePrefsEpoch=0
const archivePrefsBusy=ref(false)
const archivePrefsNotice=ref('')
const archivePrefsConflict=ref(false)
const archivePrefsShown=computed<ArchivePreferenceValues>(()=>
  archivePrefs.value?effectiveArchivePreferenceValues(archivePrefs.value)
    :{useArchive:true,autoDeleteAfter7Days:true})
watch(()=>archivePrefsShown.value.useArchive,enabled=>{
  // The accepted Browser v3 hides the Archive tab when the user disables
  // it. Hiding is ONLY presentation, never authorization to erase or extend
  // an archived asset's signed TTL.
  if(!enabled&&archiveTab.value==='archive')archiveTab.value='all'
})
const archivePrefsConfirmed=computed(()=>
  !!archivePrefs.value?.confirmed&&!archivePrefs.value?.draft
    &&!archivePrefs.value?.pending)
async function loadArchivePrefState():Promise<void>{
  const identity=activeSession.value
  if(!identity)return
  try{
    const local=await localArchivePreferences()
    if(identity!==activeSession.value)return
    archivePrefs.value=local
    if(identity.online&&navigator.onLine!==false)
      await syncArchivePrefState()
  }catch(e){
    if(identity===activeSession.value)
      archivePrefsNotice.value='Не удалось загрузить настройки архива: '+reason(e)
  }
}
async function syncArchivePrefState():Promise<void>{
  if(archivePrefsBusy.value||!activeSession.value?.online)return
  const identity=activeSession.value,epoch=++archivePrefsEpoch
  archivePrefsBusy.value=true
  try{
    const result=await synchronizeArchivePreferences()
    if(identity!==activeSession.value)return
    archivePrefs.value=result.data
    archivePrefsConflict.value=result.state==='conflict'
    archivePrefsNotice.value=result.state==='conflict'
      ?'Настройки на другом устройстве изменились. Локальный вариант сохранён, перезапись запрещена.'
      :result.state==='uploaded'?'Настройки архива подтверждены сервером.'
        :'Настройки архива получены с сервера.'
  }catch(e){
    if(identity===activeSession.value)
      archivePrefsNotice.value='Изменения сохранены локально, но не подтверждены сервером: '+reason(e)
  }finally{
    if(epoch===archivePrefsEpoch)archivePrefsBusy.value=false
  }
}
async function setArchivePref(key:keyof ArchivePreferenceValues,value:boolean):Promise<void>{
  if(archivePrefsBusy.value)return
  const identity=activeSession.value
  if(!identity)return
  try{
    archivePrefs.value=await editArchivePreferences({[key]:value})
    if(identity!==activeSession.value)return
    archivePrefsNotice.value='Настройка сохранена на устройстве. Ожидает подтверждения сервера.'
    archivePrefsConflict.value=false
    if(identity.online&&navigator.onLine!==false)
      void syncArchivePrefState()
  }catch(e){
    if(identity===activeSession.value)
      archivePrefsNotice.value='Не удалось сохранить настройку: '+reason(e)
  }
}
async function acceptServerArchivePrefs():Promise<void>{
  if(archivePrefsBusy.value||!activeSession.value?.online
    ||!window.confirm('Заменить неподтверждённый локальный вариант настройками с сервера? Файлы и архивные записи не удаляются.'))return
  const identity=activeSession.value
  archivePrefsBusy.value=true
  try{
    const current=await discardArchivePreferenceDraft()
    if(identity!==activeSession.value)return
    archivePrefs.value=current
    archivePrefsConflict.value=false
    archivePrefsNotice.value='Загружены подтверждённые серверные настройки.'
  }catch(e){
    if(identity===activeSession.value)
      archivePrefsNotice.value='Не удалось принять серверные настройки: '+reason(e)
  }finally{
    if(identity===activeSession.value)archivePrefsBusy.value=false
  }
}
async function refreshArchivePending():Promise<void>{
  const identity=activeSession.value
  if(!identity)return
  try{
    const item=await getPendingArchiveAction()
    if(identity===activeSession.value){
      archivePending.value=item
      if(!item)archiveInspection.value=null
      archivePendingError.value=''
    }
  }catch(e){
    if(identity===activeSession.value)
      archivePendingError.value='Не удалось прочитать зашифрованную очередь: '+reason(e)
  }
}
const archiveWriteEnabled=ref(false)
const archiveCleanupEnabled=ref(false)
const archivedByKey=computed(()=>new Map(
  archiveEntries.value.map(entry=>[entry.kind+':'+entry.assetId,entry] as const)
))
const folders=computed(()=>folderChildren(folderWorkspace.value,selectedFolder.value))
const breadcrumb=computed(()=>folderPath(folderWorkspace.value,selectedFolder.value))
function upOneFolder():void{
  if(selectedFolder.value===null)return
  const path=breadcrumb.value
  selectedFolder.value=path.length>1?path[path.length-2]!.id:null
}
const allFolders=computed(()=>Object.values(folderWorkspace.value.folders)
  .sort((a,b)=>a.name.localeCompare(b.name,'ru')))
/**
 * Browser v3: the move dropdown must never OFFER moving a folder into
 * itself or any descendant. The domain's cycle validation remains the
 * authoritative guard for manipulated events and concurrent edits.
 */
function validFolderMoveTargets(id:string){
  const workspace=folderWorkspace.value
  return allFolders.value.filter(candidate=>{
    let cursor:string|null=candidate.id,steps=0
    while(cursor!==null&&steps++<300){
      if(cursor===id)return false
      cursor=workspace.folders[cursor]?.parentId??null
    }
    return cursor===null
  })
}
function setSearchFolderScope(next:SearchFolderScope):void{
  if(next==='selected'&&(!searchSelectedFolder.value
    ||!folderWorkspace.value.folders[searchSelectedFolder.value])){
    searchSelectedFolder.value=selectedFolder.value
      ??allFolders.value[0]?.id??null
    if(!searchSelectedFolder.value){
      searchFolderScope.value='current'
      return
    }
  }
  searchFolderScope.value=next
}
watch(allFolders,folders=>{
  if(searchSelectedFolder.value
    &&!folders.some(x=>x.id===searchSelectedFolder.value)){
    searchSelectedFolder.value=null
    if(searchFolderScope.value==='selected')searchFolderScope.value='current'
  }
})
function folderLoadedRows(folderId:string):CatalogItem[]{
  return folderCoverIndex.value.get(folderId)?.items??[]
}
function folderLoadedCount(folderId:string):number{
  return folderCoverIndex.value.get(folderId)?.total??0
}
function folderCoverSymbol(item:CatalogItem):string{
  return item.type==='photo'?'▧':item.type==='video'?'▹':'♫'
}
function canEditViaPrivateCopy(item:CatalogItem):boolean{
  if(item.source!=='media'||!item.local||item.expiresAt<=Date.now())
    return false
  const row=localMedia.value.find(media=>media.mediaId===item.id)
  // Only personal local media. A signed assignment capture MUST NOT
  // be copied as if it were an independently editable owner file.
  return mayCopyPersonalMediaSource(row)
}
const treeNodes=computed(()=>{
  const workspace=folderWorkspace.value
  const results:{id:string;name:string;depth:number;children:number}[]=[]
  const walk=(parentId:string|null,depth:number):void=>{
    for(const node of folderChildren(workspace,parentId)){
      const children=folderChildren(workspace,node.id).length
      results.push({id:node.id,name:node.name,depth,children})
      if(treeExpanded.value.includes(node.id)&&depth<300)walk(node.id,depth+1)
    }
  }
  walk(null,0)
  return results
})
function toggleTreeFolder(id:string):void{
  if(!folderWorkspace.value.folders[id])return
  if(treeExpanded.value.includes(id))
    treeExpanded.value=treeExpanded.value.filter(x=>x!==id)
  else treeExpanded.value=[...treeExpanded.value,id]
}
function selectTreeFolder(id:string|null):void{
  if(id!==null&&!folderWorkspace.value.folders[id])return
  selectedFolder.value=id
  if(id!==null){
    const ancestors=folderPath(folderWorkspace.value,id).map(node=>node.id)
    treeExpanded.value=[...new Set([...treeExpanded.value,...ancestors])]
  }
}
const importFolderOptions=computed(()=>allFolders.value.map(folder=>({
  id:folder.id,
  label:folderPath(folderWorkspace.value,folder.id)
    .map(part=>part.name).join(' / '),
})))

const items=computed(()=>buildCatalog(
  localPhotos.value,[
    ...cloudPhotos.value,
    ...archiveEntries.value.filter(x=>x.kind==='photo'&&x.state!=='restored').map(x=>({
      photoId:x.assetId,expiresAt:x.expiresAt,metadataAssetId:null,
    })),
  ],localMedia.value,[
    ...cloudMedia.value,
    ...archiveEntries.value.filter(x=>x.kind==='media'&&x.mediaType!==null
      &&x.state!=='restored').map(x=>({
      mediaId:x.assetId,mediaType:x.mediaType!,// Nullable archive byte counts must not be displayed/sorted as zero.
       plainBytes:x.plainBytes??Number.NaN,
      expiresAt:x.expiresAt,
    })),
  ],
))
// Build the 2×2 covers ONCE per authenticated catalog/folder revision.
// The previous per-folder function scanned every file 4+ times during render.
// Rows are bounded to four; the count includes known nested descendants only.
const folderCoverIndex=computed(()=>{
  const workspace=folderWorkspace.value
  const result=new Map<string,{items:CatalogItem[];total:number}>()
  for(const id of Object.keys(workspace.folders)){
    result.set(id,{items:[],total:0})
  }
  for(const item of items.value){
    const archived=archivedByKey.value.get(item.key)?.state
    if(archived==='archived'||archived==='deleting')continue
    let parent:string|null=workspace.placements[item.key]??null
    let hops=0
    while(parent!==null&&hops++<300){
      const summary=result.get(parent)
      if(!summary)break
      summary.total++
      if(summary.items.length<4)summary.items.push(item)
      parent=workspace.folders[parent]?.parentId??null
    }
  }
  return result
})
// Only a handful of LOCAL decrypted image tiles are shown. No full-res
// background cloud downloads, private persistent caches, or native galleries.
const folderThumbnailUrls=ref<Record<string,string>>({})
let folderThumbnailEpoch=0
let folderThumbnailOwner:typeof activeSession.value=null
function revokeFolderThumbnails():void{
  ++folderThumbnailEpoch
  for(const url of Object.values(folderThumbnailUrls.value))
    URL.revokeObjectURL(url)
  folderThumbnailUrls.value={}
  folderThumbnailOwner=null
}
const folderThumbnailCandidateKeys=computed(()=>{
  const keys:string[]=[]
  const add=(row:CatalogItem):void=>{
    if(row.local&&row.type==='photo'&&!keys.includes(row.key))
      keys.push(row.key)
  }
  // At most 8 folder cards × 4 cells, capped to 12 decoded images.
  for(const folder of folders.value.slice(0,8)){
    for(const row of folderLoadedRows(folder.id)){
      add(row)
      if(keys.length>=12)return keys
    }
  }
  // The same small in-memory preview serves actual list/grid file rows.
  for(const row of visible.value.slice(0,12)){
    add(row)
    if(keys.length>=16)break
  }
  return keys
})
async function warmFolderThumbnails():Promise<void>{
  const owner=activeSession.value
  if(folderThumbnailOwner!==owner){
    revokeFolderThumbnails()
    folderThumbnailOwner=owner
  }
  const token=++folderThumbnailEpoch
  const selected=new Set(folderThumbnailCandidateKeys.value)
  const existing={...folderThumbnailUrls.value}
  for(const [key,url] of Object.entries(existing)){
    if(selected.has(key))continue
    URL.revokeObjectURL(url)
    delete existing[key]
  }
  folderThumbnailUrls.value=existing
  if(!owner)return
  // Sequential crypto/decoding bounds peak decoded memory to one image.
  for(const key of selected){
    if(token!==folderThumbnailEpoch||owner!==activeSession.value)return
    if(folderThumbnailUrls.value[key])continue
    const row=items.value.find(item=>item.key===key&&item.local
      &&item.type==='photo')
    if(!row)continue
    try{
      const blob=row.source==='photo'
        ?await readLocalPhoto(row.id)
        :(await readLocalMedia(row.id)).blob
      if(token!==folderThumbnailEpoch||owner!==activeSession.value)return
      const jpeg=await makeBrowserFolderThumbnail(blob)
      if(token!==folderThumbnailEpoch||owner!==activeSession.value)return
      const url=URL.createObjectURL(jpeg)
      if(token!==folderThumbnailEpoch||owner!==activeSession.value){
        URL.revokeObjectURL(url)
        return
      }
      folderThumbnailUrls.value={...folderThumbnailUrls.value,[key]:url}
    }catch{
      // Decryption, MIME, codec and memory failures produce the neutral icon.
      // Never display raw bytes or treat failed decryption as successful.
    }
  }
}
// Classification is a VISUAL scope only. The assignment page owns server
// roster/ACL enforcement. Cloud-only index rows have no signed capture
// provenance and cannot be falsely categorized as assigned media here.
const localAssignmentKeys=computed(()=>{
  const scoped=new Set<string>()
  for(const photo of localPhotos.value){
    if(photo.capture)scoped.add('photo:'+photo.photoId)
  }
  for(const media of localMedia.value){
    if(media.capture)scoped.add('media:'+media.mediaId)
  }
  return scoped
})
const searchScope=computed(()=>{
  const authenticatedRows=filterCatalog(items.value,{
    type:filter.value,query:'',sort:sort.value,
  }).filter(item=>{
    const archived=archivedByKey.value.get(item.key)?.state
    if(archiveTab.value==='archive')
      return archived==='archived'||archived==='deleting'
    return archived!=='archived'&&archived!=='deleting'
  })
  // "Мои фото" and "Задания" restrict the already-authenticated catalog.
  // These are NOT authorization scopes and MUST NOT invent cloud-only proof.
  const scopedRows=archiveTab.value==='archive'||primarySection.value==='all'
    ?authenticatedRows
    :primarySection.value==='personal'
      ?authenticatedRows.filter(item=>item.type==='photo'&&item.local
        &&!localAssignmentKeys.value.has(item.key))
      :authenticatedRows.filter(item=>localAssignmentKeys.value.has(item.key))
  // Folders are encrypted virtual client metadata. An all-folder query
  // sees ONLY rows already loaded from authenticated catalog endpoints.
  // Archive already has its own scope, independent of the active folder.
  if(archiveTab.value==='archive'||!folderReady.value)return scopedRows
  const hasQuery=search.value.trim().length>0
  if(hasQuery&&searchFolderScope.value==='selected'){
    const target=searchSelectedFolder.value
    // No selected or still-existing folder means NO matches, not root
    // or an accidental account-wide search.
    if(!target||!folderWorkspace.value.folders[target])return []
    return scopeCatalogFolders(
      scopedRows,folderWorkspace.value.placements,target,false,
    )
  }
  return scopeCatalogFolders(
    scopedRows,folderWorkspace.value.placements,selectedFolder.value,
    hasQuery&&searchFolderScope.value==='all',
  )
})
const visible=computed(()=>filterCatalog(searchScope.value,{
  type:'all',query:search.value,sort:sort.value,
  privateMatches:privateSearchResult.value?.query===normalizePrivateSearch(search.value)
    ?privateSearchResult.value.matches:undefined,
}))
watch([activeSession,folderThumbnailCandidateKeys],
  ()=>{void warmFolderThumbnails()},{immediate:true})

function catalogSizeLabel(bytes:number|null):string{
  if(bytes===null||!Number.isSafeInteger(bytes)||bytes<0)
    return 'Размер неизвестен'
  const units=['Б','КиБ','МиБ','ГиБ','ТиБ'] as const
  let value=bytes,index=0
  while(value>=1024&&index<units.length-1){value/=1024;index++}
  return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value)
    +' '+units[index]
}
function catalogFolderLabel(item:CatalogItem):string{
  const placement=folderWorkspace.value.placements[item.key]??null
  if(!placement)return 'Мои файлы'
  return folderPath(folderWorkspace.value,placement)
    .map(folder=>folder.name).join(' / ')
}
function schedulePrivateSearch():void{
  const epoch=++privateSearchEpoch
  if(privateSearchTimer!==null){
    clearTimeout(privateSearchTimer)
    privateSearchTimer=null
  }
  privateSearchResult.value=null
  privateSearchError.value=''
  privateSearchBusy.value=false
  privateSearchUnscanned.value=0
  privateSearchProgress.value=0
  const query=normalizePrivateSearch(search.value)
  const identity=activeSession.value
  if(!identity||query.length<2||query.length>160)return
  const rows=searchScope.value
  const scanLimit=privateSearchExpanded.value?1000:200
  privateSearchUnscanned.value=Math.max(0,rows.length-scanLimit)
  privateSearchBusy.value=true
  privateSearchTimer=setTimeout(()=>{
    privateSearchTimer=null
    const valid=()=>epoch===privateSearchEpoch&&activeSession.value===identity
    const task=privateSearchExpanded.value
      ?searchPrivateMetadataBatches(query,rows.slice(0,1000),valid,
        done=>{if(valid())privateSearchProgress.value=done})
      :searchPrivateMetadata(query,rows.slice(0,200),valid)
    void task.then(result=>{
        if(epoch===privateSearchEpoch&&activeSession.value===identity)
          privateSearchResult.value=result
      })
      .catch(e=>{
        if(epoch===privateSearchEpoch&&activeSession.value===identity)
          privateSearchError.value='Поиск не завершён: '+reason(e)
      })
      .finally(()=>{
        if(epoch===privateSearchEpoch)
          privateSearchBusy.value=false
      })
  },250)
}
/**
 * Explicit, bounded wider search: download only authenticated, opaque
 * photo/media index pages (max 500 per protocol) and never send the user
 * query, metadata plaintext, tags or folder labels over HTTP.
 *
 * All validation happens BEFORE publishing any newly loaded rows. A changed
 * query, account, route refresh or offline transition cancels the scan.
 */
async function expandPrivateSearch():Promise<void>{
  const identity=activeSession.value
  const query=normalizePrivateSearch(search.value)
  if(!identity?.online||typeof navigator!=='undefined'&&navigator.onLine===false
    ||privateExpansionBusy.value||busy.value||archiveTab.value!=='all'
    ||query.length<2||query.length>160)return
  const token=++privateExpansionEpoch
  const catGeneration=generation
  const scopeAtStart=searchFolderScope.value
  const folderAtStart=searchSelectedFolder.value
  const valid=()=>token===privateExpansionEpoch
    &&identity===activeSession.value&&generation===catGeneration
    &&normalizePrivateSearch(search.value)===query
    &&searchFolderScope.value===scopeAtStart
    &&searchSelectedFolder.value===folderAtStart
    &&archiveTab.value==='all'
    &&(typeof navigator==='undefined'||navigator.onLine!==false)
  privateExpansionBusy.value=true
  privateExpansionStatus.value=''
  try{
    const [photos,media]=await Promise.all([
      loadBoundedCatalogIndex(listCloudPhotos,row=>row.photoId,valid),
      loadBoundedCatalogIndex(listCloudMedia,row=>row.mediaId,valid),
    ])
    if(!valid())return
    // Local-first state is never discarded. Do not replace a previously
    // manually loaded larger index with a 500-row bounded first-page scan.
    if(cloudPhotos.value.length<=photos.items.length){
      cloudPhotos.value=photos.items
      photoCursor.value=photos.nextCursor
    }else{
      const known=new Map(cloudPhotos.value.map(x=>[x.photoId,x] as const))
      for(const item of photos.items)known.set(item.photoId,item)
      cloudPhotos.value=[...known.values()]
    }
    if(cloudMedia.value.length<=media.items.length){
      cloudMedia.value=media.items
      mediaCursor.value=media.nextCursor
    }else{
      const known=new Map(cloudMedia.value.map(x=>[x.mediaId,x] as const))
      for(const item of media.items)known.set(item.mediaId,item)
      cloudMedia.value=[...known.values()]
    }
    // Expanded authenticated index pages may include many folders, but a
    // wider network fetch must never change the explicit local search scope.
    privateSearchExpanded.value=true
    privateExpansionStatus.value='Получено '+photos.items.length+' фото и '
      +media.items.length+' медиа из авторизованных индексов. '
      +(photos.complete&&media.complete
        ?'Индексы этих двух типов загружены полностью.'
        :'Дальнейшие облачные страницы ещё существуют: поиск НЕ по всему аккаунту.')
      +' Содержимое проверяется только на устройстве (до 1000 файлов).'
  }catch(e){
    if(valid()){
      privateExpansionStatus.value='Расширенный поиск не запущен: '+reason(e)
        +'. Неполные страницы не опубликованы; попробуйте позже.'
    }
  }finally{
    if(token===privateExpansionEpoch)privateExpansionBusy.value=false
  }
}

const pendingCount=computed(()=>items.value.filter(x=>!['archived','deleting'].includes(
  archivedByKey.value.get(x.key)?.state??'')&&x.local
  &&x.state!=='synced').length)

async function loadArchiveMore():Promise<void>{
  const s=activeSession.value
  if(!s?.online||archiveBusy.value||!archiveCursor.value)return
  archiveBusy.value=true
  const cursor=archiveCursor.value
  try{
    const page=await listArchivePage(cursor)
    if(s!==activeSession.value)return
    const ids=new Set(archiveEntries.value.map(x=>x.entryId))
    archiveEntries.value=[...archiveEntries.value,
      ...page.items.filter(x=>!ids.has(x.entryId))]
    archiveCursor.value=page.nextCursor
    archiveWriteEnabled.value=page.writeEnabled
    archiveCleanupEnabled.value=page.autoCleanupEnabled
  }catch(e){
    if(s===activeSession.value)archiveNotice.value='Архив: '+reason(e)
  }finally{
    if(s===activeSession.value)archiveBusy.value=false
  }
}
async function inspectArchivePending():Promise<void>{
  if(archiveBusy.value||!archivePending.value||!activeSession.value?.online)
    return
  const session=activeSession.value
  archiveBusy.value=true
  archiveNotice.value=''
  try{
    const result=await inspectPendingArchiveAction()
    if(session!==activeSession.value)return
    archiveInspection.value=result
    archiveNotice.value=result?.status==='committed'
      ?'Сервер подтвердил ранее принятую подписанную операцию.'
      :result?.status==='obsolete'
        ?'Сервер подтвердил конфликт: исходная ревизия больше не действительна. Запрос не выполнен и не может быть принят позднее.'
        :'Исходная операция ещё может быть выполнена сервером. Снимать её с очереди небезопасно.'
    await refreshArchivePending()
    if(result?.status==='committed'){
      const page=await listArchivePage()
      if(session!==activeSession.value)return
      archiveEntries.value=page.items
      archiveCursor.value=page.nextCursor
      void refresh()
    }
  }catch(e){
    if(session===activeSession.value)
      archiveNotice.value='Не удалось подтвердить состояние запроса: '+reason(e)
  }finally{
    if(session===activeSession.value)archiveBusy.value=false
  }
}
async function discardArchiveObsolete():Promise<void>{
  if(archiveBusy.value||archiveInspection.value?.status!=='obsolete'
    ||!activeSession.value?.online
    ||!window.confirm('Снять запрос, который сервер подтвердил как устаревший? Это не выполняет удаление файла. Состояние архива будет загружено заново.'))return
  const session=activeSession.value
  archiveBusy.value=true
  try{
    await discardObsoleteArchiveAction()
    if(session!==activeSession.value)return
    archiveInspection.value=null
    archiveNotice.value='Устаревший запрос безопасно снят после повторной серверной проверки.'
    await refreshArchivePending()
    const page=await listArchivePage()
    if(session!==activeSession.value)return
    archiveEntries.value=page.items
    archiveCursor.value=page.nextCursor
    void refresh()
  }catch(e){
    if(session===activeSession.value)
      archiveNotice.value='Не удалось снять неподтверждённый запрос: '+reason(e)
  }finally{
    if(session===activeSession.value){
      archiveBusy.value=false
      await refreshArchivePending()
    }
  }
}
async function retryArchivePending():Promise<void>{
  if(archiveBusy.value||!activeSession.value?.online||!archiveWriteEnabled.value)
    return
  const identity=activeSession.value
  archiveBusy.value=true
  archiveNotice.value=''
  try{
    const result=await retryPendingArchiveAction()
    if(identity!==activeSession.value)return
    archiveNotice.value=result
      ?'Подписанный запрос восстановлен по исходному operationId. Сервер подтвердил состояние: '+result.state
      :'Неподтверждённых операций архива нет.'
    const page=await listArchivePage()
    if(identity!==activeSession.value)return
    archiveEntries.value=page.items
    archiveCursor.value=page.nextCursor
    archiveWriteEnabled.value=page.writeEnabled
    archiveCleanupEnabled.value=page.autoCleanupEnabled
    void refresh()
  }catch(e){
    if(identity===activeSession.value)
      archiveNotice.value='Операция ещё не подтверждена, подписанный запрос сохранён: '+reason(e)
  }finally{
    if(identity===activeSession.value){
      archiveBusy.value=false
      await refreshArchivePending()
    }
  }
}
async function archiveAction(item:CatalogItem,action:ArchiveAction):Promise<void>{
  if(archiveBusy.value||busy.value||!activeSession.value?.online
    ||!archiveWriteEnabled.value)return
  const entry=archivedByKey.value.get(item.key)
  if(action==='restore'&&!entry)return
  if(action==='archive'&&!archivePrefsConfirmed.value
    ||action==='delete'&&archiveTab.value==='all'
      &&(!archivePrefsConfirmed.value||archivePrefsShown.value.useArchive))
    return
  if(action==='delete'&&!window.confirm(
    'Окончательно удалить файл? Доступ будет закрыт немедленно, физическое удаление подтвердится отдельно. Восстановление невозможно.'))return
  if(action==='archive'&&!window.confirm(
    'Переместить файл в архив? Срок файла не продлится. Для общих материалов могут потребоваться предварительный отзыв доступа и проверка задания.'))return
  const identity=activeSession.value
  archiveBusy.value=true
  archiveNotice.value=''
  try{
    const result=await signedArchiveAction(entry??item,action)
    if(identity!==activeSession.value)return
    archiveNotice.value=result.state==='archived'
      ?'Файл помещён в архив на сервере.'
      :result.state==='restored'
        ?'Файл восстановлен из архива. Срок хранения не изменился.'
        :'Удаление запрошено. Доступ закрыт; физическая очистка S3 ещё НЕ подтверждена.'
    const page=await listArchivePage()
    if(identity!==activeSession.value)return
    archiveEntries.value=page.items
    archiveCursor.value=page.nextCursor
    archiveWriteEnabled.value=page.writeEnabled
    archiveCleanupEnabled.value=page.autoCleanupEnabled
    void refresh()
  }catch(e){
    if(identity===activeSession.value)
      archiveNotice.value='Операция архива не подтверждена: '+reason(e)
  }finally{
    if(identity===activeSession.value){
      archiveBusy.value=false
      await refreshArchivePending()
    }
  }
}
async function runArchiveBatch(action:ArchiveAction):Promise<void>{
  if(archiveBusy.value||folderBusy.value||busy.value
    ||archivePending.value||!archiveWriteEnabled.value
    ||!archivePrefsConfirmed.value||!activeSession.value?.online)return
  let plan
  try{
    plan=planArchiveBatch({
      selectedKeys:selectedKeys.value,
      visible:visible.value,archived:archivedByKey.value,
      tab:archiveTab.value,useArchive:archivePrefsShown.value.useArchive,
      action,
    })
  }catch(e){
    archiveBatchNotice.value='Массовая операция отклонена до отправки: '+reason(e)
    return
  }
  const irreversible=action==='delete'
  const prompt=irreversible
    ?'Окончательно удалить '+plan.rows.length+' файлов? Это необратимо, доступ будет закрываться последовательно по подтверждениям сервера. Физическая очистка S3 проверяется отдельно.'
    :action==='archive'
      ?'Переместить '+plan.rows.length+' файлов в архив? Каждый запрос будет подтверждён отдельно сервером.'
      :'Восстановить '+plan.rows.length+' файлов из архива без продления TTL?'
  if(!window.confirm(prompt))return
  const identity=activeSession.value
  archiveBusy.value=true
  archiveBatchNotice.value=''
  archiveBatchProgress.value=0
  try{
    const result=await executeArchiveBatch(
      plan,signedArchiveAction,
      ()=>activeSession.value===identity,
      key=>{
        selectedKeys.value=selectedKeys.value.filter(x=>x!==key)
        archiveBatchProgress.value++
      },
    )
    if(identity!==activeSession.value)return
    archiveBatchNotice.value=result.failedKey
      ?'Подтверждено '+result.completed.length+' из '+plan.rows.length+
        '. Остановлено на следующем файле: '+reason(result.failure)+
        '. Неподтверждённая подписанная операция сохранена; остальные файлы не затронуты.'
      :'Все '+result.completed.length+' операций подтверждены сервером. Физическое удаление не заявлено.'
    // Refresh authoritative list after partial success too; a failed
    // signed request must remain visible in the existing durable outbox.
    try{
      const page=await listArchivePage()
      if(identity!==activeSession.value)return
      archiveEntries.value=page.items
      archiveCursor.value=page.nextCursor
      archiveWriteEnabled.value=page.writeEnabled
      archiveCleanupEnabled.value=page.autoCleanupEnabled
    }catch(e){
      archiveBatchNotice.value+=' Архивный список пока не обновлён: '+reason(e)
    }
    void refresh()
  }finally{
    if(identity===activeSession.value){
      archiveBusy.value=false
      await refreshArchivePending()
    }
  }
}
async function loadMergeBackups():Promise<void>{
  const session=activeSession.value
  if(!session)return
  try{
    const items=await listFolderConflictBackups()
    if(session===activeSession.value)mergeBackups.value=items
  }catch(e){
    if(session===activeSession.value)
      folderNotice.value='Не удалось проверить локальные копии: '+reason(e)
  }
}
async function compareFolderConflict():Promise<void>{
  if(folderBusy.value||folderSyncBusy.value||!folderReady.value
    ||folderError.value||!activeSession.value?.online)return
  const session=activeSession.value,epoch=++folderSyncEpoch
  folderSyncBusy.value=true
  mergePlan.value=null
  mergeChoices.value={}
  try{
    const plan=await prepareFolderConflict()
    if(session!==activeSession.value||epoch!==folderSyncEpoch)return
    mergePlan.value=plan
    folderSyncStatus.value='Сравнение выполнено локально: проверьте изменения перед объединением.'
  }catch(e){
    if(session===activeSession.value&&epoch===folderSyncEpoch)
      folderSyncStatus.value='Сравнение не выполнено: '+reason(e)
  }finally{
    if(epoch===folderSyncEpoch)folderSyncBusy.value=false
  }
}
async function applyFolderMerge():Promise<void>{
  const plan=mergePlan.value
  if(!plan||!mergePreview.value?.workspace||folderBusy.value
    ||folderSyncBusy.value||!activeSession.value?.online)return
  const hasExplicitChoices=mergePreview.value.conflicts.length>0
  if(hasExplicitChoices&&!window.confirm(
    'Применить выбранные версии конфликтующих элементов? Исходная локальная структура сохранится в зашифрованной копии.'))return
  const session=activeSession.value,epoch=++folderSyncEpoch
  folderSyncBusy.value=true
  try{
    const result=await applyFolderConflictPlan(plan,{...mergeChoices.value})
    if(session!==activeSession.value||epoch!==folderSyncEpoch)return
    const current=await loadFolderWorkspace()
    if(session!==activeSession.value||epoch!==folderSyncEpoch)return
    folderWorkspace.value=current
    if(selectedFolder.value&&!Object.hasOwn(current.folders,selectedFolder.value))
      selectedFolder.value=null
    mergePlan.value=null
    mergeChoices.value={}
    folderSyncStatus.value=result.state==='uploaded'
      ?'Версии папок объединены и подтверждены сервером. Локальная копия сохранена.'
      :'Объединение сохранено на устройстве. Облако изменилось повторно: выполните сравнение ещё раз.'
    await loadMergeBackups()
  }catch(e){
    if(session===activeSession.value&&epoch===folderSyncEpoch){
      mergePlan.value=null
      folderSyncStatus.value='Не удалось применить объединение: '+reason(e)
    }
  }finally{
    if(epoch===folderSyncEpoch)folderSyncBusy.value=false
  }
}
async function restoreFolderBackup(id:string):Promise<void>{
  if(folderBusy.value||folderSyncBusy.value||!folderReady.value
    ||!window.confirm('Восстановить старую локальную структуру папок? Текущее состояние будет сохранено в отдельной зашифрованной копии. Облако не изменится.'))return
  const session=activeSession.value,epoch=++folderSyncEpoch
  folderSyncBusy.value=true
  try{
    const workspace=await restoreFolderConflictBackup(id)
    if(session!==activeSession.value||epoch!==folderSyncEpoch)return
    folderWorkspace.value=workspace
    mergePlan.value=null
    mergeChoices.value={}
    selectedFolder.value=null
    folderSyncStatus.value='Локальная копия восстановлена. Для обновления облака нужна новая синхронизация.'
    await loadMergeBackups()
  }catch(e){
    if(session===activeSession.value&&epoch===folderSyncEpoch)
      folderSyncStatus.value='Не удалось восстановить копию: '+reason(e)
  }finally{
    if(epoch===folderSyncEpoch)folderSyncBusy.value=false
  }
}
async function syncFoldersCloud():Promise<void>{
  if(folderSyncBusy.value||folderBusy.value||!folderReady.value||folderError.value
    ||!activeSession.value?.online)return
  const session=activeSession.value,epoch=++folderSyncEpoch
  folderSyncBusy.value=true
  folderSyncStatus.value=''
  mergePlan.value=null
  mergeChoices.value={}
  try{
    const result=await synchronizeFolderWorkspace()
    if(session!==activeSession.value)return
    if(result.state==='downloaded'){
      const fresh=await loadFolderWorkspace()
      if(session!==activeSession.value)return
      folderWorkspace.value=fresh
      if(selectedFolder.value&&!Object.hasOwn(fresh.folders,selectedFolder.value))
        selectedFolder.value=null
    }
    const state=({
      uploaded:'Облачный снимок папок подтверждён сервером.',
      downloaded:'Зашифрованные папки получены и проверены на этом устройстве.',
      'up-to-date':'Локальная структура соответствует подтверждённой облачной версии.',
      empty:'Сохранять в облако пока нечего.',
      conflict:'Конфликт версий: локальные изменения сохранены. Нельзя автоматически перезаписывать облако или локальные папки.',
    } as const)[result.state]
    const local=await getFolderLocalSync()
    if(session!==activeSession.value||epoch!==folderSyncEpoch)return
    folderSyncStatus.value=local.localRevision!==local.marker.confirmedLocalRevision
      &&result.state!=='conflict'
      ? state+' Есть более новые локальные изменения, ещё не переданные в облако.'
      : state
  }catch(e){
    if(session===activeSession.value&&epoch===folderSyncEpoch)
      folderSyncStatus.value='Синхронизация не подтверждена: '+reason(e)
  }finally{
    if(epoch===folderSyncEpoch)folderSyncBusy.value=false
  }
}
async function loadFolders():Promise<void>{
  const session=activeSession.value,epoch=++folderEpoch
  folderWorkspace.value=emptyWorkspace()
  folderReady.value=false
  folderError.value=''
  folderSyncStatus.value=''
  mergePlan.value=null
  mergeChoices.value={}
  selectedFolder.value=null
  if(!session)return
  try{
    const next=await loadFolderWorkspace()
    if(session!==activeSession.value||epoch!==folderEpoch)return
    folderWorkspace.value=next
    // An imported return context is only a location hint. The encrypted
    // workspace is authoritative: deleted/foreign folders resolve to root.
    if(requestedFolderReturn!==undefined){
      const requested=requestedFolderReturn
      requestedFolderReturn=undefined
      selectedFolder.value=requested!==null&&Object.hasOwn(next.folders,requested)
        ?requested:null
    }
  }catch(e){
    if(session===activeSession.value&&epoch===folderEpoch)
      folderError.value='Не удалось расшифровать локальные папки: '+reason(e)
  }finally{
    if(session===activeSession.value&&epoch===folderEpoch)folderReady.value=true
  }
}
async function changeFolders(change:Parameters<typeof changeFolderWorkspace>[0]):Promise<boolean>{
  if(!folderReady.value||folderError.value||folderBusy.value)return false
  const session=activeSession.value,epoch=folderEpoch
  folderBusy.value=true;folderNotice.value=''
  mergePlan.value=null
  mergeChoices.value={}
  try{
    const next=await changeFolderWorkspace(change)
    if(session!==activeSession.value||epoch!==folderEpoch)return false
    folderWorkspace.value=next
    folderNotice.value='Локальные изменения сохранены. Для передачи на другое устройство синхронизируйте папки.'
    folderSyncStatus.value='Есть новые локальные изменения.'
    return true
  }catch(e){
    if(session===activeSession.value&&epoch===folderEpoch)folderNotice.value=reason(e)
    return false
  }finally{
    if(session===activeSession.value&&epoch===folderEpoch)folderBusy.value=false
  }
}
async function createFolder():Promise<void>{
  const parent=createFolderParent.value||null
  const ok=await changeFolders({kind:'add',id:crypto.randomUUID(),
    parentId:parent,name:newFolderName.value,at:Date.now()})
  if(ok){
    newFolderName.value=''
    createFolderOpen.value=false
    createFolderParent.value=''
    document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-header-folder"]')?.focus()
  }
}
function openRename(id:string,name:string):void{
  editingFolderId.value=id;editFolderName.value=name
}
async function renameCurrentFolder():Promise<void>{
  if(!editingFolderId.value)return
  const ok=await changeFolders({kind:'rename',id:editingFolderId.value,
    name:editFolderName.value})
  if(ok)editingFolderId.value=null
}
async function changeFolderParent(id:string,event:Event):Promise<void>{
  const value=(event.target as HTMLSelectElement).value
  await changeFolders({kind:'move-folder',id,parentId:value||null})
  // Vue rerenders the controlled value after success/failure.
  ;(event.target as HTMLSelectElement).value=
    folderWorkspace.value.folders[id]?.parentId??''
}
async function changeItemFolder(item:CatalogItem,event:Event):Promise<void>{
  const value=(event.target as HTMLSelectElement).value
  await changeFolders({kind:'move-file',key:item.key,folderId:value||null})
  ;(event.target as HTMLSelectElement).value=
    folderWorkspace.value.placements[item.key]??''
}
function toggleItem(key:string,checked:boolean):void{
  if(!selectionMode.value||!visible.value.some(row=>row.key===key))return
  if(checked){
    if(selectedKeys.value.includes(key))return
    if(selectedKeys.value.length>=200){
      folderNotice.value='Для группового переноса выберите не более 200 файлов.'
      return
    }
    selectedKeys.value=[...selectedKeys.value,key]
  }else selectedKeys.value=selectedKeys.value.filter(x=>x!==key)
}
function selectVisible():void{
  if(visible.value.length>200){
    folderNotice.value='Для группового переноса выберите не более 200 файлов.'
    return
  }
  selectedKeys.value=visible.value.map(x=>x.key)
}
async function placeImportedMedia(data:{
  mediaIds:string[];folderId:string|null
}):Promise<void>{
  const identity=activeSession.value
  if(!identity)return
  if(data.mediaIds.length<1||data.mediaIds.length>20
    ||new Set(data.mediaIds).size!==data.mediaIds.length)return
  if(data.folderId!==null){
    const keys=data.mediaIds.map(id=>'media:'+id)
    const moved=await changeFolders({kind:'move-files',
      keys,folderId:data.folderId})
    if(identity!==activeSession.value)return
    if(!moved){
      // Never roll back or destroy already AES-GCM-encrypted outbox files.
      // Unplaced files remain at the root and can be moved manually.
      const error=folderNotice.value
      folderNotice.value='Файлы зашифрованы и сохранены, но папка назначения '
        +'не подтверждена. Файлы доступны в корне. '+error
    }
  }
  if(identity===activeSession.value)void refresh()
}
async function moveSelected():Promise<void>{
  const ids=selectedKeys.value.slice()
  if(ids.length===0)return
  const ok=await changeFolders({kind:'move-files',
    keys:ids,folderId:bulkDestination.value||null})
  if(ok)selectedKeys.value=[]
}
async function deleteEmptyFolder(id:string):Promise<void>{
  if(!window.confirm('Удалить пустую пользовательскую папку? Файлы и облако затронуты не будут.'))return
  const ok=await changeFolders({kind:'remove-empty',id})
  if(ok&&selectedFolder.value===id)selectedFolder.value=null
}
function revokePreview():void{
  ++previewGeneration
  if(selectedUrl.value)URL.revokeObjectURL(selectedUrl.value)
  selectedUrl.value=''
  selectedType.value=null
  selectedName.value=''
  selectedDescription.value=''
  selectedCategory.value=''
  selectedTags.value=[]
  selectedGps.value=null
  selectedCaptured.value=null
  selectedExpiry.value=null
}
function clearCatalog():void{
  ++privateExpansionEpoch
  privateExpansionBusy.value=false
  privateSearchExpanded.value=false
  privateExpansionStatus.value=''
  localPhotos.value=[];localMedia.value=[]
  cloudPhotos.value=[];cloudMedia.value=[]
  photoCursor.value=null;mediaCursor.value=null
}
function reason(e:unknown):string{
  return e instanceof Error?e.message:'browser.unavailable'
}

async function refresh():Promise<void>{
  const identity=activeSession.value,token=++generation
  clearCatalog();error.value='';status.value=''
  if(!identity)return
  busy.value=true
  try{
    const [photos,media]=await Promise.all([listLocalPhotos(),listLocalMedia()])
    if(identity!==activeSession.value||token!==generation)return
    localPhotos.value=photos;localMedia.value=media
    if(!identity.online||(typeof navigator!=='undefined'&&navigator.onLine===false)){
      status.value='Офлайн: показаны только зашифрованные файлы этого устройства.'
      return
    }
    // Independent server endpoints: failure of one catalog cannot erase the
    // other. A cloud row is visible only after an authenticated server read.
    const [cloudP,cloudM,archive]=await Promise.allSettled([
      listCloudPhotos(),listCloudMedia(),listArchivePage(),
    ])
    if(identity!==activeSession.value||token!==generation)return
    let invalidIndex=false
    if(cloudP.status==='fulfilled'){
      try{
        const page=appendAuthenticatedCatalogPage(
          [],cloudP.value,null,row=>row.photoId)
        cloudPhotos.value=page.items
        photoCursor.value=page.nextCursor
      }catch{invalidIndex=true}
    }
    if(cloudM.status==='fulfilled'){
      try{
        const page=appendAuthenticatedCatalogPage(
          [],cloudM.value,null,row=>row.mediaId)
        cloudMedia.value=page.items
        mediaCursor.value=page.nextCursor
      }catch{invalidIndex=true}
    }
    if(archive.status==='fulfilled'){
      archiveEntries.value=archive.value.items
      archiveCursor.value=archive.value.nextCursor
      archiveWriteEnabled.value=archive.value.writeEnabled
      archiveCleanupEnabled.value=archive.value.autoCleanupEnabled
    }else{
      archiveNotice.value='Статус архива не проверен: '+reason(archive.reason)
    }
    if(cloudP.status==='rejected'||cloudM.status==='rejected'||invalidIndex)
      status.value='Не все облачные списки доступны или их курсоры повреждены. Локальные файлы сохранены; непроверенные страницы не добавлены.'
  }catch(e){
    if(identity===activeSession.value&&token===generation)error.value=reason(e)
  }finally{
    if(token===generation)busy.value=false
  }
}
async function more():Promise<void>{
  const identity=activeSession.value
  if(!identity?.online||busy.value||(!photoCursor.value&&!mediaCursor.value))return
  const token=generation
  const previousPhotos=photoCursor.value,previousMedia=mediaCursor.value
  busy.value=true;error.value=''
  const [photos,media]=await Promise.allSettled([
    previousPhotos?listCloudPhotos(previousPhotos):Promise.resolve(null),
    previousMedia?listCloudMedia(previousMedia):Promise.resolve(null),
  ])
  if(identity===activeSession.value&&token===generation){
    let invalidIndex=false
    if(photos.status==='fulfilled'&&photos.value){
      try{
        const next=appendAuthenticatedCatalogPage(
          cloudPhotos.value,photos.value,previousPhotos,
          row=>row.photoId)
        cloudPhotos.value=next.items
        photoCursor.value=next.nextCursor
      }catch{invalidIndex=true}
    }
    if(media.status==='fulfilled'&&media.value){
      try{
        const next=appendAuthenticatedCatalogPage(
          cloudMedia.value,media.value,previousMedia,
          row=>row.mediaId)
        cloudMedia.value=next.items
        mediaCursor.value=next.nextCursor
      }catch{invalidIndex=true}
    }
    if(photos.status==='rejected'||media.status==='rejected'||invalidIndex)
      error.value='Не удалось проверить следующую страницу облачного каталога. Ранее загруженные файлы сохранены; курсор не изменён.'
    busy.value=false
  }
}
async function sync():Promise<void>{
  if(busy.value)return
  busy.value=true;error.value='';status.value=''
  try{
    if(!activeSession.value?.online)await reauthenticate()
    await flushOutbox()
    await refresh()
    status.value='Очередь фотографий проверена. Импортированное медиа синхронизируется в блоке импорта.'
  }catch(e){error.value=reason(e)}
  finally{busy.value=false}
}
async function openItem(item:CatalogItem,fromCloud=false):Promise<void>{
  const identity=activeSession.value,token=++previewGeneration
  if(!identity)return
  previewBusy.value=true;error.value=''
  try{
    let blob:Blob,name='',description='',category=''
    let tags:string[]=[]
    let gps:{latitude:number;longitude:number;accuracyMeters:number}|null=null
    let captured:number|null=null
    if(item.source==='photo'){
      const [photo,metadata]=await Promise.all([
        item.local&&!fromCloud?readLocalPhoto(item.id):readCloudPhoto(item.id),
        item.local&&!fromCloud?readLocalPhotoMetadata(item.id):readCloudPhotoMetadata(item.id),
      ])
      blob=photo
      name=item.id.slice(0,8)
      description=metadata.description??''
      category=metadata.category??''
      tags=metadata.tags??[]
      gps=metadata.gps??null
      captured=metadata.capturedAt
    }else{
      const result=item.local&&!fromCloud
        ?await readLocalMedia(item.id):await readCloudMedia(item.id)
      blob=result.blob
      name=result.metadata.fileName
      description=result.metadata.description??''
      category=result.metadata.category??''
      tags=result.metadata.tags??[]
      gps=result.metadata.gps??null
      captured=result.metadata.createdAt
    }
    if(identity!==activeSession.value||token!==previewGeneration)return
    revokePreview()
    selectedUrl.value=URL.createObjectURL(blob)
    selectedType.value=item.type
    selectedName.value=name
    selectedDescription.value=description
    selectedCategory.value=category
    selectedTags.value=tags
    selectedGps.value=gps
    selectedCaptured.value=captured
    selectedExpiry.value=item.expiresAt
  }catch(e){
    if(identity===activeSession.value&&token===previewGeneration)
      error.value=reason(e)
  }finally{
    if(identity===activeSession.value)previewBusy.value=false
  }
}
function preserveViewerOrigin(item:CatalogItem,event:MouseEvent):void{
  // A new tab has no shared JS memory; never capture a stale return context
  // for Cmd/Ctrl/Shift/Alt-click or auxiliary-button navigation.
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return
  const identity=activeSession.value
  if(!identity)return
  captureBrowserReturnContext({
    accountId:identity.accountId,deviceId:identity.deviceId,
    fileKey:item.key,folderId:selectedFolder.value,
    folderNames:breadcrumb.value.map(folder=>folder.name),
    filter:filter.value,sort:sort.value,view:view.value,
    search:search.value,searchFolderScope:searchFolderScope.value,
    searchSelectedFolder:searchSelectedFolder.value,
    archiveTab:archiveTab.value,primarySection:primarySection.value,
    fileKeys:visible.value.map(row=>row.key),
  })
}
function showReceived(blob:Blob):void{
  revokePreview()
  selectedUrl.value=URL.createObjectURL(blob)
  selectedType.value='photo'
  selectedName.value='Полученный снимок'
}
watch(activeSession,(next,previous)=>{
  ++generation
  ++folderSyncEpoch
  ++archivePrefsEpoch
  folderSyncBusy.value=false
  archivePrefsBusy.value=false
  // Same-device session reauthentication changes the Session reference, not
  // the user's workspace. Retain typed folder forms and breadcrumb location.
  // A real account/device change must clear all formerly decrypted UI state.
  revokePreview()
  clearCatalog()
  if(next?.accountId!==previous?.accountId
    ||next?.deviceId!==previous?.deviceId){
    requestedFolderReturn=undefined
    scrollReturnKey=null
    editingFolderId.value=null
    createFolderOpen.value=false
    createFolderParent.value=''
    uploadSheetOpen.value=false
    sharePhotoId.value=null
    shareMediaId.value=null
    shareFileKey.value=null
    browserSettingsOpen.value=false
    newFolderName.value=''
    editFolderName.value=''
    selectedKeys.value=[]
    selectionMode.value=false
    bulkActionsOpen.value=false
    closeFileMenu()
    treeExpanded.value=[]
    bulkDestination.value=''
    folderNotice.value=''
    folderSyncStatus.value=''
    mergePlan.value=null
    mergeChoices.value={}
    mergeBackups.value=[]
    archiveTab.value='all'
    primarySection.value='all'
    if(next)choosePrimarySection(browserOpenFirst.value)
    archiveEntries.value=[]
    archiveCursor.value=null
    archiveNotice.value=''
    archiveWriteEnabled.value=false
    archiveCleanupEnabled.value=false
    archivePending.value=null
    archivePendingError.value=''
    archiveInspection.value=null
    archiveBatchNotice.value=''
    archiveBatchProgress.value=0
    archiveBusy.value=false
    archivePrefs.value=null
    archivePrefsNotice.value=''
    archivePrefsConflict.value=false
    search.value=''
    searchFolderScope.value='current'
    searchSelectedFolder.value=null
    privateSearchResult.value=null
    void refreshArchivePending()
    void loadFolders()
    void loadMergeBackups()
  }else if(next&&!folderReady.value){
    // A first load could have been fenced out while bootstrap upgraded the
    // same device to an online Session; retry without losing a typed form.
    void loadFolders()
  }
  // Reauthentication creates a new Session object for the SAME device.
  // Retry authoritative preference loading after the upgrade, without
  // clearing the encrypted local draft or changing its signed revision.
  if(next)void loadArchivePrefState()
  void refresh()
})
watch([selectedFolder,filter,search,searchFolderScope,archiveTab,primarySection],
  ()=>{selectedKeys.value=[];bulkActionsOpen.value=false;closeFileMenu()})
watch(visible,items=>{
  if(fileMenuKey.value&&!items.some(item=>item.key===fileMenuKey.value))
    closeFileMenu()
  if(selectedKeys.value.length){
    const valid=new Set(items.filter(item=>archiveTab.value==='all'
      ||archivedByKey.value.get(item.key)?.state==='archived')
      .map(item=>item.key))
    const kept=selectedKeys.value.filter(key=>valid.has(key))
    if(kept.length!==selectedKeys.value.length)selectedKeys.value=kept
  }
})
watch([search,searchScope,activeSession,privateSearchExpanded],schedulePrivateSearch)
watch([visible,folderReady],async()=>{
  const key=scrollReturnKey
  if(!key||!folderReady.value||!visible.value.some(item=>item.key===key))return
  await nextTick()
  if(scrollReturnKey!==key)return
  const item=document.querySelector<HTMLElement>(
    `[data-testid="browser-row-${key}"]`)
  if(item){item.scrollIntoView({block:'center'});scrollReturnKey=null}
})
watch([search,archiveTab,searchFolderScope,searchSelectedFolder],()=>{
  // Broader authenticated index fetches are explicit per typed query/scope.
  // Changing the question/tab must invalidate in-flight work immediately.
  ++privateExpansionEpoch
  privateExpansionBusy.value=false
  privateSearchExpanded.value=false
  privateExpansionStatus.value=''
})
const browserHeaderOwner={}
function scrollToElement(selector:string,focus=false):void{
  const el=document.querySelector<HTMLElement>(selector)
  el?.scrollIntoView({block:'start',behavior:'auto'})
  if(focus)el?.focus({preventScroll:true})
}
function openCreateFolder():void{
  if(!activeSession.value||!folderReady.value||!!folderError.value||folderBusy.value)return
  uploadSheetOpen.value=false
  browserSettingsOpen.value=false
  createFolderParent.value=selectedFolder.value??''
  createFolderOpen.value=true
  void nextTick(()=>{
    document.querySelector<HTMLInputElement>(
      '[data-testid="browser-folder-name"]')?.focus()
  })
}
function closeCreateFolder():void{
  if(folderBusy.value)return
  createFolderOpen.value=false
  createFolderParent.value=''
  newFolderName.value=''
  void nextTick(()=>{
    document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-header-folder"]')?.focus()
  })
}
function newFolderSheetKeydown(event:KeyboardEvent):void{
  if(!createFolderOpen.value)return
  if(event.key==='Escape'){
    event.preventDefault();closeCreateFolder();return
  }
  if(event.key!=='Tab')return
  const root=document.querySelector<HTMLElement>(
    '[data-testid="browser-new-folder-sheet"]')
  const elements=Array.from(root?.querySelectorAll<HTMLElement>(
    'button:not(:disabled),input:not(:disabled),select:not(:disabled)'
  )??[])
  if(!elements.length)return
  const first=elements[0]!,last=elements[elements.length-1]!
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus()
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus()
  }
}
/** The accepted Browser file menu opens the EXISTING audited E2EE grant
 * pipeline for the selected local photo, never an unrestricted share link.
 * Received grants remain accessible through the legacy panel until the
 * incoming-materials UX has an independently accepted destination. */
function openPhotoShare(item:CatalogItem):void{
  if(!activeSession.value||item.source!=='photo'||!item.local)return
  sharePhotoId.value=item.id
  shareMediaId.value=null
  shareFileKey.value=item.key
  uploadSheetOpen.value=false
  createFolderOpen.value=false
  browserSettingsOpen.value=false
  closeFileMenu()
  void nextTick(()=>{
    document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-photo-share-close"]')?.focus()
  })
}
function openMediaShare(item:CatalogItem):void{
  if(!activeSession.value||item.source!=='media'||!item.local)return
  sharePhotoId.value=null
  shareMediaId.value=item.id
  shareFileKey.value=item.key
  uploadSheetOpen.value=false
  createFolderOpen.value=false
  browserSettingsOpen.value=false
  closeFileMenu()
  void nextTick(()=>{
    document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-media-share-close"]')?.focus()
  })
}
function closePhotoShare():void{
  const key=shareFileKey.value
  sharePhotoId.value=null
  shareMediaId.value=null
  shareFileKey.value=null
  void nextTick(()=>{
    if(key)document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-row-'+key+'"] [data-testid="browser-file-menu-toggle"]'
    )?.focus()
  })
}
function fileShareKeydown(event:KeyboardEvent):void{
  if(!sharePhotoId.value&&!shareMediaId.value)return
  if(event.key==='Escape'){
    event.preventDefault();closePhotoShare();return
  }
  if(event.key!=='Tab')return
  const root=document.querySelector<HTMLElement>(
    '[data-testid="browser-photo-share-sheet"],[data-testid="browser-media-share-sheet"]')
  const enabled=Array.from(root?.querySelectorAll<HTMLElement>(
    'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]'
  )??[])
  if(!enabled.length)return
  const first=enabled[0]!,last=enabled[enabled.length-1]!
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus()
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus()
  }
}
function openUploadPanel():void{
  if(!activeSession.value)return
  createFolderOpen.value=false
  browserSettingsOpen.value=false
  uploadSheetOpen.value=true
  // This is the ONE original MediaImportPanel instance; opening/closing
  // merely moves its existing controls visually, with the durable encrypted
  // outbox and the destination selection staying completely intact.
  void nextTick(()=>{
    if(uploadSheetOpen.value)
      document.querySelector<HTMLButtonElement>(
        '[data-testid="browser-import-sheet-close"]')?.focus()
  })
}
function closeUploadPanel():void{
  uploadSheetOpen.value=false
  void nextTick(()=>{
    document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-header-upload"]')?.focus()
  })
}
function uploadSheetKeydown(event:KeyboardEvent):void{
  if(!uploadSheetOpen.value)return
  if(event.key==='Escape'){
    event.preventDefault();closeUploadPanel();return
  }
  if(event.key!=='Tab')return
  const root=document.querySelector<HTMLElement>('[data-testid="browser-import-sheet"]')
  const enabled=Array.from(root?.querySelectorAll<HTMLElement>(
    'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]'
  )??[])
  if(!enabled.length)return
  const first=enabled[0]!,last=enabled[enabled.length-1]!
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus()
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus()
  }
}
function focusPrivateSearch():void{
  if(!activeSession.value)return
  scrollToElement('[data-testid="browser-search"]',true)
}
function openBrowserSettings():void{
  if(!activeSession.value)return
  createFolderOpen.value=false
  uploadSheetOpen.value=false
  browserSettingsOpen.value=true
  void nextTick(()=>{
    document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-settings-close"]')?.focus()
  })
}
function closeBrowserSettings():void{
  browserSettingsOpen.value=false
  void nextTick(()=>{
    document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-header-settings"]')?.focus()
  })
}
function browserSettingsKeydown(event:KeyboardEvent):void{
  if(!browserSettingsOpen.value)return
  if(event.key==='Escape'){
    event.preventDefault();closeBrowserSettings();return
  }
  if(event.key!=='Tab')return
  const root=document.querySelector<HTMLElement>(
    '[data-testid="browser-archive-preferences"]')
  const enabled=Array.from(root?.querySelectorAll<HTMLElement>(
    'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]'
  )??[])
  if(!enabled.length)return
  const first=enabled[0]!,last=enabled[enabled.length-1]!
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus()
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus()
  }
}
function toggleBatchSelection():void{
  if(!activeSession.value||!folderReady.value||!!folderError.value||folderBusy.value)return
  if(selectionMode.value)cancelSelectionMode()
  else{
    selectionMode.value=true
    selectedKeys.value=[]
    bulkActionsOpen.value=false
    closeFileMenu()
  }
}
watch([activeSession,folderReady,folderError,folderBusy,visible,selectedKeys,selectionMode],()=>{
  browserShellActions.value={
    owner:browserHeaderOwner,
    canCreateFolder:!!activeSession.value&&folderReady.value
      &&!folderError.value&&!folderBusy.value,
    canSelect:!!activeSession.value&&folderReady.value
      &&!folderError.value&&!folderBusy.value
      &&(selectionMode.value||visible.value.length>0),
    selecting:selectionMode.value,
    selectedCount:selectedKeys.value.length,
    createFolder:openCreateFolder,openUpload:openUploadPanel,
    toggleSelection:toggleBatchSelection,focusSearch:focusPrivateSearch,
    openSettings:openBrowserSettings,
  }
},{immediate:true})
onMounted(()=>{
  document.addEventListener('pointerdown',onBrowserMenuPointerDown)
  retentionClock.value=Date.now()
  retentionTimer=setInterval(()=>{retentionClock.value=Date.now()},60000)
  const identity=activeSession.value
  const restored=identity?takeBrowserReturn(identity.accountId,identity.deviceId):null
  if(restored){
    filter.value=restored.filter;sort.value=restored.sort;view.value=restored.view
    search.value=restored.search
    searchFolderScope.value=restored.searchFolderScope
    searchSelectedFolder.value=restored.searchSelectedFolder??null
    archiveTab.value=restored.archiveTab
    primarySection.value=restored.primarySection??'all'
    requestedFolderReturn=restored.folderId
    scrollReturnKey=restored.fileKey
  }else if(identity){
    choosePrimarySection(browserOpenFirst.value)
  }
  schedulePrivateSearch()
  void loadFolders();void loadMergeBackups();void loadArchivePrefState()
  void refreshArchivePending();void refresh()
})
onUnmounted(()=>{
  document.removeEventListener('pointerdown',onBrowserMenuPointerDown)
  closeFileMenu()
  sharePhotoId.value=null
  shareMediaId.value=null
  shareFileKey.value=null
  revokeFolderThumbnails()
  if(retentionTimer!==null){clearInterval(retentionTimer);retentionTimer=null}
  clearBrowserShellActions(browserHeaderOwner)
  ++generation;++folderEpoch;++folderSyncEpoch;++archivePrefsEpoch
  ++privateSearchEpoch;++privateExpansionEpoch
  if(privateSearchTimer!==null)clearTimeout(privateSearchTimer)
  privateSearchTimer=null
  privateSearchResult.value=null
  privateExpansionBusy.value=false
  privateSearchExpanded.value=false
  search.value=''
  searchFolderScope.value='current'
  searchSelectedFolder.value=null
  scrollReturnKey=null
  requestedFolderReturn=undefined
  archivePrefsBusy.value=false
  mergePlan.value=null;mergeChoices.value={};mergeBackups.value=[]
  archivePending.value=null
  archiveInspection.value=null
  archivePrefs.value=null
  revokePreview()
})
</script>

<template>
  <section class="foundation-content browser-v3" data-testid="browser-v3">
    <div class="browser-title">
      <div>
        <h1>Browser</h1>
        <p class="subtitle">Папок: {{ folders.length }} · Файлов: {{ visible.length }}</p>
      </div>
      <div v-if="activeSession" class="browser-view-switch"
        aria-label="Вид каталога" data-testid="browser-view-switch">
        <button type="button" :aria-pressed="view==='grid'"
          data-testid="browser-view-grid" @click="view='grid'">Сетка</button>
        <button type="button" :aria-pressed="view==='list'"
          data-testid="browser-view-list" @click="view='list'">Список</button>
        <button type="button" :aria-pressed="view==='tree'"
          data-testid="browser-view-tree" @click="view='tree'">Дерево</button>
      </div>
    </div>
    <div v-if="!activeSession" class="foundation-card">
      <p>Список файлов доступен после входа.</p>
      <RouterLink to="/settings">Открыть доступ</RouterLink>
    </div>
    <template v-else>
      <nav class="browser-archive-tabs browser-primary-sections"
        aria-label="Разделы Browser" data-testid="browser-primary-sections">
        <button type="button" data-testid="browser-tab-active"
          :aria-pressed="archiveTab==='all'&&primarySection==='all'"
          @click="choosePrimarySection('all')">Все</button>
        <button type="button" data-testid="browser-tab-personal"
          :aria-pressed="archiveTab==='all'&&primarySection==='personal'"
          @click="choosePrimarySection('personal')">Мои фото</button>
        <button type="button" data-testid="browser-tab-assignments"
          :aria-pressed="archiveTab==='all'&&primarySection==='assignments'"
          @click="choosePrimarySection('assignments')">Задания</button>
        <button v-if="archivePrefsShown.useArchive" type="button"
          data-testid="browser-tab-archive"
          :aria-pressed="archiveTab==='archive'"
          @click="choosePrimarySection('archive')">Архив</button>
      </nav>
      <p v-if="primarySection==='personal'&&archiveTab==='all'"
        class="browser-section-note" data-testid="browser-personal-catalog-scope">
        Здесь показаны только доступные на этом устройстве фотографии без
        подписанного контекста задания. Облачные файлы, назначение которых
        ещё не проверено, остаются в разделе «Все».
      </p>
      <p v-if="primarySection==='assignments'&&archiveTab==='all'"
        class="browser-section-note" data-testid="browser-assignment-catalog-scope">
        Показываются только загруженные на этом устройстве материалы с
        сохранённым подписанным контекстом задания. Проверка участия и доступов
        выполняется при открытии файлов; облачные материалы без доказательства
        задания здесь не классифицируются.
      </p>
      <section class="browser-folders" data-testid="browser-folders">
        <div class="browser-folder-head">
          <div class="browser-breadcrumb" aria-label="Путь папки">
            <button type="button" class="browser-folder-up" aria-label="На уровень выше"
              data-testid="browser-folder-up" :disabled="selectedFolder===null"
              @click="upOneFolder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.8" aria-hidden="true">
                <path d="m14 5-7 7 7 7"/>
              </svg>
            </button>
            <button type="button" :aria-current="selectedFolder===null?'location':undefined"
              @click="selectedFolder=null">Мои файлы</button>
            <template v-for="part in breadcrumb" :key="part.id">
              <span aria-hidden="true">/</span>
              <button type="button"
                :aria-current="selectedFolder===part.id?'location':undefined"
                @click="selectedFolder=part.id">{{ part.name }}</button>
            </template>
          </div>
          <!-- Create Folder is the sole shared Header action per Browser v3. -->
        </div>
        <p class="muted">Названия и состав папок зашифрованы. Изменения сохраняются
          сразу на устройстве, а общий снимок передаётся только после подтверждения сервера.
          Перемещение по папкам не меняет шифротекст медиа и права доступа.</p>
        <div class="browser-folder-cloud">
          <button type="button" data-testid="browser-folder-sync"
            :disabled="folderSyncBusy||folderBusy||!folderReady||!!folderError||!activeSession.online"
            @click="syncFoldersCloud">
            {{ folderSyncBusy?'Передаём папки…':'Обновить папки в облаке' }}
          </button>
          <span v-if="folderSyncStatus" data-testid="browser-folder-sync-status"
            role="status" class="muted">{{ folderSyncStatus }}</span>
        </div>
        <div v-if="folderSyncStatus.includes('Конфликт версий')&&!mergePlan"
          class="browser-merge-entry">
          <button type="button" data-testid="browser-merge-open"
            :disabled="folderSyncBusy||folderBusy||!activeSession.online"
            @click="compareFolderConflict">Сравнить изменения папок</button>
        </div>
        <section v-if="mergePlan" data-testid="browser-merge-review"
          class="browser-merge-review">
          <h3>Согласование папок</h3>
          <p class="muted">Облачная версия {{ mergePlan.remoteRevision }},
            исходная версия {{ mergePlan.baseRevision }}. Сравнение выполняется только
            на этом устройстве. Сначала проверяются независимые правки,
            затем выбираются версии спорных элементов.</p>
          <p v-if="mergePreview&&mergePreview.conflicts.length===0">
            Противоречивых изменений нет. Независимые изменения объединятся.</p>
          <div v-for="conflict in mergePreview?.conflicts??[]" :key="conflict.key"
            class="browser-merge-conflict" :data-testid="'browser-merge-'+conflict.key">
            <strong>{{ conflict.kind==='folder'?'Папка':'Расположение файла' }}</strong>
            <div class="browser-merge-choices">
              <label><input type="radio" :name="conflict.key" value="local"
                :checked="mergeChoices[conflict.key]==='local'"
                @change="mergeChoices[conflict.key]='local'">
                На устройстве: {{ conflict.local }}</label>
              <label><input type="radio" :name="conflict.key" value="cloud"
                :checked="mergeChoices[conflict.key]==='cloud'"
                @change="mergeChoices[conflict.key]='cloud'">
                В облаке: {{ conflict.cloud }}</label>
            </div>
          </div>
          <p v-if="mergePreview?.structuralError" role="alert">
            Объединение небезопасно: {{ mergePreview.structuralError }}.
            Отмените сравнение и исправьте локальную структуру.</p>
          <p class="muted">Перед объединением будет сохранена зашифрованная
            резервная копия текущих локальных папок. Обновление облака
            подтверждается отдельно сервером.</p>
          <div class="browser-merge-actions">
            <button type="button" data-testid="browser-merge-apply"
              :disabled="!mergePreview?.workspace||folderSyncBusy||folderBusy"
              @click="applyFolderMerge">Применить и синхронизировать</button>
            <button type="button" @click="mergePlan=null;mergeChoices={}">
              Отмена</button>
          </div>
        </section>
        <div v-if="mergeBackups.length" class="browser-merge-backups"
          data-testid="browser-merge-backups">
          <strong>Зашифрованные локальные копии ({{ mergeBackups.length }})</strong>
          <div v-for="backup in mergeBackups" :key="backup.id"
            class="browser-merge-backup">
            <span>Копия от {{ new Date(backup.createdAt).toLocaleString('ru-RU') }}
              · версия {{ backup.fromBaseRevision }}</span>
            <button type="button" :disabled="folderBusy||folderSyncBusy"
              :data-testid="'browser-restore-'+backup.id"
              @click="restoreFolderBackup(backup.id)">Восстановить локально</button>
          </div>
        </div>
        <div v-if="createFolderOpen" class="browser-new-folder-backdrop"
          data-testid="browser-new-folder-backdrop"
          @click="closeCreateFolder"></div>
        <form v-if="createFolderOpen"
          class="browser-folder-form browser-new-folder-sheet"
          data-testid="browser-new-folder-sheet"
          role="dialog" aria-modal="true" aria-label="Новая папка"
          @keydown="newFolderSheetKeydown" @submit.prevent="createFolder">
          <header class="browser-new-folder-heading">
            <strong>Новая папка</strong>
            <button type="button" data-testid="browser-new-folder-close"
              :disabled="folderBusy" @click="closeCreateFolder">Закрыть</button>
          </header>
          <label>Название папки
            <input v-model="newFolderName" maxlength="80" autocomplete="off"
              data-testid="browser-folder-name" required>
          </label>
          <label for="browser-new-folder-parent">Расположение
            <select id="browser-new-folder-parent" v-model="createFolderParent"
              data-testid="browser-new-folder-parent" :disabled="folderBusy">
              <option value="">Мои файлы (корень)</option>
              <option v-for="folder in importFolderOptions"
                :key="folder.id" :value="folder.id">{{folder.label}}</option>
            </select>
          </label>
          <div class="browser-new-folder-actions">
            <button type="submit" :disabled="folderBusy">Создать</button>
            <button type="button" :disabled="folderBusy" @click="closeCreateFolder">
              Отмена</button>
          </div>
        </form>
        <div id="browser-folder-cards-top" data-testid="browser-folder-cards-top"></div>
        <form v-if="editingFolderId" class="browser-folder-form"
          @submit.prevent="renameCurrentFolder">
          <label>Новое название
            <input v-model="editFolderName" maxlength="80" required
              data-testid="browser-rename-folder">
          </label>
          <button type="submit" :disabled="folderBusy">Сохранить</button>
          <button type="button" @click="editingFolderId=null">Отмена</button>
        </form>
        <p v-if="!folderReady" role="status" class="muted">Загружаются зашифрованные папки…</p>
        <p v-if="folderError" role="alert" class="error-text">{{ folderError }}</p>
        <p v-if="folderNotice" role="status" class="muted">{{ folderNotice }}</p>
      </section>
      <div v-if="browserSettingsOpen" class="browser-settings-backdrop"
        data-testid="browser-settings-backdrop" @click="closeBrowserSettings"></div>
      <section v-show="browserSettingsOpen" class="browser-archive-preferences"
        :class="{'is-browser-settings-sheet':browserSettingsOpen}"
        data-testid="browser-archive-preferences"
        :role="browserSettingsOpen?'dialog':undefined"
        :aria-modal="browserSettingsOpen?'true':undefined"
        :aria-label="browserSettingsOpen?'Настройки Browser':undefined"
        @keydown="browserSettingsKeydown">
        <header v-if="browserSettingsOpen" class="browser-settings-heading">
          <strong>Настройки Browser</strong>
          <button type="button" data-testid="browser-settings-close"
            aria-label="Закрыть настройки Browser" @click="closeBrowserSettings">
            Закрыть</button>
        </header>
        <h2>Отображение</h2>
        <label for="browser-pref-open-first">Открывать первым
          <select id="browser-pref-open-first" :value="browserOpenFirst"
            data-testid="browser-pref-open-first"
            @change="updateBrowserOpenFirst(($event.target as HTMLSelectElement).value as BrowserOpeningSection)">
            <option value="all">Все</option>
            <option value="personal">Мои фото</option>
            <option value="assignments">Задания</option>
            <option v-if="archivePrefsShown.useArchive" value="archive">Архив</option>
          </select>
        </label>
        <label>
          <input type="checkbox" data-testid="browser-pref-folders-first"
            :checked="foldersFirst"
            @change="updateBrowserFoldersFirst(($event.target as HTMLInputElement).checked)">
          Папки всегда сверху
        </label>
        <p class="muted">Положение папок меняется только на экране.
          Файлы и шифрованная структура остаются на прежнем месте.</p>
        <label>
          <input type="checkbox" data-testid="browser-pref-days-left"
            :checked="showRemainingDays"
            @change="updateRemainingDays(($event.target as HTMLInputElement).checked)">
          Показывать оставшиеся дни
        </label>
        <p class="muted">Меняется только текст срока хранения. Подписанный TTL файла,
          права доступа и очистка на сервере не изменяются.</p>
        <h2>Настройки архива</h2>
        <label>
          <input type="checkbox" data-testid="browser-pref-use-archive"
            :checked="archivePrefsShown.useArchive"
            :disabled="archivePrefsBusy||!!archivePrefs?.pending"
            @change="setArchivePref('useArchive',($event.target as HTMLInputElement).checked)">
          Использовать архив
        </label>
        <label>
          <input type="checkbox" data-testid="browser-pref-auto-delete"
            :checked="archivePrefsShown.autoDeleteAfter7Days"
            :disabled="archivePrefsBusy||!!archivePrefs?.pending"
            @change="setArchivePref('autoDeleteAfter7Days',($event.target as HTMLInputElement).checked)">
          Автоудаление из архива через 7 дней
        </label>
        <p class="muted">По умолчанию обе опции включены. Отключение архива
          не удаляет уже архивированные файлы. При отключённом архиве
          удаление активного файла будет прямым и необратимым после подтверждения.</p>
        <p class="muted">Срок файла и ограничения задания всегда имеют приоритет.
          Серверные разрешения архива и физической очистки независимы от этих переключателей.</p>
        <p v-if="!archivePrefsConfirmed" data-testid="browser-pref-unconfirmed" class="muted">
          Настройки не подтверждены сервером: опасные действия недоступны до синхронизации.</p>
        <p v-if="archivePrefsNotice" data-testid="browser-pref-status" role="status">
          {{ archivePrefsNotice }}</p>
        <div class="browser-archive-pref-actions">
          <button type="button" data-testid="browser-pref-sync"
            :disabled="archivePrefsBusy||!activeSession.online"
            @click="syncArchivePrefState">Подтвердить настройки на сервере</button>
          <button v-if="archivePrefsConflict" type="button"
            data-testid="browser-pref-use-server"
            :disabled="archivePrefsBusy||!activeSession.online"
            @click="acceptServerArchivePrefs">Принять настройки сервера</button>
        </div>
        <div v-if="browserSettingsOpen" class="browser-settings-footer">
          <button type="button" @click="closeBrowserSettings">Готово</button>
        </div>
      </section>
      <p v-if="archiveTab==='archive'" class="muted">
        Файлы остаются зашифрованными до подтверждённого окончательного
        удаления. Архив не продлевает TTL.
        {{ archiveCleanupEnabled?'Семидневная очистка разрешена оператором.':
          'Автоматическая очистка выключена до независимой приёмки GC.' }}
      </p>
      <div v-if="archivePending" data-testid="browser-archive-pending"
        class="browser-archive-pending">
        <p role="status">Есть неподтверждённая подписанная операция архива:
          {{ archivePending.action==='archive'?'Архивирование'
            :archivePending.action==='restore'?'Восстановление':'Окончательное удаление' }}
          файла {{ archivePending.assetId.slice(0,8) }}.
          Не создавайте новую операцию, пока сервер не ответит.</p>
        <button type="button" data-testid="browser-archive-retry"
          :disabled="archiveBusy||!archiveWriteEnabled||!activeSession.online"
          @click="retryArchivePending">Повторить исходный запрос</button>
        <button type="button" data-testid="browser-archive-inspect"
          :disabled="archiveBusy||!activeSession.online"
          @click="inspectArchivePending">Проверить результат на сервере</button>
        <div v-if="archiveInspection?.status==='obsolete'"
          data-testid="browser-archive-obsolete">
          <p>Серверная ревизия {{ archiveInspection.currentRevision }}
            уже новее исходной команды. После повторной проверки можно
            снять только эту устаревшую команду; она не может изменить файл.</p>
          <button type="button" data-testid="browser-archive-discard"
            :disabled="archiveBusy||!activeSession.online"
            @click="discardArchiveObsolete">Снять устаревший запрос</button>
        </div>
        <p v-if="archiveInspection?.status==='unresolved'" role="status">
          Сервер пока не доказал, что операция отменена или выполнена.
          Оставляем подписанный запрос в зашифрованной очереди.</p>
      </div>
      <p v-if="archivePendingError" role="alert">{{ archivePendingError }}</p>
      <p v-if="archiveNotice" role="status" data-testid="browser-archive-status">
        {{ archiveNotice }}</p>
      <nav class="browser-filters" aria-label="Тип файла">
        <button v-for="tab in (['all','photo','video','audio'] as const)" :key="tab"
          type="button" :aria-pressed="filter===tab"
          :class="{selected:filter===tab}" :data-testid="'browser-filter-'+tab"
          @click="filter=tab">
          {{ tab==='all'?'Все':tab==='photo'?'Фото':tab==='video'?'Видео':'Аудио' }}
        </button>
      </nav>
      <div class="browser-toolbar">
        <label class="browser-search">
          <span class="browser-sr-only">Приватный поиск по ID, имени, описанию, категории или тегам</span>
          <input v-model="search" type="search" autocomplete="off"
            maxlength="160" spellcheck="false"
            placeholder="ID, название, описание, категория, тег"
            data-testid="browser-search">
        </label>
        <label v-if="archiveTab==='all'">
          <span class="browser-sr-only">Область поиска по загруженным файлам</span>
          <select :value="searchFolderScope"
            data-testid="browser-search-folder-scope"
            @change="setSearchFolderScope(($event.target as HTMLSelectElement).value as SearchFolderScope)">
            <option value="current">Текущая папка</option>
            <option value="selected" :disabled="!allFolders.length">Выбранная папка</option>
            <option value="all">Все папки (загруженные файлы)</option>
          </select>
        </label>
        <label v-if="archiveTab==='all'&&searchFolderScope==='selected'"
          for="browser-search-folder-target">
          <span class="browser-sr-only">Выберите папку, в которой искать</span>
          <select id="browser-search-folder-target" v-model="searchSelectedFolder"
            data-testid="browser-search-folder-target">
            <option v-for="folder in importFolderOptions" :key="folder.id"
              :value="folder.id">{{ folder.label }}</option>
          </select>
        </label>
        <button v-if="archiveTab==='all'&&normalizePrivateSearch(search).length>=2"
          type="button" data-testid="browser-private-search-expand"
          :disabled="busy||privateExpansionBusy||privateSearchExpanded
            ||!activeSession.online||!photoCursor&&!mediaCursor
              &&items.length===0"
          @click="expandPrivateSearch">
          {{ privateExpansionBusy?'Загружаем расширенную выборку…'
            :privateSearchExpanded?'Расширенная проверка включена'
            :'Проверить больше файлов (до 1000)' }}
        </button>
        <label>
          <span class="browser-sr-only">Сортировка</span>
          <select v-model="sort" data-testid="browser-sort">
            <option value="newest">Новые сначала</option>
            <option value="oldest">Старые сначала</option>
            <option value="name">По имени (NAME-ID)</option>
            <option value="expiry">Ближайшее удаление</option>
            <option value="size-largest">Размер: большие</option>
            <option value="size-smallest">Размер: маленькие</option>
          </select>
        </label>

        <button type="button" :disabled="busy" @click="refresh">Обновить</button>
      </div>
      <p class="muted" data-testid="browser-summary">
        {{ visible.length }} файлов в загруженном каталоге
        · {{ pendingCount }} локальных не подтверждены облаком
      </p>
      <p class="muted">Поиск по ID мгновенный. Имена, описания, категории и теги
        ищутся только после расшифровки на этом устройстве. Поисковый запрос и
        незашифрованные метаданные не передаются серверу и не сохраняются в индексе.
        Все папки — только загруженные записи. Расширенная проверка запускается
        отдельно, ограничена 500 фото + 500 медиа из авторизованных индексов,
        не обещает поиск по всему аккаунту и не сохраняет приватный индекс.
        При сортировке по размеру файлы с неизвестным размером идут последними.</p>
      <p v-if="privateExpansionStatus||privateExpansionBusy" class="muted"
        data-testid="browser-expanded-search-status" role="status">
        {{ privateExpansionBusy
          ?'Получаем только непрозрачные ID. Названия файлов и запрос серверу не передаются.'
          :privateExpansionStatus }}
      </p>
      <p v-if="search.trim()" data-testid="browser-private-search-status"
        role="status" class="muted">
        <template v-if="normalizePrivateSearch(search).length<2">
          Для поиска по приватным полям введите хотя бы 2 символа; поиск по ID уже доступен.
        </template>
        <template v-else-if="privateSearchBusy">
          Идёт проверка зашифрованных метаданных на устройстве…
          <span v-if="privateSearchExpanded">
            Обработано {{ privateSearchProgress }}
            из {{ Math.min(searchScope.length,1000) }} выбранных файлов.
          </span>
        </template>
        <template v-else-if="privateSearchError">{{ privateSearchError }}</template>
        <template v-else-if="privateSearchResult?.query===normalizePrivateSearch(search)">
          Проверено {{ privateSearchResult.scanned }} из {{ privateSearchResult.total }}
          загруженных файлов.
          <span v-if="privateSearchResult.failed||privateSearchResult.skipped||privateSearchUnscanned">
            Результат неполный: {{ privateSearchResult.failed }} ошибок,
            {{ privateSearchResult.skipped }} недоступны или истекли,
            {{ privateSearchUnscanned }} за пределом проверки
            ({{ privateSearchExpanded?'1000':'200' }} за поиск).
          </span>
          <span v-else>Все загруженные файлы проверены.</span>
        </template>
      </p>
      <div class="browser-batch-toolbar"
        v-if="selectionMode&&folderReady&&!folderError"
        data-testid="browser-selection-toolbar">
        <strong data-testid="browser-selection-count">Выбрано: {{selectedKeys.length}}</strong>
        <button type="button" data-testid="browser-selection-cancel"
          @click="cancelSelectionMode">Отмена</button>
        <div class="browser-batch-actions-root">
          <button type="button" data-testid="browser-selection-actions"
            :aria-expanded="bulkActionsOpen" aria-haspopup="dialog"
            @click="bulkActionsOpen=!bulkActionsOpen">Действия</button>
          <div v-if="bulkActionsOpen" class="browser-batch-actions-panel"
            data-testid="browser-selection-menu" role="dialog"
            aria-label="Массовые действия"
            @keydown.esc.stop.prevent="closeBulkActions">
            <button type="button" :disabled="folderBusy||!visible.length"
              @click="selectVisible">Выбрать всё на странице</button>
            <button type="button" :disabled="!selectedKeys.length"
              @click="selectedKeys=[]">Снять выделение</button>
        <label v-if="selectedKeys.length&&archiveTab==='all'">
          Назначение
          <select v-model="bulkDestination" :disabled="folderBusy"
            data-testid="browser-bulk-destination">
            <option value="">Мои файлы</option>
            <option v-for="folder in allFolders" :key="folder.id"
              :value="folder.id">{{ folder.name }}</option>
          </select>
        </label>
        <button v-if="selectedKeys.length&&archiveTab==='all'" type="button"
          :disabled="folderBusy" @click="moveSelected">Переместить выбранные
          ({{ selectedKeys.length }})</button>
        <button v-if="selectedKeys.length&&archiveTab==='all'" type="button"
          data-testid="browser-bulk-archive"
          :disabled="archiveBusy||busy||!activeSession.online||!archiveWriteEnabled||!archivePrefsConfirmed||!!archivePending"
          @click="runArchiveBatch(archivePrefsShown.useArchive?'archive':'delete')">
          {{ archivePrefsShown.useArchive?'В архив выбранные':'Удалить окончательно выбранные' }}
          ({{ selectedKeys.length }})</button>
        <template v-if="selectedKeys.length&&archiveTab==='archive'">
          <button type="button" data-testid="browser-bulk-restore"
            :disabled="archiveBusy||busy||!activeSession.online||!archiveWriteEnabled||!!archivePending"
            @click="runArchiveBatch('restore')">Восстановить выбранные
            ({{ selectedKeys.length }})</button>
          <button type="button" data-testid="browser-bulk-delete"
            :disabled="archiveBusy||busy||!activeSession.online||!archiveWriteEnabled||!!archivePending"
            @click="runArchiveBatch('delete')">Удалить окончательно выбранные
            ({{ selectedKeys.length }})</button>
        </template>
          </div>
        </div>
      </div>
      <p v-if="archiveBatchNotice" data-testid="browser-bulk-status"
        role="status">{{ archiveBatchNotice }}</p>
      <p v-if="archiveBusy&&archiveBatchProgress" class="muted"
        data-testid="browser-bulk-progress">
        Подтверждено {{ archiveBatchProgress }} операций.
      </p>
      <section v-if="view==='tree'&&archiveTab==='all'&&folderReady&&!folderError"
        class="browser-tree-navigation" data-testid="browser-tree-navigation"
        aria-label="Дерево папок">
        <button type="button" class="browser-tree-root"
          data-testid="browser-tree-root" :aria-current="selectedFolder===null?'location':undefined"
          @click="selectTreeFolder(null)">Мои файлы</button>
        <div v-for="node in treeNodes" :key="node.id" class="browser-tree-node"
          :data-testid="'browser-tree-folder-'+node.id"
          :style="{paddingLeft:(Math.min(node.depth,10)*15+8)+'px'}">
          <button type="button" class="browser-tree-expand"
            :disabled="node.children===0" :aria-label="'Раскрыть '+node.name"
            :aria-expanded="node.children?treeExpanded.includes(node.id):undefined"
            @click="toggleTreeFolder(node.id)">
            {{node.children?(treeExpanded.includes(node.id)?'▾':'▸'):'·'}}
          </button>
          <button type="button" class="browser-tree-select"
            :aria-current="selectedFolder===node.id?'location':undefined"
            @click="selectTreeFolder(node.id)">
            <span aria-hidden="true">▣</span> {{node.name}}
          </button>
        </div>
        <p class="muted">Дерево содержит только зашифрованные пользовательские папки.
          Файлы ниже относятся к выбранной папке.</p>
      </section>
      <div :class="['browser-items',view==='grid'?'browser-grid':'browser-list']"
        data-testid="browser-catalog">
        <div v-for="item in visible" :key="item.key"
          :class="['browser-item', item.source==='photo'?'photo-row':'']"
          :data-testid="'browser-row-'+item.key">
          <label v-if="selectionMode&&folderReady&&!folderError
              &&(archiveTab==='all'||archivedByKey.get(item.key)?.state==='archived')"
            class="browser-item-select">
            <input type="checkbox" :checked="selectedKeys.includes(item.key)"
              :aria-label="'Выбрать файл '+item.id"
              @change="toggleItem(item.key,($event.target as HTMLInputElement).checked)">
          </label>
          <div class="browser-item-kind" aria-hidden="true">
            <img v-if="item.type==='photo'&&folderThumbnailUrls[item.key]"
              :src="folderThumbnailUrls[item.key]" alt="" decoding="async"
              data-testid="browser-file-thumb">
            <template v-else>{{ item.type==='photo'?'▧':item.type==='video'?'▷':'♫' }}</template>
          </div>
          <div class="browser-item-detail">
            <strong>{{ item.id.slice(0,8) }}</strong>
            <small>{{ item.type==='photo'?'Фото':item.type==='video'?'Видео':'Аудио' }}
              · {{ item.local?'На устройстве':'Только в облаке' }}
              <template v-if="item.cloud"> · Подтверждено в облаке</template>
            </small>
            <small v-if="item.state">
              Очередь: {{ item.state }}
            </small>
            <small data-testid="browser-item-retention">{{ retentionLabel(item.expiresAt) }}</small>
            <small>{{ catalogSizeLabel(item.bytes) }}</small>
            <small v-if="archiveTab==='all'&&search.trim()
              &&(searchFolderScope==='all'||searchFolderScope==='selected')"
              data-testid="browser-search-result-folder">
              Папка: {{ catalogFolderLabel(item) }}
            </small>
          </div>
          <div class="browser-file-menu-root" :data-testid="'browser-file-menu-'+item.key">
            <button type="button" class="browser-file-menu-toggle"
              data-testid="browser-file-menu-toggle"
              :aria-label="'Действия с файлом '+item.id"
              :aria-expanded="fileMenuKey===item.key"
              aria-haspopup="dialog" @click.stop="toggleFileMenu(item.key)">
              <span aria-hidden="true">•••</span>
            </button>
            <div v-if="fileMenuKey===item.key"
              class="browser-item-actions browser-file-menu-panel"
              :aria-label="'Действия с файлом '+item.id"
              role="dialog" data-testid="browser-file-menu-panel"
              @keydown.esc.stop.prevent="fileMenuEscape(item.key)">
            <label v-if="archiveTab==='all'&&folderReady&&!folderError"
              class="browser-file-move">
              <span>Папка</span>
              <select :value="folderWorkspace.placements[item.key]??''"
                :disabled="folderBusy||busy" :aria-label="'Папка файла '+item.id"
                @change="changeItemFolder(item,$event);closeFileMenu()">
                <option value="">Мои файлы</option>
                <option v-for="folder in allFolders" :key="folder.id"
                  :value="folder.id">{{ folder.name }}</option>
              </select>
            </label>
            <button v-if="archiveTab==='all'&&item.cloud&&archivePrefsShown.useArchive"
              type="button"
              :disabled="archiveBusy||busy||!activeSession.online||!archiveWriteEnabled||!archivePrefsConfirmed"
              :aria-label="'Архивировать файл '+item.id"
              @click="archiveAction(item,'archive');closeFileMenu()">В архив</button>
            <button v-if="archiveTab==='all'&&item.cloud&&!archivePrefsShown.useArchive"
              type="button"
              :disabled="archiveBusy||busy||!activeSession.online||!archiveWriteEnabled||!archivePrefsConfirmed"
              :aria-label="'Запросить прямое удаление файла '+item.id"
              @click="archiveAction(item,'delete');closeFileMenu()">Удалить окончательно</button>
            <template v-if="archiveTab==='archive'&&archivedByKey.get(item.key)?.state==='archived'">
              <button type="button" :disabled="archiveBusy||!activeSession.online||!archiveWriteEnabled"
                :aria-label="'Восстановить файл '+item.id"
                @click="archiveAction(item,'restore');closeFileMenu()">Восстановить</button>
              <button type="button" :disabled="archiveBusy||!activeSession.online||!archiveWriteEnabled"
                :aria-label="'Запросить удаление файла '+item.id"
                @click="archiveAction(item,'delete');closeFileMenu()">Удалить окончательно</button>
            </template>
            <span v-if="archivedByKey.get(item.key)?.state==='deleting'">
              Удаление ожидает подтверждения GC:
              {{ archivedByKey.get(item.key)?.physicalStatus }}</span>
            <button v-if="item.source==='photo'" type="button"
              :disabled="!item.local"
              :aria-label="'Поделиться файлом '+item.id"
              data-testid="browser-photo-share-action"
              @click="openPhotoShare(item)">
              {{item.local?'Поделиться':'Поделиться (требуется локальная копия)'}}
            </button>
            <button v-if="item.source==='media'" type="button"
              :disabled="!item.local"
              :aria-label="'Поделиться файлом '+item.id"
              data-testid="browser-media-share-action"
              @click="openMediaShare(item)">
              {{item.local?'Поделиться':'Поделиться (требуется локальная копия)'}}
            </button>
            <RouterLink :to="{name:'browser-viewer',params:{protocol:item.source,id:item.id}}"
              :aria-label="'Полный просмотр файла '+item.id"
              @click="preserveViewerOrigin(item,$event)">Открыть файл</RouterLink>
            <RouterLink v-if="canEditViaPrivateCopy(item)"
              :to="{name:'browser-editor',
                params:{protocol:'media',id:item.id},query:{tab:'info'}}"
              :aria-label="'Редактировать личные метаданные файла '+item.id+' (новая копия)'"
              @click="preserveViewerOrigin(item,$event)">
              Изменить имя, теги и категорию (новая зашифрованная копия)
            </RouterLink>
            <button v-if="item.local" type="button" :disabled="previewBusy||busy"
              :aria-label="item.source==='photo'?'Открыть':'Открыть файл '+item.id"
              @click="openItem(item);closeFileMenu()">Быстрый просмотр</button>
            <button v-if="item.cloud" type="button" :disabled="previewBusy||busy"
              aria-label="Проверить из облака"
              @click="openItem(item,true);closeFileMenu()">Проверить из облака</button>
            </div>
          </div>
        </div>
      </div>
      <!-- One live list of folders, teleported ABOVE files when preferred,
           or displayed BELOW files when disabled. No duplicate edit/ACL UI. -->
      <Teleport to="#browser-folder-cards-top" :disabled="!foldersFirst">
        <div class="browser-folder-list">
          <div v-for="folder in folders" :key="folder.id" class="browser-folder-item"
            :data-testid="'browser-folder-'+folder.id">
            <button type="button" class="browser-folder-open"
              :aria-label="folder.name" @click="selectedFolder=folder.id">
              <span class="browser-folder-cover"
                :class="{'is-empty':folderLoadedRows(folder.id).length===0}"
                aria-hidden="true">
                <template v-if="folderLoadedRows(folder.id).length">
                  <span v-for="index in 4" :key="index" class="browser-folder-cover-cell"
                    :class="{'is-blank':!folderLoadedRows(folder.id)[index-1]}">
                    <img v-if="folderLoadedRows(folder.id)[index-1]
                        &&folderThumbnailUrls[folderLoadedRows(folder.id)[index-1]!.key]"
                      :src="folderThumbnailUrls[folderLoadedRows(folder.id)[index-1]!.key]"
                      alt="" decoding="async" data-testid="browser-folder-thumb">
                    <template v-else>{{ folderLoadedRows(folder.id)[index-1]
                      ?folderCoverSymbol(folderLoadedRows(folder.id)[index-1]!):'' }}</template>
                  </span>
                </template>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.6"><path d="M3 7h6l2 2h10v11H3z"/>
                  <path d="M3 7V5h7l2 2"/></svg>
                <span class="browser-folder-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="1.8"><path d="M3 7h6l2 2h10v11H3z"/></svg>
                </span>
              </span>
              <span class="browser-folder-copy">
                <strong>{{ folder.name }}</strong>
                <small>{{ folderLoadedCount(folder.id) }} файлов в загруженном каталоге</small>
              </span>
            </button>
            <div class="browser-folder-menu-root"
              :data-testid="'browser-folder-menu-'+folder.id">
              <button type="button" class="browser-folder-menu-toggle"
                data-testid="browser-folder-menu-toggle"
                :aria-label="'Действия с папкой '+folder.name"
                :aria-expanded="folderMenuId===folder.id"
                aria-haspopup="dialog" @click.stop="toggleFolderMenu(folder.id)">
                <span aria-hidden="true">•••</span>
              </button>
              <div v-if="folderMenuId===folder.id"
                class="browser-folder-menu-panel" role="dialog"
                data-testid="browser-folder-menu-panel"
                :aria-label="'Действия с папкой '+folder.name"
                @keydown.esc.stop.prevent="folderMenuEscape">
                <button type="button" :disabled="folderBusy"
                  :aria-label="'Переименовать '+folder.name"
                  @click="openRename(folder.id,folder.name);closeFileMenu()">Переименовать</button>
            <label class="browser-folder-parent">
              <span>В</span>
              <select :value="folder.parentId??''" :disabled="folderBusy"
                :aria-label="'Переместить папку '+folder.name"
                @change="changeFolderParent(folder.id,$event);closeFileMenu()">
                <option value="">Корень</option>
                <option v-for="candidate in validFolderMoveTargets(folder.id)"
                  :key="candidate.id" :value="candidate.id">{{ candidate.name }}</option>
              </select>
            </label>
                <button type="button" :disabled="folderBusy"
                  :aria-label="'Удалить пустую папку '+folder.name"
                  @click="deleteEmptyFolder(folder.id);closeFileMenu()">Удалить</button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
      <p v-if="!visible.length&&folderReady" class="muted">Нет файлов для выбранного фильтра или папки.</p>
      <button v-if="archiveTab==='archive'&&archiveCursor" type="button"
        :disabled="archiveBusy||busy" @click="loadArchiveMore">
        Ещё записи архива</button>
      <p v-if="archiveTab==='all'" class="muted">
        {{ archiveWriteEnabled
          ?'Архив доступен только для собственных файлов без действующих/исторических передач и связей с заданиями.'
          :'Операции архива отключены сервером до приёмки.' }}
        {{ archiveCleanupEnabled
          ?'Серверная семидневная очистка разрешена оператором.'
          :'Автоудаление из архива пока отключено.' }}
      </p>
      <button v-if="photoCursor||mediaCursor" type="button"
        :disabled="busy" @click="more">Загрузить ещё</button>
      <div class="action-row">
        <button type="button" :disabled="busy" @click="sync">Синхронизировать</button>
      </div>
      <div v-if="selectedUrl" class="foundation-card browser-preview"
        data-testid="browser-preview">
        <h2>{{ selectedName }}</h2>
        <img v-if="selectedType==='photo'" :src="selectedUrl"
          alt="Личный снимок" class="decrypted-preview">
        <video v-else-if="selectedType==='video'" :src="selectedUrl"
          controls playsinline preload="metadata" class="decrypted-preview"/>
        <audio v-else-if="selectedType==='audio'" :src="selectedUrl"
          controls preload="metadata"/>
        <p v-if="selectedDescription">{{ selectedDescription }}</p>
        <p v-if="selectedCaptured">Дата: {{ new Date(selectedCaptured).toLocaleString('ru-RU') }}</p>
        <p v-if="selectedCategory">Категория: {{ selectedCategory }}</p>
        <p v-if="selectedTags.length">Теги: {{ selectedTags.join(', ') }}</p>
        <p v-if="selectedGps">GPS: {{ selectedGps.latitude }}, {{ selectedGps.longitude }} · точность ±{{ Math.round(selectedGps.accuracyMeters) }} м</p>
        <p v-if="selectedExpiry">Хранение до {{ new Date(selectedExpiry).toLocaleDateString('ru-RU') }}</p>
        <p class="muted">Файл расшифрован на этом устройстве. Экспорт в системную галерею не выполнялся.</p>
        <button type="button" @click="revokePreview">Закрыть просмотр</button>
      </div>
      <section class="browser-operations" data-testid="browser-import-panel">
        <h2>Импорт и операции</h2>
        <p class="muted">Загрузка, выдача доступа и версии используют действующий защищённый pipeline.</p>
        <div v-if="uploadSheetOpen" class="browser-upload-backdrop"
          data-testid="browser-import-backdrop" @click="closeUploadPanel"></div>
        <div v-show="uploadSheetOpen" class="browser-upload-sheet"
          :class="{open:uploadSheetOpen}"
          data-testid="browser-import-sheet"
          :role="uploadSheetOpen?'dialog':undefined"
          :aria-modal="uploadSheetOpen?'true':undefined"
          :aria-label="uploadSheetOpen?'Загрузить файлы':undefined"
          @keydown="uploadSheetKeydown">
          <header v-if="uploadSheetOpen" class="browser-upload-heading">
            <strong>Загрузить файлы</strong>
            <button type="button" data-testid="browser-import-sheet-close"
              aria-label="Закрыть загрузчик" @click="closeUploadPanel">
              Закрыть</button>
          </header>
          <MediaImportPanel
            :destination-folders="importFolderOptions"
            :default-folder-id="selectedFolder"
            :share-embedded="shareMediaId===null"
            @media-imported="placeImportedMedia"
            @catalog-change="refresh"/>
        </div>
        <SharePanel v-if="sharePhotoId===null"
          :local-photos="localPhotos" @open-photo="showReceived"/>
      </section>
      <div v-if="sharePhotoId" class="browser-share-backdrop"
        data-testid="browser-photo-share-backdrop" @click="closePhotoShare"></div>
      <section v-if="sharePhotoId" class="browser-share-sheet"
        data-testid="browser-photo-share-sheet" role="dialog"
        aria-modal="true" aria-label="Поделиться фотографией"
        @keydown="fileShareKeydown">
        <header class="browser-share-heading">
          <strong>Поделиться фотографией</strong>
          <button type="button" data-testid="browser-photo-share-close"
            aria-label="Закрыть обмен" @click="closePhotoShare">Закрыть</button>
        </header>
        <p class="muted">
          Передача доступна только после подтверждения облака и сверки ключа получателя.
        </p>
        <SharePanel
          :local-photos="localPhotos.filter(photo=>photo.photoId===sharePhotoId)"
          :selected-photo-id="sharePhotoId"
          @open-photo="showReceived"/>
      </section>
      <div v-if="shareMediaId" class="browser-share-backdrop"
        data-testid="browser-media-share-backdrop" @click="closePhotoShare"></div>
      <section v-if="shareMediaId" class="browser-share-sheet"
        data-testid="browser-media-share-sheet" role="dialog"
        aria-modal="true" aria-label="Поделиться файлом"
        @keydown="fileShareKeydown">
        <header class="browser-share-heading">
          <strong>Поделиться файлом</strong>
          <button type="button" data-testid="browser-media-share-close"
            aria-label="Закрыть обмен" @click="closePhotoShare">Закрыть</button>
        </header>
        <p class="muted" data-testid="browser-media-share-selected">
          Выбран файл {{ shareMediaId.slice(0,8) }}.
          Передача возможна после подтверждения облака и независимой сверки ключа.
          Полный доступ к оригиналу и Safe-копия — разные разрешения.
        </p>
        <MediaSharePanel
          :local-media="localMedia.filter(media=>media.mediaId===shareMediaId)"
          :selected-media-id="shareMediaId"/>
      </section>
    </template>
    <p v-if="status" role="status" class="status-text">{{ status }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
