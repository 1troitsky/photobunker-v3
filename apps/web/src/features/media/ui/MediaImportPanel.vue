<script setup lang="ts">
import { onMounted,onUnmounted,ref,watch } from 'vue'
import { activeSession } from '../../identity/application/session'
import MediaSharePanel from './MediaSharePanel.vue'
import MediaVersionPanel from './MediaVersionPanel.vue'
import {
  enqueueEncryptedMedia,listLocalMedia,listCloudMedia,
  readLocalMedia,readCloudMedia,synchronizeMedia,
  attachMediaOutboxLifecycle,
} from '../application/media-outbox'
import type {
  CloudMedia,StoredMedia,
} from '../application/media-outbox'
import type { MediaMetadata } from '../domain/media-crypto'
import type { GPSFix } from '../../photo-sync/domain/capture-metadata'
import { parseRulesCsv } from '../../assignments/domain/advanced-rules'
import { enqueueEncryptedImportBatch } from '../application/encrypted-import-batch'
import type { MediaPrivateFields } from '../domain/media-crypto'
import { appendAuthenticatedCatalogPage }
  from '../../browser/application/authenticated-catalog-page'
type DestinationFolder={id:string;label:string}
const props=withDefaults(defineProps<{
  destinationFolders?:DestinationFolder[];defaultFolderId?:string|null
}>(),{destinationFolders:()=>[],defaultFolderId:null})
const emit=defineEmits<{
  (event:'catalog-change'):void
  (event:'media-imported',data:{mediaIds:string[];folderId:string|null}):void
}>()
const targetFolder=ref(props.defaultFolderId??'')
watch(()=>props.defaultFolderId,folderId=>{targetFolder.value=folderId??''})
const local=ref<StoredMedia[]>([])
const cloud=ref<CloudMedia[]>([])
const cursor=ref<string|null>(null)
const selectedUrl=ref('')
const metadata=ref<MediaMetadata|null>(null)
const busy=ref(false)
const pagingBusy=ref(false)
let catalogEpoch=0
const privateCategory=ref('')
const privateDescription=ref('')
const privateTags=ref('')
const privateGps=ref<GPSFix|null>(null)
const gpsError=ref('')
const gpsLoading=ref(false)
let gpsRequest=0
async function obtainImportGps():Promise<void>{
  const session=activeSession.value
  if(!session||!navigator.geolocation){gpsError.value='media.gps_unavailable';return}
  const request=++gpsRequest
  gpsLoading.value=true;gpsError.value=''
  try{
    const position=await new Promise<GeolocationPosition>((resolve,reject)=>{
      navigator.geolocation.getCurrentPosition(resolve,reject,{
        enableHighAccuracy:true,maximumAge:0,timeout:12000,
      })
    })
    if(request!==gpsRequest||activeSession.value!==session)return
    privateGps.value={
      latitude:position.coords.latitude,longitude:position.coords.longitude,
      accuracyMeters:position.coords.accuracy,recordedAt:Math.round(position.timestamp),
    }
  }catch(e){if(request===gpsRequest)gpsError.value=e instanceof Error?e.message:'media.gps_unavailable'}
  finally{if(request===gpsRequest)gpsLoading.value=false}
}
const notice=ref('')
const error=ref('')
let detach:()=>void=()=>{}
function clearPreview():void{
  if(selectedUrl.value)URL.revokeObjectURL(selectedUrl.value)
  selectedUrl.value='';metadata.value=null
}
function explanation(e:unknown):string{
  return e instanceof Error?e.message:'media.unavailable'
}
async function refresh():Promise<void>{
  const token=++catalogEpoch
  const session=activeSession.value
  pagingBusy.value=false
  if(!session){local.value=[];cloud.value=[];cursor.value=null;return}
  try{
    const own=await listLocalMedia()
    if(activeSession.value!==session||token!==catalogEpoch)return
    local.value=own
    if(session.online&&(typeof navigator==='undefined'||navigator.onLine!==false)){
      try{
        const response=await listCloudMedia()
        if(activeSession.value!==session||token!==catalogEpoch)return
        const checked=appendAuthenticatedCatalogPage(
          [],response,null,(item:CloudMedia)=>item.mediaId)
        cloud.value=checked.items;cursor.value=checked.nextCursor
        error.value=''
      }catch(e){
        // Never replace earlier trusted entries/cursor with a failed or
        // malformed server page, even when the account stays unchanged.
        if(activeSession.value===session&&token===catalogEpoch)
          error.value=explanation(e)
      }
    }else{cloud.value=[];cursor.value=null}
  }catch(e){
    if(activeSession.value===session&&token===catalogEpoch)
      error.value=explanation(e)
  }
}
async function importFiles(files:readonly File[]):Promise<void>{
  if(files.length===0||busy.value)return
  const identity=activeSession.value
  const folderId=targetFolder.value||null
  busy.value=true;notice.value='';error.value=''
  try{
    if(folderId&&!props.destinationFolders.some(item=>item.id===folderId))
      throw Error('browser.folder_missing')
    // One snapshot for the entire selection: typed private values, GPS and
    // destination cannot drift between independently encrypted files.
    const metadata:MediaPrivateFields={
      category:privateCategory.value,description:privateDescription.value,
      gps:privateGps.value,tags:parseRulesCsv(privateTags.value,12,48),
    }
    const output=await enqueueEncryptedImportBatch(files,
      file=>enqueueEncryptedMedia(file,undefined,metadata),
      ()=>identity!==null&&identity===activeSession.value)
    if(identity!==activeSession.value)return
    // The per-file AES-GCM operation is durable already. A failed folder
    // placement must not roll back/delete successful encrypted originals.
    if(output.mediaIds.length){
      emit('media-imported',{mediaIds:output.mediaIds,folderId})
      // Durable AES-GCM outbox is already committed. Never block a second
      // selection on a secondary, potentially offline catalog refresh.
      void refresh()
    }
    const saved=output.mediaIds.length
    notice.value=saved===1&&files.length===1&&output.failed===0
      ?'Файл зашифрован и сохранён на устройстве. Синхронизация будет подтверждена отдельно.'
      :'Зашифровано на устройстве '+saved+' из '+files.length
        +' файлов. Отправка в облако подтверждается отдельно.'
    if(output.failed)
      error.value='Не удалось импортировать '+output.failed
        +' файлов. Уже зашифрованные оригиналы и очередь сохранены.'
  }catch(e){
    if(identity===activeSession.value)error.value=explanation(e)
  }finally{busy.value=false}
}
async function chooseFile(event:Event):Promise<void>{
  const element=event.target as HTMLInputElement
  const files=Array.from(element.files??[])
  element.value=''
  await importFiles(files)
}
function dropFiles(event:DragEvent):void{
  event.preventDefault()
  if(busy.value)return
  void importFiles(Array.from(event.dataTransfer?.files??[]))
}
async function sync():Promise<void>{
  if(busy.value)return
  busy.value=true;error.value='';notice.value=''
  try{
    await synchronizeMedia()
    await refresh()
    notice.value='Очередь проверена. Только статус «synced» подтверждён сервером.'
    emit('catalog-change')
  }catch(e){error.value=explanation(e)}
  finally{busy.value=false}
}
function previewReceived(blob:Blob,privateMetadata:MediaMetadata):void{
  clearPreview()
  selectedUrl.value=URL.createObjectURL(blob)
  metadata.value=privateMetadata
}
async function preview(id:string,source:'local'|'cloud'):Promise<void>{
  error.value='';busy.value=true
  try{
    const session=activeSession.value
    const result=source==='local'
      ?await readLocalMedia(id):await readCloudMedia(id)
    if(activeSession.value!==session)return
    clearPreview()
    selectedUrl.value=URL.createObjectURL(result.blob)
    metadata.value=result.metadata
  }catch(e){error.value=explanation(e)}
  finally{busy.value=false}
}
async function more():Promise<void>{
  const after=cursor.value,session=activeSession.value
  if(!after||!session?.online||busy.value||pagingBusy.value)return
  const token=++catalogEpoch
  pagingBusy.value=true
  error.value=''
  try{
    const response=await listCloudMedia(after)
    if(activeSession.value!==session||token!==catalogEpoch)return
    // Validate against the same cursor captured BEFORE the request.
    // A network response from a superseded refresh cannot append files.
    const checked=appendAuthenticatedCatalogPage(
      cloud.value,response,after,(item:CloudMedia)=>item.mediaId)
    cloud.value=checked.items;cursor.value=checked.nextCursor
  }catch(e){
    if(activeSession.value===session&&token===catalogEpoch)
      error.value=explanation(e)
  }finally{
    if(token===catalogEpoch)pagingBusy.value=false
  }
}
watch(activeSession,(next,previous)=>{
  ++catalogEpoch
  pagingBusy.value=false
  // Changing connectivity or refreshing auth replaces the Session object.
  // Never erase a user's typed private import metadata on the SAME device:
  // this form is Local-First and may be completed fully offline.
  const switched=next?.accountId!==previous?.accountId
    ||next?.deviceId!==previous?.deviceId
  if(switched){
    targetFolder.value=props.defaultFolderId??''
    gpsRequest++;gpsLoading.value=false
    privateGps.value=null;gpsError.value=''
    privateCategory.value='';privateDescription.value='';privateTags.value=''
    clearPreview()
    local.value=[];cloud.value=[];cursor.value=null
  }
  void refresh()
})
onMounted(()=>{detach=attachMediaOutboxLifecycle();void refresh()})
onUnmounted(()=>{++catalogEpoch;detach();clearPreview()})
</script>

