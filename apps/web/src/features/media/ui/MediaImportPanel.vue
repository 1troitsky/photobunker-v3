<script setup lang="ts">
import { onMounted,onUnmounted,ref,watch } from 'vue'
import { activeSession } from '../../identity/application/session'
import {
  enqueueEncryptedMedia,listLocalMedia,listCloudMedia,
  readLocalMedia,readCloudMedia,synchronizeMedia,
  attachMediaOutboxLifecycle,
} from '../application/media-outbox'
import type {
  CloudMedia,StoredMedia,
} from '../application/media-outbox'
import type { MediaMetadata } from '../domain/media-crypto'
const local=ref<StoredMedia[]>([])
const cloud=ref<CloudMedia[]>([])
const cursor=ref<string|null>(null)
const selectedUrl=ref('')
const metadata=ref<MediaMetadata|null>(null)
const busy=ref(false)
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
    await enqueueEncryptedMedia(selected)
    await refresh()
    notice.value='Файл зашифрован и сохранён на устройстве. Синхронизация будет подтверждена отдельно.'
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
  }catch(e){error.value=explanation(e)}
  finally{busy.value=false}
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
watch(activeSession,()=>{
  clearPreview()
  local.value=[];cloud.value=[];cursor.value=null
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
    <div class="action-row">
      <label class="media-file-choice">
        Выбрать файл
        <input data-testid="media-import-file" type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/mp4,audio/mpeg,audio/webm,audio/wav,audio/x-wav,audio/aac,audio/ogg"
          :disabled="busy" @change="chooseFile">
      </label>
      <button type="button" :disabled="busy" @click="sync">Синхронизировать файлы</button>
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
    <div v-if="selectedUrl&&metadata" class="foundation-card" data-testid="media-decrypted-preview">
      <h3>Расшифровано локально: {{ metadata.fileName }}</h3>
      <img v-if="metadata.mime.startsWith('image/')" :src="selectedUrl" alt="Личный файл" class="decrypted-preview">
      <video v-else-if="metadata.mime.startsWith('video/')" :src="selectedUrl" controls playsinline preload="metadata" class="decrypted-preview"/>
      <audio v-else-if="metadata.mime.startsWith('audio/')" :src="selectedUrl" controls preload="metadata"/>
      <p class="muted">Исходное имя файла и формат прочитаны из AES-GCM метаданных, не из серверного каталога.</p>
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
