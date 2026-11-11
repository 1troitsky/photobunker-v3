<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {RouterLink,useRoute,useRouter} from 'vue-router'
import {activeSession} from '../features/identity/application/session'
import {
  listLocalPhotos,listCloudPhotos,readLocalPhoto,readCloudPhoto,
  readLocalPhotoMetadata,readCloudPhotoMetadata,
} from '../features/photo-sync/application/p1-photo'
import type {StoredPhoto,CloudPhoto} from '../features/photo-sync/application/p1-photo'
import {
  listLocalMedia,listCloudMedia,readLocalMedia,readCloudMedia,
} from '../features/media/application/media-outbox'
import type {StoredMedia,CloudMedia} from '../features/media/application/media-outbox'
import {enqueueEncryptedMedia} from '../features/media/application/media-outbox'
import {captureVideoStill,stillName} from '../features/browser/application/video-still'
import type {VideoStill} from '../features/browser/application/video-still'
import {buildCatalog} from '../features/browser/application/catalog'
import type {CatalogItem,CatalogType} from '../features/browser/application/catalog'
import {
  adjacentFiles,parseViewerTarget,safeDownloadName,viewerKey,
} from '../features/browser/application/viewer-navigation'

type PrivateGPS={latitude:number;longitude:number;accuracyMeters:number}
type Preview={
  type:CatalogType;mime:string;name:string;description:string
  category:string;tags:string[];gps:PrivateGPS|null
  capturedAt:number|null;expiresAt:number|null;origin:'local'|'cloud'
}
const route=useRoute()
const router=useRouter()
const stage=ref<HTMLElement|null>(null)
const videoElement=ref<HTMLVideoElement|null>(null)
const still=ref<VideoStill|null>(null)
const stillUrl=ref('')
const stillBusy=ref(false)
const stillError=ref('')
const stillNotice=ref('')
const stillSavedId=ref<string|null>(null)
let stillEpoch=0
const current=computed(()=>parseViewerTarget(route.params.protocol,route.params.id))
const photoLocal=ref<StoredPhoto[]>([])
const photoCloud=ref<CloudPhoto[]>([])
const mediaLocal=ref<StoredMedia[]>([])
const mediaCloud=ref<CloudMedia[]>([])
const photoCursor=ref<string|null>(null)
const mediaCursor=ref<string|null>(null)
const indexBusy=ref(false)
const busy=ref(false)
const error=ref('')
const notice=ref('')
const fileUrl=ref('')
const fileBlob=ref<Blob|null>(null)
const preview=ref<Preview|null>(null)
const files=computed(()=>buildCatalog(
  photoLocal.value,photoCloud.value,mediaLocal.value,mediaCloud.value,
))
const adjacent=computed(()=>current.value
  ?adjacentFiles(files.value,current.value)
  :{previous:null,next:null,position:0,total:0})
let catalogEpoch=0
let fileEpoch=0
let touchStart:{x:number;y:number}|null=null

