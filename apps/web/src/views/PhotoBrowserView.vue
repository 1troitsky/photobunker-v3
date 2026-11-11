<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {RouterLink} from 'vue-router'
import SharePanel from '../features/sharing/SharePanel.vue'
import MediaImportPanel from '../features/media/ui/MediaImportPanel.vue'
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
import {buildCatalog,filterCatalog} from '../features/browser/application/catalog'
import {normalizePrivateSearch,searchPrivateMetadata}
  from '../features/browser/application/private-search'
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
const search=ref('')
// Search terms and decrypted match membership are VOLATILE: never persisted,
// synced or placed in a server query parameter.
const privateSearchResult=ref<PrivateSearchResult|null>(null)
const privateSearchBusy=ref(false)
const privateSearchError=ref('')
const privateSearchUnscanned=ref(0)
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
const createFolderOpen=ref(false)
const newFolderName=ref('')
const editingFolderId=ref<string|null>(null)
const editFolderName=ref('')
const selectedKeys=ref<string[]>([])
const bulkDestination=ref('')
const archiveTab=ref<'all'|'archive'>('all')
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
const allFolders=computed(()=>Object.values(folderWorkspace.value.folders)
  .sort((a,b)=>a.name.localeCompare(b.name,'ru')))

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
      mediaId:x.assetId,mediaType:x.mediaType!,plainBytes:x.plainBytes??0,
      expiresAt:x.expiresAt,
    })),
  ],
))
const searchScope=computed(()=>filterCatalog(items.value,{
  type:filter.value,query:'',sort:sort.value,
}).filter(item=>{
  const archived=archivedByKey.value.get(item.key)?.state
  if(archiveTab.value==='archive')return archived==='archived'||archived==='deleting'
  return archived!=='archived'&&archived!=='deleting'&&(!folderReady.value
    ||(folderWorkspace.value.placements[item.key]??null)===selectedFolder.value)
}))
const visible=computed(()=>filterCatalog(searchScope.value,{
  type:'all',query:search.value,sort:sort.value,
  privateMatches:privateSearchResult.value?.query===normalizePrivateSearch(search.value)
    ?privateSearchResult.value.matches:undefined,
}))
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
  const query=normalizePrivateSearch(search.value)
  const identity=activeSession.value
  if(!identity||query.length<2||query.length>160)return
  const rows=searchScope.value
  privateSearchUnscanned.value=Math.max(0,rows.length-200)
  privateSearchBusy.value=true
  privateSearchTimer=setTimeout(()=>{
    privateSearchTimer=null
    void searchPrivateMetadata(query,rows.slice(0,200),
      ()=>epoch===privateSearchEpoch&&activeSession.value===identity)
      .then(result=>{
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
  const ok=await changeFolders({kind:'add',id:crypto.randomUUID(),
    parentId:selectedFolder.value,name:newFolderName.value,at:Date.now()})
  if(ok){newFolderName.value='';createFolderOpen.value=false}
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
    if(cloudP.status==='fulfilled'){
      cloudPhotos.value=cloudP.value.items
      photoCursor.value=cloudP.value.nextCursor
    }
    if(cloudM.status==='fulfilled'){
      cloudMedia.value=cloudM.value.items
      mediaCursor.value=cloudM.value.nextCursor
    }
    if(archive.status==='fulfilled'){
      archiveEntries.value=archive.value.items
      archiveCursor.value=archive.value.nextCursor
      archiveWriteEnabled.value=archive.value.writeEnabled
      archiveCleanupEnabled.value=archive.value.autoCleanupEnabled
    }else{
      archiveNotice.value='Статус архива не проверен: '+reason(archive.reason)
    }
    if(cloudP.status==='rejected'||cloudM.status==='rejected')
      status.value='Не все облачные списки доступны. Локальные файлы сохранены.'
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
    if(photos.status==='fulfilled'&&photos.value){
      cloudPhotos.value=[...cloudPhotos.value,...photos.value.items]
      photoCursor.value=photos.value.nextCursor
    }
    if(media.status==='fulfilled'&&media.value){
      cloudMedia.value=[...cloudMedia.value,...media.value.items]
      mediaCursor.value=media.value.nextCursor
    }
    if(photos.status==='rejected'||media.status==='rejected')
      error.value='Не удалось загрузить часть облачного каталога.'
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
    editingFolderId.value=null
    createFolderOpen.value=false
    newFolderName.value=''
    editFolderName.value=''
    selectedKeys.value=[]
    bulkDestination.value=''
    folderNotice.value=''
    folderSyncStatus.value=''
    mergePlan.value=null
    mergeChoices.value={}
    mergeBackups.value=[]
    archiveTab.value='all'
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
watch([selectedFolder,filter,search,archiveTab],()=>{selectedKeys.value=[]})
watch([search,searchScope,activeSession],schedulePrivateSearch)
onMounted(()=>{
  schedulePrivateSearch()
  void loadFolders();void loadMergeBackups();void loadArchivePrefState()
  void refreshArchivePending();void refresh()
})
onUnmounted(()=>{
  ++generation;++folderEpoch;++folderSyncEpoch;++archivePrefsEpoch;++privateSearchEpoch
  if(privateSearchTimer!==null)clearTimeout(privateSearchTimer)
  privateSearchTimer=null
  privateSearchResult.value=null
  search.value=''
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
        <p class="subtitle">Файлы и локальная очередь · без ожидания облака</p>
      </div>
      <RouterLink to="/camera">Камера</RouterLink>
    </div>
    <div v-if="!activeSession" class="foundation-card">
      <p>Список файлов доступен после входа.</p>
      <RouterLink to="/settings">Открыть доступ</RouterLink>
    </div>
    <template v-else>
      <section class="browser-folders" data-testid="browser-folders">
        <div class="browser-folder-head">
          <div class="browser-breadcrumb" aria-label="Путь папки">
            <button type="button" :aria-current="selectedFolder===null?'location':undefined"
              @click="selectedFolder=null">Мои файлы</button>
            <template v-for="part in breadcrumb" :key="part.id">
              <span aria-hidden="true">/</span>
              <button type="button"
                :aria-current="selectedFolder===part.id?'location':undefined"
                @click="selectedFolder=part.id">{{ part.name }}</button>
            </template>
          </div>
          <button type="button" :disabled="!folderReady||!!folderError||folderBusy"
            @click="createFolderOpen=!createFolderOpen">Новая папка</button>
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
        <form v-if="createFolderOpen" class="browser-folder-form" @submit.prevent="createFolder">
          <label>Название папки
            <input v-model="newFolderName" maxlength="80" autocomplete="off"
              data-testid="browser-folder-name" required>
          </label>
          <button type="submit" :disabled="folderBusy">Создать</button>
          <button type="button" @click="createFolderOpen=false">Отмена</button>
        </form>
        <div class="browser-folder-list">
          <div v-for="folder in folders" :key="folder.id" class="browser-folder-item"
            :data-testid="'browser-folder-'+folder.id">
            <button type="button" class="browser-folder-open"
              @click="selectedFolder=folder.id">
              <span aria-hidden="true">▣</span> {{ folder.name }}
            </button>
            <button type="button" :disabled="folderBusy"
              :aria-label="'Переименовать '+folder.name"
              @click="openRename(folder.id,folder.name)">Переименовать</button>
            <label class="browser-folder-parent">
              <span>В</span>
              <select :value="folder.parentId??''" :disabled="folderBusy"
                :aria-label="'Переместить папку '+folder.name"
                @change="changeFolderParent(folder.id,$event)">
                <option value="">Корень</option>
                <option v-for="candidate in allFolders.filter(x=>x.id!==folder.id)"
                  :key="candidate.id" :value="candidate.id">{{ candidate.name }}</option>
              </select>
            </label>
            <button type="button" :disabled="folderBusy"
              :aria-label="'Удалить пустую папку '+folder.name"
              @click="deleteEmptyFolder(folder.id)">Удалить</button>
          </div>
        </div>
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
      <section class="browser-archive-preferences" data-testid="browser-archive-preferences">
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
      </section>
      <nav class="browser-archive-tabs" aria-label="Расположение файлов">
        <button type="button" data-testid="browser-tab-active"
          :aria-pressed="archiveTab==='all'" @click="archiveTab='all'">Каталог</button>
        <button type="button" data-testid="browser-tab-archive"
          :aria-pressed="archiveTab==='archive'" @click="archiveTab='archive'">Архив</button>
      </nav>
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
        <label>
          <span class="browser-sr-only">Сортировка</span>
          <select v-model="sort" data-testid="browser-sort">
            <option value="newest">Новые сначала</option>
            <option value="oldest">Старые сначала</option>
            <option value="expiry">Ближайшее удаление</option>
          </select>
        </label>
        <div class="browser-view-switch" aria-label="Вид каталога">
          <button type="button" :aria-pressed="view==='list'"
            @click="view='list'">Список</button>
          <button type="button" :aria-pressed="view==='grid'"
            @click="view='grid'">Сетка</button>
        </div>
        <button type="button" :disabled="busy" @click="refresh">Обновить</button>
      </div>
      <p class="muted" data-testid="browser-summary">
        {{ visible.length }} файлов в загруженном каталоге
        · {{ pendingCount }} локальных не подтверждены облаком
      </p>
      <p class="muted">Поиск по ID мгновенный. Имена, описания, категории и теги
        ищутся только после расшифровки на этом устройстве. Поисковый запрос и
        незашифрованные метаданные не передаются серверу и не сохраняются в индексе.</p>
      <p v-if="search.trim()" data-testid="browser-private-search-status"
        role="status" class="muted">
        <template v-if="normalizePrivateSearch(search).length<2">
          Для поиска по приватным полям введите хотя бы 2 символа; поиск по ID уже доступен.
        </template>
        <template v-else-if="privateSearchBusy">
          Идёт проверка зашифрованных метаданных загруженных файлов…
        </template>
        <template v-else-if="privateSearchError">{{ privateSearchError }}</template>
        <template v-else-if="privateSearchResult?.query===normalizePrivateSearch(search)">
          Проверено {{ privateSearchResult.scanned }} из {{ privateSearchResult.total }}
          загруженных файлов.
          <span v-if="privateSearchResult.failed||privateSearchResult.skipped||privateSearchUnscanned">
            Результат неполный: {{ privateSearchResult.failed }} ошибок,
            {{ privateSearchResult.skipped }} недоступны или истекли,
            {{ privateSearchUnscanned }} за пределом проверки (200 за поиск).
          </span>
          <span v-else>Все загруженные файлы проверены.</span>
        </template>
      </p>
      <div class="browser-batch-toolbar" v-if="folderReady&&!folderError">
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
      <p v-if="archiveBatchNotice" data-testid="browser-bulk-status"
        role="status">{{ archiveBatchNotice }}</p>
      <p v-if="archiveBusy&&archiveBatchProgress" class="muted"
        data-testid="browser-bulk-progress">
        Подтверждено {{ archiveBatchProgress }} операций.
      </p>
      <div :class="['browser-items',view==='grid'?'browser-grid':'browser-list']"
        data-testid="browser-catalog">
        <div v-for="item in visible" :key="item.key"
          :class="['browser-item', item.source==='photo'?'photo-row':'']"
          :data-testid="'browser-row-'+item.key">
          <label v-if="folderReady&&!folderError
              &&(archiveTab==='all'||archivedByKey.get(item.key)?.state==='archived')"
            class="browser-item-select">
            <input type="checkbox" :checked="selectedKeys.includes(item.key)"
              :aria-label="'Выбрать файл '+item.id"
              @change="toggleItem(item.key,($event.target as HTMLInputElement).checked)">
          </label>
          <div class="browser-item-kind" aria-hidden="true">
            {{ item.type==='photo'?'▧':item.type==='video'?'▷':'♫' }}
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
            <small>Хранение до {{ new Date(item.expiresAt).toLocaleDateString('ru-RU') }}</small>
          </div>
          <div class="browser-item-actions">
            <label v-if="archiveTab==='all'&&folderReady&&!folderError"
              class="browser-file-move">
              <span>Папка</span>
              <select :value="folderWorkspace.placements[item.key]??''"
                :disabled="folderBusy||busy" :aria-label="'Папка файла '+item.id"
                @change="changeItemFolder(item,$event)">
                <option value="">Мои файлы</option>
                <option v-for="folder in allFolders" :key="folder.id"
                  :value="folder.id">{{ folder.name }}</option>
              </select>
            </label>
            <button v-if="archiveTab==='all'&&item.cloud&&archivePrefsShown.useArchive"
              type="button"
              :disabled="archiveBusy||busy||!activeSession.online||!archiveWriteEnabled||!archivePrefsConfirmed"
              :aria-label="'Архивировать файл '+item.id"
              @click="archiveAction(item,'archive')">В архив</button>
            <button v-if="archiveTab==='all'&&item.cloud&&!archivePrefsShown.useArchive"
              type="button"
              :disabled="archiveBusy||busy||!activeSession.online||!archiveWriteEnabled||!archivePrefsConfirmed"
              :aria-label="'Запросить прямое удаление файла '+item.id"
              @click="archiveAction(item,'delete')">Удалить окончательно</button>
            <template v-if="archiveTab==='archive'&&archivedByKey.get(item.key)?.state==='archived'">
              <button type="button" :disabled="archiveBusy||!activeSession.online||!archiveWriteEnabled"
                :aria-label="'Восстановить файл '+item.id"
                @click="archiveAction(item,'restore')">Восстановить</button>
              <button type="button" :disabled="archiveBusy||!activeSession.online||!archiveWriteEnabled"
                :aria-label="'Запросить удаление файла '+item.id"
                @click="archiveAction(item,'delete')">Удалить окончательно</button>
            </template>
            <span v-if="archivedByKey.get(item.key)?.state==='deleting'">
              Удаление ожидает подтверждения GC:
              {{ archivedByKey.get(item.key)?.physicalStatus }}</span>
            <RouterLink :to="{name:'browser-viewer',params:{protocol:item.source,id:item.id}}"
              :aria-label="'Полный просмотр файла '+item.id">Просмотр</RouterLink>
            <button v-if="item.local" type="button" :disabled="previewBusy||busy"
              :aria-label="item.source==='photo'?'Открыть':'Открыть файл '+item.id"
              @click="openItem(item)">Открыть</button>
            <button v-if="item.cloud" type="button" :disabled="previewBusy||busy"
              aria-label="Проверить из облака"
              @click="openItem(item,true)">Проверить из облака</button>
          </div>
        </div>
      </div>
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
      <section class="browser-operations">
        <h2>Импорт и операции</h2>
        <p class="muted">Загрузка, выдача доступа и версии используют действующий защищённый pipeline.</p>
        <MediaImportPanel @catalog-change="refresh"/>
        <SharePanel :local-photos="localPhotos" @open-photo="showReceived"/>
      </section>
    </template>
    <p v-if="status" role="status" class="status-text">{{ status }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