<template>
  <section class="foundation-card media-import-p1">
    <h2>Импорт фото, видео и аудио · P1</h2>
    <p class="muted">
      Выбранный файл шифруется на устройстве блоками по 1 МиБ.
      Имя и формат находятся внутри зашифрованных метаданных.
      В облаке сохраняется только шифротекст.
    </p>
    <div class="foundation-card">
      <h3>Приватные метаданные импорта</h3>
      <label for="media-import-category">Категория</label>
      <input id="media-import-category" v-model="privateCategory" maxlength="64" autocomplete="off">
      <label for="media-import-description">Описание</label>
      <textarea id="media-import-description" v-model="privateDescription" maxlength="4000" rows="3"/>
      <label for="media-import-tags">Приватные теги (через запятую)</label>
      <input id="media-import-tags" v-model="privateTags" maxlength="600" autocomplete="off">
      <div class="action-row">
        <button type="button" :disabled="gpsLoading||busy" @click="obtainImportGps">Получить текущий GPS</button>
        <button v-if="privateGps" type="button" @click="privateGps=null">Очистить GPS</button>
      </div>
      <p v-if="privateGps" class="muted">GPS текущего устройства, не подтверждение места создания импортируемого файла.</p>
      <p v-if="gpsError" role="alert" class="error-text">{{ gpsError }}</p>
      <p class="muted">Значения шифруются вместе с файлом. После импорта нельзя выдать ключ заданию, если его свежие подписанные требования к метаданным не выполнены.</p>
    </div>
    <div class="foundation-card media-batch-drop" data-testid="media-import-dropzone"
      @dragover.prevent @drop.prevent="dropFiles">
      <label for="media-import-destination">Папка назначения</label>
      <select id="media-import-destination" v-model="targetFolder"
        data-testid="media-import-destination" :disabled="busy">
        <option value="">Мои файлы (корень)</option>
        <option v-for="folder in props.destinationFolders" :key="folder.id"
          :value="folder.id">{{ folder.label }}</option>
      </select>
      <p class="muted">Перетащите файлы сюда или выберите несколько с устройства.
        Папка и её название шифруются отдельно от самих файлов.</p>
      <div class="action-row">
        <label class="media-file-choice">
          Выбрать файлы
          <input data-testid="media-import-file" type="file" multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/mp4,audio/mpeg,audio/webm,audio/wav,audio/x-wav,audio/aac,audio/ogg"
            :disabled="busy" @change="chooseFile">
        </label>
        <button type="button" :disabled="busy" @click="sync">Отправить медиа</button>
        <button type="button" :disabled="busy" @click="refresh">Обновить</button>
      </div>
      <p class="muted">За один выбор: до 20 файлов, суммарно до 256 МиБ,
        максимум 128 МиБ на файл. Успешные файлы сохраняются отдельно,
        даже если следующий файл повреждён.</p>
    </div>
    <p class="muted">Предел одного файла на этом этапе: 128 МиБ. Офлайн-файлы остаются в зашифрованной очереди при сбое сети или исчерпании квоты Free.</p>
    <h3>Зашифровано на этом устройстве</h3>
    <p v-if="!local.length" class="muted">Нет импортированных файлов.</p>
    <div v-for="row in local" :key="row.key" class="photo-row">
      <div>
        <strong>{{ row.mediaType }} · {{ row.mediaId.slice(0,8) }}</strong>
        <small>{{ row.state }} · {{ row.plainBytes.toLocaleString('ru-RU') }} байт</small>
        <small v-if="row.lastError" class="muted">{{ row.lastError }}</small>
      </div>
      <button type="button" :disabled="busy" @click="preview(row.mediaId,'local')">Открыть</button>
    </div>
    <h3>Подтверждено в облаке</h3>
    <p v-if="!activeSession?.online" class="muted">Текущие облачные файлы без подтверждённой сессии неизвестны.</p>
    <p v-else-if="!cloud.length" class="muted">Нет подтверждённых файлов.</p>
    <div v-for="row in cloud" :key="row.mediaId" class="photo-row">
      <div>
        <strong>{{ row.mediaType }} · {{ row.mediaId.slice(0,8) }}</strong>
        <small>{{ row.plainBytes.toLocaleString('ru-RU') }} байт · до {{ new Date(row.expiresAt).toLocaleDateString('ru-RU') }}</small>
      </div>
      <button type="button" :disabled="busy" @click="preview(row.mediaId,'cloud')">Проверить из облака</button>
    </div>
    <button v-if="cursor" type="button" :disabled="busy||pagingBusy"
      data-testid="media-import-more" @click="more">Ещё файлы</button>
    <MediaSharePanel :local-media="local" @open-media="previewReceived"/>
    <MediaVersionPanel :local-media="local"/>
    <div v-if="selectedUrl&&metadata" class="foundation-card" data-testid="media-decrypted-preview">
      <h3>Расшифровано локально: {{ metadata.fileName }}</h3>
      <img v-if="metadata.mime.startsWith('image/')" :src="selectedUrl" alt="Личный файл" class="decrypted-preview">
      <video v-else-if="metadata.mime.startsWith('video/')" :src="selectedUrl" controls playsinline preload="metadata" class="decrypted-preview"/>
      <audio v-else-if="metadata.mime.startsWith('audio/')" :src="selectedUrl" controls preload="metadata"/>
      <p v-if="metadata.category" class="muted">Категория: {{ metadata.category }}</p>
      <p v-if="metadata.description" class="muted">Описание: {{ metadata.description }}</p>
      <p v-if="metadata.tags?.length" class="muted">Теги: {{ metadata.tags.join(', ') }}</p>
      <p v-if="metadata.gps" class="muted">GPS: {{ metadata.gps.latitude }}, {{ metadata.gps.longitude }} · ±{{ Math.round(metadata.gps.accuracyMeters) }} м</p>
      <p class="muted">Имя, формат и приватные поля расшифрованы из AES-GCM метаданных, не из серверного каталога.</p>
      <button type="button" @click="clearPreview">Закрыть</button>
    </div>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>

<style scoped>
.media-file-choice{display:inline-flex;flex-direction:column;gap:4px;cursor:pointer}
.media-file-choice input{max-width:220px}
.media-import-p1 video{max-width:100%}
.media-import-p1 audio{max-width:100%}
</style>