const stillFileName=computed(()=>{
  if(!preview.value||!still.value)return ''
  return stillName(preview.value.name,still.value.timeMs)
})
function clearStill():void{
  ++stillEpoch
  if(stillUrl.value)URL.revokeObjectURL(stillUrl.value)
  stillUrl.value=''
  still.value=null
  stillBusy.value=false
  stillError.value=''
  stillNotice.value=''
  stillSavedId.value=null
}
function clearBlob():void{
  clearStill()
  ++fileEpoch
  if(fileUrl.value)URL.revokeObjectURL(fileUrl.value)
  fileUrl.value=''
  fileBlob.value=null
  preview.value=null
  busy.value=false
}
function clearIndex():void{
  ++catalogEpoch
  photoLocal.value=[];photoCloud.value=[]
  mediaLocal.value=[];mediaCloud.value=[]
  photoCursor.value=null;mediaCursor.value=null
}
function sameSession(session:typeof activeSession.value,epoch:number):boolean{
  return activeSession.value===session&&epoch===fileEpoch
}
function explain(error:unknown):string{
  return error instanceof Error?error.message:'viewer.unavailable'
}
function offline():boolean{
  return typeof navigator!=='undefined'&&navigator.onLine===false
}
/** Index metadata is opaque. No file plaintext, filename or GPS is indexed. */
async function refreshIndex():Promise<void>{
  const session=activeSession.value
  clearIndex()
  const epoch=catalogEpoch
  if(!session)return
  indexBusy.value=true
  try{
    const [photos,media]=await Promise.all([listLocalPhotos(),listLocalMedia()])
    if(session!==activeSession.value||epoch!==catalogEpoch)return
    photoLocal.value=photos;mediaLocal.value=media
    if(!session.online||offline())return
    const [p,m]=await Promise.allSettled([listCloudPhotos(),listCloudMedia()])
    if(session!==activeSession.value||epoch!==catalogEpoch)return
    if(p.status==='fulfilled'){
      photoCloud.value=p.value.items
      photoCursor.value=p.value.nextCursor
    }
    if(m.status==='fulfilled'){
      mediaCloud.value=m.value.items
      mediaCursor.value=m.value.nextCursor
    }
    if(p.status==='rejected'||m.status==='rejected')
      notice.value='Часть облачного каталога недоступна. Локальные файлы остаются доступны.'
  }catch(e){
    if(session===activeSession.value&&epoch===catalogEpoch)notice.value=explain(e)
  }finally{if(epoch===catalogEpoch)indexBusy.value=false}
}
async function loadMore():Promise<void>{
  const session=activeSession.value
  if(!session?.online||offline()||indexBusy.value
    ||(!photoCursor.value&&!mediaCursor.value))return
  const epoch=catalogEpoch
  const pc=photoCursor.value,mc=mediaCursor.value
  indexBusy.value=true
  const [p,m]=await Promise.allSettled([
    pc?listCloudPhotos(pc):Promise.resolve(null),
    mc?listCloudMedia(mc):Promise.resolve(null),
  ])
  if(session===activeSession.value&&epoch===catalogEpoch){
    if(p.status==='fulfilled'&&p.value){
      photoCloud.value=[...photoCloud.value,...p.value.items]
      photoCursor.value=p.value.nextCursor
    }
    if(m.status==='fulfilled'&&m.value){
      mediaCloud.value=[...mediaCloud.value,...m.value.items]
      mediaCursor.value=m.value.nextCursor
    }
    if(p.status==='rejected'||m.status==='rejected')
      notice.value='Не все страницы каталога удалось загрузить.'
    indexBusy.value=false
  }
}
async function openFile():Promise<void>{
  clearBlob()
  error.value='';notice.value=''
  const session=activeSession.value,target=current.value
  if(!session||!target)return
  const epoch=++fileEpoch
  busy.value=true
  try{
    let blob:Blob
    let data:Preview
    let origin:'local'|'cloud'='local'
    if(target.protocol==='photo'){
      let metadata:Awaited<ReturnType<typeof readLocalPhotoMetadata>>
      try{
        [blob,metadata]=await Promise.all([
          readLocalPhoto(target.id),readLocalPhotoMetadata(target.id),
        ])
      }catch(e){
        // Missing local ciphertext may be fetched after authentication.
        // Integrity/authentication failures must NOT be concealed by fallback.
        if(!(e instanceof Error&&e.message==='photo.not_available'))throw e
        if(!session.online||offline())throw Error('viewer.only_cloud_offline')
        origin='cloud'
        ;[blob,metadata]=await Promise.all([
          readCloudPhoto(target.id),readCloudPhotoMetadata(target.id),
        ])
      }
      data={
        type:'photo',mime:'image/jpeg',name:target.id.slice(0,8)+'.jpg',
        description:metadata.description??'',category:metadata.category??'',
        tags:metadata.tags??[],gps:metadata.gps??null,
        capturedAt:metadata.capturedAt,
        expiresAt:files.value.find(x=>x.key===viewerKey(target))?.expiresAt??null,
        origin,
      }
    }else{
      let result:Awaited<ReturnType<typeof readLocalMedia>>
      try{result=await readLocalMedia(target.id)}
      catch(e){
        if(!(e instanceof Error&&e.message==='media.not_available'))throw e
        if(!session.online||offline())throw Error('viewer.only_cloud_offline')
        origin='cloud'
        result=await readCloudMedia(target.id)
      }
      blob=result.blob
      const m=result.metadata
      const type:CatalogType=m.mime.startsWith('image/')?'photo'
        :m.mime.startsWith('video/')?'video'
          :m.mime.startsWith('audio/')?'audio'
            :(()=>{throw Error('viewer.unsupported_media')})()
      data={
        type,mime:m.mime,name:m.fileName,
        description:m.description??'',category:m.category??'',
        tags:m.tags??[],gps:m.gps??null,
        capturedAt:m.createdAt,
        expiresAt:files.value.find(x=>x.key===viewerKey(target))?.expiresAt??null,
        origin,
      }
    }
    if(!sameSession(session,epoch)
      ||viewerKey(target)!==viewerKey(current.value??target)
      ||!current.value)return
    fileBlob.value=blob
    fileUrl.value=URL.createObjectURL(blob)
    preview.value=data
  }catch(e){
    if(sameSession(session,epoch))error.value=explain(e)
  }finally{if(sameSession(session,epoch))busy.value=false}
}
async function navigate(item:CatalogItem|null):Promise<void>{
  if(!item||busy.value)return
  await router.push({
    name:'browser-viewer',params:{protocol:item.source,id:item.id},
  })
}
function onKeyDown(event:KeyboardEvent):void{
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey
    ||event.target instanceof HTMLElement&&event.target.closest(
      'input,textarea,select,video,audio,button,[contenteditable="true"]'))return
  if(event.key==='ArrowLeft'&&adjacent.value.previous){
    event.preventDefault();void navigate(adjacent.value.previous)
  }else if(event.key==='ArrowRight'&&adjacent.value.next){
    event.preventDefault();void navigate(adjacent.value.next)
  }else if(event.key==='Escape'&&!document.fullscreenElement){
    event.preventDefault();void router.push('/browser')
  }
}
function onTouchStart(event:TouchEvent):void{
  if(preview.value?.type!=='photo'||event.touches.length!==1)return
  touchStart={x:event.touches[0]!.clientX,y:event.touches[0]!.clientY}
}
function onTouchEnd(event:TouchEvent):void{
  if(!touchStart||event.changedTouches.length!==1||preview.value?.type!=='photo')return
  const dx=event.changedTouches[0]!.clientX-touchStart.x
  const dy=event.changedTouches[0]!.clientY-touchStart.y
  touchStart=null
  if(Math.abs(dx)>75&&Math.abs(dx)>Math.abs(dy)*1.4)
    void navigate(dx>0?adjacent.value.previous:adjacent.value.next)
  else if(Math.abs(dy)>100&&Math.abs(dy)>Math.abs(dx)*1.4
    &&document.fullscreenElement)void document.exitFullscreen()
}
async function toggleFullscreen():Promise<void>{
  try{
    if(document.fullscreenElement)await document.exitFullscreen()
    else if(stage.value?.requestFullscreen)await stage.value.requestFullscreen()
    else notice.value='Полноэкранный режим не поддерживается браузером.'
  }catch{notice.value='Полноэкранный режим недоступен.'}
}
async function createStill():Promise<void>{
  const session=activeSession.value
  const video=videoElement.value
  const target=current.value
  const url=fileUrl.value
  const currentEpoch=fileEpoch
  if(!session||!video||!target||preview.value?.type!=='video'||!url
    ||stillBusy.value)return
  clearStill()
  const epoch=stillEpoch
  stillBusy.value=true
  try{
    // Never draw the frame from a different file or account, and never use
    // a remote media URL. The video source is the verified local Blob URL.
    if(video.currentSrc!==url)throw Error('viewer.frame_wrong_source')
    const captured=await captureVideoStill(video)
    if(!sameSession(session,currentEpoch)||epoch!==stillEpoch
      ||fileUrl.value!==url||!current.value
      ||viewerKey(current.value)!==viewerKey(target))return
    still.value=captured
    stillUrl.value=URL.createObjectURL(captured.blob)
    stillNotice.value='JPEG создан локально. Он не сохранён на устройство или в облако.'
  }catch(e){
    if(sameSession(session,currentEpoch)&&epoch===stillEpoch)
      stillError.value=explain(e)
  }finally{
    if(sameSession(session,currentEpoch)&&epoch===stillEpoch)
      stillBusy.value=false
  }
}
async function saveStillToBrowser():Promise<void>{
  const session=activeSession.value
  const asset=still.value
  const name=stillFileName.value
  const originalEpoch=fileEpoch,epoch=stillEpoch
  if(!session||!asset||!name||stillBusy.value||preview.value?.type!=='video')
    return
  stillBusy.value=true
  stillError.value='';stillNotice.value=''
  try{
    // A separate personal E2EE photo. Never inherit source file grants,
    // assignment provenance, GPS or retention by implication.
    const id=await enqueueEncryptedMedia(
      new File([asset.blob],name,{type:'image/jpeg'}))
    if(sameSession(session,originalEpoch)&&epoch===stillEpoch){
      stillSavedId.value=id
      stillNotice.value='Стоп-кадр зашифрован и сохранён в локальной очереди Browser. Подтверждение облачной синхронизации отдельно.'
      // Makes newly encrypted media visible to the adjacent-file index.
      void refreshIndex()
    }
  }catch(e){
    if(sameSession(session,originalEpoch)&&epoch===stillEpoch)
      stillError.value=explain(e)
  }finally{
    if(sameSession(session,originalEpoch)&&epoch===stillEpoch)
      stillBusy.value=false
  }
}
function downloadStill():void{
  if(!activeSession.value||!still.value||!stillUrl.value||!stillFileName.value
    ||stillBusy.value||preview.value?.type!=='video')return
  if(!window.confirm('Скачать JPEG-стоп-кадр на устройство? Он окажется вне зашифрованного Browser и может попасть в системные файлы/галерею.'))return
  const anchor=document.createElement('a')
  anchor.href=stillUrl.value
  anchor.download=stillFileName.value
  anchor.rel='noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
function download():void{
  if(!fileBlob.value||!fileUrl.value||!preview.value||!activeSession.value)return
  if(!window.confirm('Скачать расшифрованный файл на устройство? Он станет доступен за пределами защищённого хранилища PB3.'))return
  const anchor=document.createElement('a')
  anchor.href=fileUrl.value
  anchor.download=safeDownloadName(preview.value.name,'file')
  anchor.rel='noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
watch(activeSession,()=>{
  clearBlob();clearIndex()
  void refreshIndex()
  void openFile()
},{immediate:true})
watch([()=>route.params.protocol,()=>route.params.id],()=>{void openFile()})
onMounted(()=>window.addEventListener('keydown',onKeyDown))
onUnmounted(()=>{
  window.removeEventListener('keydown',onKeyDown)
  clearBlob();clearIndex()
})
</script>

<template>
  <section class="foundation-content file-viewer" data-testid="file-viewer">
    <header class="file-viewer-header">
      <RouterLink to="/browser" class="file-viewer-back">‹ Browser</RouterLink>
      <div>
        <h1>Просмотр файла</h1>
        <p class="muted" v-if="current">{{ current.id.slice(0,8) }}</p>
      </div>
      <button type="button" :disabled="!fileUrl"
        @click="toggleFullscreen">На весь экран</button>
    </header>
    <div v-if="!activeSession" class="foundation-card">
      <p>Для просмотра зашифрованных файлов необходим вход.</p>
      <RouterLink to="/settings">Открыть доступ</RouterLink>
    </div>
    <div v-else-if="!current" role="alert" class="error-text">
      Некорректный адрес файла.
    </div>
    <template v-else>
      <div class="file-viewer-navigation">
        <button type="button" aria-label="Предыдущий файл"
          :disabled="!adjacent.previous||busy"
          @click="navigate(adjacent.previous)">‹</button>
        <span class="muted" data-testid="file-viewer-position">
          {{ adjacent.position?adjacent.position+' / '+adjacent.total:
            'Вне загруженного списка' }}
        </span>
        <button type="button" aria-label="Следующий файл"
          :disabled="!adjacent.next||busy"
          @click="navigate(adjacent.next)">›</button>
      </div>
      <div ref="stage" class="file-viewer-stage"
        data-testid="file-viewer-stage"
        @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
        <div v-if="busy" role="status" class="file-viewer-wait">Открываем защищённый файл…</div>
        <img v-else-if="fileUrl&&preview?.type==='photo'" :src="fileUrl"
          :alt="preview?.name??'Фото'" draggable="false"
          data-testid="file-viewer-image">
        <video v-else-if="fileUrl&&preview?.type==='video'" :key="fileUrl"
          ref="videoElement" :src="fileUrl" controls playsinline preload="metadata"
          data-testid="file-viewer-video"/>
        <div v-else-if="fileUrl&&preview?.type==='audio'" class="file-viewer-audio">
          <span aria-hidden="true">♫</span>
          <audio :key="fileUrl" :src="fileUrl" controls preload="metadata"
            data-testid="file-viewer-audio"/>
        </div>
        <p v-else class="muted">Файл не открыт.</p>
      </div>
      <section v-if="preview?.type==='video'&&fileUrl"
        class="file-viewer-still" data-testid="file-viewer-still">
        <div class="file-viewer-still-heading">
          <div>
            <h2>Стоп-кадр</h2>
            <p class="muted">Выберите момент на видеоплеере и создайте JPEG-копию кадра.</p>
          </div>
          <button type="button" data-testid="file-viewer-create-still"
            :disabled="busy||stillBusy" @click="createStill">
            {{ stillBusy?'Обработка…':'Создать стоп-кадр' }}
          </button>
        </div>
        <div v-if="still&&stillUrl" class="file-viewer-still-preview">
          <img :src="stillUrl" :alt="stillFileName"
            data-testid="file-viewer-still-image">
          <p class="muted">{{ still.width }} × {{ still.height }} ·
            {{ (still.timeMs/1000).toFixed(2) }} сек. · {{ stillFileName }}</p>
          <div class="file-viewer-still-actions">
            <button type="button" :disabled="stillBusy||!!stillSavedId"
              data-testid="file-viewer-save-still"
              @click="saveStillToBrowser">
              {{ stillSavedId?'Сохранено в Browser':'Сохранить зашифрованно в Browser' }}
            </button>
            <button type="button" :disabled="stillBusy"
              data-testid="file-viewer-download-still"
              @click="downloadStill">Скачать JPEG на устройство</button>
            <RouterLink v-if="stillSavedId"
              :to="{name:'browser-viewer',params:{protocol:'media',id:stillSavedId}}">
              Открыть сохранённый файл
            </RouterLink>
          </div>
        </div>
        <p class="muted">Стоп-кадр — отдельный личный файл: права доступа,
          задание, GPS и срок исходного видео не наследуются.
          Исходное видео не изменяется.</p>
        <p v-if="stillNotice" role="status" data-testid="file-viewer-still-status">
          {{ stillNotice }}</p>
        <p v-if="stillError" role="alert" data-testid="file-viewer-still-error">
          {{ stillError }}</p>
      </section>
      <div v-if="preview" class="file-viewer-information" data-testid="file-viewer-info">
        <div class="file-viewer-info-heading">
          <div>
            <h2>{{ preview.name }}</h2>
            <p class="muted">
              {{ preview.type==='photo'?'Фото':preview.type==='video'?'Видео':'Аудио' }}
              · {{ preview.origin==='local'?'Расшифровано локально':'Получено из облака и расшифровано локально' }}
            </p>
          </div>
          <button type="button" @click="download">Скачать</button>
        </div>
        <p v-if="preview.description">{{ preview.description }}</p>
        <dl>
          <template v-if="preview.capturedAt">
            <dt>Дата</dt><dd>{{ new Date(preview.capturedAt).toLocaleString('ru-RU') }}</dd>
          </template>
          <dt>Тип</dt><dd>{{ preview.mime }}</dd>
          <dt>ID</dt><dd><code>{{ current.id }}</code></dd>
          <template v-if="preview.category">
            <dt>Категория</dt><dd>{{ preview.category }}</dd>
          </template>
          <template v-if="preview.tags.length">
            <dt>Теги</dt><dd>{{ preview.tags.join(', ') }}</dd>
          </template>
          <template v-if="preview.gps">
            <dt>GPS</dt>
            <dd>{{ preview.gps.latitude }}, {{ preview.gps.longitude }}
              · ±{{ Math.round(preview.gps.accuracyMeters) }} м</dd>
          </template>
          <template v-if="preview.expiresAt">
            <dt>Хранение до</dt><dd>{{ new Date(preview.expiresAt).toLocaleDateString('ru-RU') }}</dd>
          </template>
        </dl>
        <p class="muted">Приватные данные расшифрованы на устройстве.
          Скачивание — только после явного подтверждения.</p>
      </div>
      <button v-if="photoCursor||mediaCursor" type="button"
        :disabled="indexBusy" @click="loadMore">Загрузить ещё файлы для навигации</button>
      <p v-if="indexBusy" class="muted">Обновляется список доступных файлов…</p>
      <p v-if="notice" role="status" class="muted">{{ notice }}</p>
      <p v-if="error" role="alert" class="error-text">{{ error }}</p>
    </template>
  </section>
</template>
