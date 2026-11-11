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
const emit=defineEmits<{(event:'catalog-change'):void}>()
const local=ref<StoredMedia[]>([])
const cloud=ref<CloudMedia[]>([])
const cursor=ref<string|null>(null)
const selectedUrl=ref('')
const metadata=ref<MediaMetadata|null>(null)
const busy=ref(false)
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
  const session=activeSession.value
  if(!session){local.value=[];cloud.value=[];cursor.value=null;return}
  const own=await listLocalMedia()
  if(activeSession.value!==session)return
  local.value=own
  if(session.online){
    try{
      const result=await listCloudMedia()
      if(activeSession.value!==session)return
      cloud.value=result.items;cursor.value=result.nextCursor
    }catch(e){
      if(activeSession.value===session)error.value=explanation(e)
    }
  }else{cloud.value=[];cursor.value=null}
}
async function chooseFile(event:Event):Promise<void>{
  const element=event.target as HTMLInputElement
  const selected=element.files?.item(0)
  element.value=''
  if(!selected||busy.value)return
  busy.value=true;notice.value='';error.value=''
  try{
    await enqueueEncryptedMedia(selected,undefined,{
      category:privateCategory.value,description:privateDescription.value,
      gps:privateGps.value,tags:parseRulesCsv(privateTags.value,12,48),
    })
    await refresh()
    notice.value='Файл зашифрован и сохранён на устройстве. Синхронизация будет подтверждена отдельно.'
    emit('catalog-change')
  }catch(e){error.value=explanation(e)}
  finally{busy.value=false}
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
  if(!cursor.value||busy.value)return
  const session=activeSession.value
  busy.value=true
  try{
    const page=await listCloudMedia(cursor.value)
    if(activeSession.value!==session)return
    cloud.value.push(...page.items);cursor.value=page.nextCursor
  }catch(e){error.value=explanation(e)}
  finally{busy.value=false}
}
watch(activeSession,(next,previous)=>{
  // Changing connectivity or refreshing auth replaces the Session object.
  // Never erase a user's typed private import metadata on the SAME device:
  // this form is Local-First and may be completed fully offline.
  const switched=next?.accountId!==previous?.accountId
    ||next?.deviceId!==previous?.deviceId
  if(switched){
    gpsRequest++;gpsLoading.value=false
    privateGps.value=null;gpsError.value=''
    privateCategory.value='';privateDescription.value='';privateTags.value=''
    clearPreview()
    local.value=[];cloud.value=[];cursor.value=null
  }
  void refresh()
})
onMounted(()=>{detach=attachMediaOutboxLifecycle();void refresh()})
onUnmounted(()=>{detach();clearPreview()})
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
    <div class="action-row">
      <label class="media-file-choice">
        Выбрать файл
        <input data-testid="media-import-file" type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/mp4,audio/mpeg,audio/webm,audio/wav,audio/x-wav,audio/aac,audio/ogg"
          :disabled="busy" @change="chooseFile">
      </label>
      <button type="button" :disabled="busy" @click="sync">Отправить медиа</button>
      <button type="button" :disabled="busy" @click="refresh">Обновить</button>
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
    <button v-if="cursor" type="button" :disabled="busy" @click="more">Ещё файлы</button>
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
