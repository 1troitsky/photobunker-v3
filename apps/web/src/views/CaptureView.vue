<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { activeSession, type Session } from '../features/identity/application/session'
import { captureEncrypted } from '../features/photo-sync/application/p1-photo'
import { enqueueEncryptedMedia } from '../features/media/application/media-outbox'
import type { MediaCaptureIntent } from '../features/media/application/media-outbox'
import { MAX_MEDIA_BYTES } from '../features/media/domain/media-crypto'
import type { GPSFix } from '../features/photo-sync/domain/capture-metadata'
import {
  listServerAssignments, listVerifiedCapturePolicies, signedCaptureBinding,
  signedMediaCaptureIntent,signedAllowedAssignmentMedia,
  signedPolicyRequirements,
} from '../features/assignments/application/assignment-outbox'
import type { AssignmentListing } from '../features/assignments/application/assignment-outbox'

const route=useRoute()
const video=ref<HTMLVideoElement|null>(null)
const policies=ref<AssignmentListing[]>([])
const selectedAssignment=ref('')
const captureMode=ref<'photo'|'video'|'audio'>('photo')
const recording=ref(false)
const recordLimitMs=175000
const recorder=shallowRef<MediaRecorder|null>(null)
const recordingStartedAt=ref<number|null>(null)
let recordingTimer:ReturnType<typeof setTimeout>|null=null
let recordingParts:Blob[]=[]
let recordedSize=0
let activeRecording:object|null=null
const canCaptureType=computed(()=>{
  const required=route.query.assignmentId
  if(typeof required==='string'&&required
    &&selectedAssignment.value!==required)return false
  if(!selectedAssignment.value)return true
  const policy=policies.value.find(p=>p.assignmentId===selectedAssignment.value)
  return !!policy&&signedAllowedAssignmentMedia(policy).includes(captureMode.value)
})
const requiredFields=computed(()=>{
  const policy=policies.value.find(p=>p.assignmentId===selectedAssignment.value)
  return policy?signedPolicyRequirements(policy):null
})
// Volatile capture form. These values never enter IndexedDB in plaintext.
const category=ref('')
const description=ref('')
const gps=ref<GPSFix|null>(null)
const gpsLoading=ref(false)
const gpsError=ref('')
let gpsAttempt=0
const policyNotice=ref('')
const policyLoading=ref(false)
let refreshAgain=false
async function refreshPolicies():Promise<void> {
  if(disposed)return
  const session=activeSession.value
  if(!session){policies.value=[];selectedAssignment.value='';return}
  if(policyLoading.value){refreshAgain=true;return}
  const identity=cameraIdentity(session),generation=cameraGeneration
  policyLoading.value=true
  policyNotice.value=''
  try{
    if(session.online && navigator.onLine){
      try{await listServerAssignments()}
      catch{if(ownsCamera(identity,generation))policyNotice.value='Не удалось обновить политики. Используются ранее проверенные.'}
    }
    const found=await listVerifiedCapturePolicies()
    if(!ownsCamera(identity,generation))return
    policies.value=found
    const requested=route.query.assignmentId
    const preferred=typeof requested==='string'?requested:selectedAssignment.value
    selectedAssignment.value=found.some(x=>x.assignmentId===preferred)?preferred:''
    if(typeof requested==='string'&&requested&&!selectedAssignment.value)
      policyNotice.value='Для этого задания нет проверенной политики. Съёмка по нему заблокирована.'
  }catch(e){
    if(ownsCamera(identity,generation))policyNotice.value=e instanceof Error?e.message:'assignment.policies_unavailable'
  }finally{
    policyLoading.value=false
    if(refreshAgain){refreshAgain=false;if(!disposed)void refreshPolicies()}
  }
}

const stream=ref<MediaStream|null>(null)
const busy=ref(false)
const message=ref('')
const error=ref('')
const starting=ref(false)
let disposed=false
let cameraWanted=true
let cameraGeneration=0

// Session.online and JS object identity are not camera ownership. Snapshot all
// account/device/key material so genuine changes cancel even an A -> B -> A
// transition; never serialize or persist this in-memory comparison.
function cameraIdentity(session:Session|null) {
  if(!session)return null
  return [session.accountId,session.deviceId,session.device.accountId,
    session.device.deviceId,session.device.deviceSpki,session.device.deviceKey,
    session.device.encryptionKey,session.pkg.v,session.pkg.accountId,
    session.pkg.accountSpki,session.pkg.accountPkcs8,session.pkg.akek,
    session.pkg.signingKeyId,session.pkg.wrappingKeyId,session.pkg.revision] as const
}
type CameraIdentity=ReturnType<typeof cameraIdentity>
function sameIdentity(a:CameraIdentity,b:CameraIdentity):boolean {
  return a!==null && b!==null && a.length===b.length && a.every((value,index)=>value===b[index])
}
let observedIdentity=cameraIdentity(activeSession.value)
let streamIdentity:CameraIdentity=null
function ownsCamera(identity:CameraIdentity,generation:number):boolean {
  return !disposed && cameraGeneration===generation
    &&sameIdentity(identity,cameraIdentity(activeSession.value))
}
function discardRecording():void {
  const old=recorder.value
  recorder.value=null
  activeRecording=null
  recording.value=false
  recordingStartedAt.value=null
  recordingParts=[]
  recordedSize=0
  if(recordingTimer!==null){clearTimeout(recordingTimer);recordingTimer=null}
  if(old&&old.state!=='inactive'){
    old.ondataavailable=null
    old.onstop=null
    old.stop()
  }
}

function stopTracks(opened:MediaStream):void {
  for(const track of opened.getTracks())if(track.readyState!=='ended')track.stop()
}
function releaseStream():void {
  discardRecording()
  if(stream.value)stopTracks(stream.value)
  stream.value=null;streamIdentity=null
  if(video.value)video.value.srcObject=null
}

async function openCamera():Promise<void> {
  cameraWanted=true
  await startCamera()
}
async function startCamera():Promise<void> {
  if(starting.value||stream.value||disposed||!cameraWanted)return
  error.value=''
  if(!activeSession.value){error.value='Сначала создайте или восстановите аккаунт';return}
  if(!navigator.mediaDevices?.getUserMedia){error.value='Браузер не поддерживает камеру';return}
  starting.value=true
  const identity=cameraIdentity(activeSession.value),generation=cameraGeneration
  let opened:MediaStream|null=null
  try{
    const mode=captureMode.value
    opened=await navigator.mediaDevices.getUserMedia({
      audio:mode!=='photo',
      video:mode!=='audio'
        ?{facingMode:{ideal:'environment'},width:{ideal:1280}}:false,
    })
    await nextTick()
    if(!cameraWanted||!ownsCamera(identity,generation)||!video.value){
      stopTracks(opened)
      return
    }
    stream.value=opened;streamIdentity=identity
    const preview=video.value
    if(captureMode.value!=='audio'){
      preview.srcObject=opened
      await preview.play()
    }
    if(!cameraWanted||!ownsCamera(identity,generation)||video.value!==preview){
      stopTracks(opened)
      if(stream.value===opened)releaseStream()
    }
  }catch(e){
    if(opened)stopTracks(opened)
    if(stream.value===opened)releaseStream()
    if(ownsCamera(identity,generation)){
      cameraWanted=false // Denial/play errors require an explicit retry.
      error.value=e instanceof Error?e.message:'camera.unavailable'
    }
  }finally{
    starting.value=false
    // Serialize requests. Only an intervening ownership/cancel event can
    // schedule this follow-up; ordinary errors cannot create a retry loop.
    if(cameraWanted && !disposed && cameraGeneration!==generation
      &&activeSession.value && !stream.value)void nextTick().then(startCamera)
  }
}
function clearGPS():void {
  gpsAttempt++
  gps.value=null
  gpsLoading.value=false
  gpsError.value=''
}
async function obtainGPS():Promise<void>{
  const current=activeSession.value
  if(!current){gpsError.value='Сначала создайте или восстановите аккаунт';return}
  if(!navigator.geolocation){gpsError.value='Геолокация недоступна';return}
  const generation=cameraGeneration,identity=cameraIdentity(current)
  const attempt=++gpsAttempt
  gpsLoading.value=true;gpsError.value=''
  try{
    // Explicit user action only. Never start a background location watcher.
    const point=await new Promise<GeolocationPosition>((resolve,reject)=>{
      navigator.geolocation.getCurrentPosition(resolve,reject,{
        enableHighAccuracy:true,maximumAge:0,timeout:12000,
      })
    })
    if(attempt!==gpsAttempt||!ownsCamera(identity,generation))return
    gps.value={
      latitude:point.coords.latitude,longitude:point.coords.longitude,
      accuracyMeters:point.coords.accuracy,recordedAt:Math.round(point.timestamp),
    }
  }catch(e){
    if(attempt===gpsAttempt&&ownsCamera(identity,generation))
      gpsError.value=e instanceof Error?e.message:'camera.gps_unavailable'
  }finally{
    if(attempt===gpsAttempt)gpsLoading.value=false
  }
}
function mediaMime(kind:'video'|'audio'):string{
  if(typeof MediaRecorder==='undefined')throw Error('camera.recorder_unavailable')
  const formats=kind==='video'
    ?['video/webm','video/mp4']
    :['audio/webm','audio/mp4','audio/ogg']
  const format=formats.find(mime=>MediaRecorder.isTypeSupported(mime))
  if(!format)throw Error('camera.media_format_unsupported')
  return format
}
async function beginRecording():Promise<void>{
  const mode=captureMode.value
  const identity=streamIdentity,generation=cameraGeneration
  if(mode==='photo'||recording.value||busy.value||!canCaptureType.value
    ||!stream.value||!ownsCamera(identity,generation))return
  busy.value=true;error.value='';message.value=''
  try{
    const required=route.query.assignmentId
    if(typeof required==='string'&&required&&selectedAssignment.value!==required)
      throw Error('assignment.policy_not_verified')
    const startedAt=Date.now()
    // Snapshot verified owner policy BEFORE acquiring any recording bytes.
    // MediaFile v1 stays opaque; an independent account-signed capture
    // sidecar will later bind its exact ciphertext manifest digest.
    const intent=selectedAssignment.value
      ?await signedMediaCaptureIntent(selectedAssignment.value,mode,startedAt)
      :undefined
    if(!ownsCamera(identity,generation)||captureMode.value!==mode
      ||(intent&&selectedAssignment.value!==intent.assignmentId))
      throw Error('camera.identity_changed')
    const mime=mediaMime(mode)
    const streamRef=stream.value
    if(!streamRef)throw Error('camera.stream_unavailable')
    const worker=new MediaRecorder(streamRef,{mimeType:mime})
    const token={identity,generation,mode,intent,startedAt,mime}
    activeRecording=token
    recordingParts=[]
    recordedSize=0
    recorder.value=worker
    recording.value=true
    recordingStartedAt.value=startedAt
    worker.ondataavailable=event=>{
      if(activeRecording!==token||!event.data.size)return
      recordingParts.push(event.data)
      recordedSize+=event.data.size
      if(recordedSize>MAX_MEDIA_BYTES){
        error.value='media.invalid_size'
        discardRecording()
      }
    }
    worker.onerror=()=>{error.value='camera.recording_failed';discardRecording()}
    worker.onstop=()=>{
      if(activeRecording!==token)return
      if(recordingTimer!==null){clearTimeout(recordingTimer);recordingTimer=null}
      const parts=recordingParts
      recordingParts=[]
      recorder.value=null;recording.value=false;recordingStartedAt.value=null
      activeRecording=null
      const bytes=recordedSize;recordedSize=0
      void (async()=>{
        if(!ownsCamera(identity,generation)||captureMode.value!==mode
          ||(intent&&selectedAssignment.value!==intent.assignmentId))return
        busy.value=true
        try{
          if(bytes<128||bytes>MAX_MEDIA_BYTES)
            throw Error('media.invalid_size')
          const finishedAt=Date.now()
          if(finishedAt<=startedAt||finishedAt-startedAt>recordLimitMs+2000)
            throw Error('camera.recording_duration_invalid')
          const suffix=mime.includes('webm')?'webm'
            :mime.includes('ogg')?'ogg':'mp4'
          const file=new File(parts,
            'recording-'+new Date(startedAt).toISOString()+'.'+suffix,
            {type:mime,lastModified:startedAt})
          const capture:MediaCaptureIntent|undefined=intent
            ?{...intent,finishedAt}:undefined
          const id=await enqueueEncryptedMedia(file,capture)
          if(!ownsCamera(identity,generation))return
          message.value='Запись зашифрована и сохранена локально: '+id.slice(0,8)
        }catch(e){
          if(ownsCamera(identity,generation))
            error.value=e instanceof Error?e.message:'camera.media_failed'
        }finally{busy.value=false}
      })()
    }
    worker.start(1000)
    recordingTimer=setTimeout(()=>{
      if(activeRecording===token&&worker.state==='recording')
        worker.stop()
    },recordLimitMs)
  }catch(e){
    discardRecording()
    if(ownsCamera(identity,generation))
      error.value=e instanceof Error?e.message:'camera.recording_failed'
  }finally{busy.value=false}
}
function endRecording():void{
  const worker=recorder.value
  if(worker&&worker.state==='recording')worker.stop()
}

function closeCamera():void {
  cameraWanted=false;cameraGeneration++
  clearGPS()
  releaseStream()
}
async function capture():Promise<void> {
  const v=video.value
  const identity=streamIdentity,generation=cameraGeneration
  if(busy.value||starting.value||!v||!stream.value||!ownsCamera(identity,generation)
    ||v.videoWidth<1||v.videoHeight<1)return
  const assertOwner=()=>{
    if(!cameraWanted||!ownsCamera(identity,generation))throw new Error('camera.identity_changed')
  }
  busy.value=true;error.value='';message.value=''
  try{
    const ratio=Math.min(1,1280/Math.max(v.videoWidth,v.videoHeight))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(v.videoWidth*ratio))
    canvas.height=Math.max(1,Math.round(v.videoHeight*ratio))
    const ctx=canvas.getContext('2d')
    if(!ctx)throw new Error('camera.canvas_unavailable')
    ctx.drawImage(v,0,0,canvas.width,canvas.height)
    const jpeg=await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('camera.jpeg_failed')),
        'image/jpeg',0.85)
    })
    assertOwner()
    // Canvas output strips source EXIF; no device gallery write occurs.
    // Do not silently record a personal photograph when the user entered
    // the camera via an assignment that has no authenticated policy.
    const required=route.query.assignmentId
    if(typeof required==='string'&&required&&selectedAssignment.value!==required)
      throw new Error('assignment.policy_not_verified')
    // An offline photo carries an independently verified, versioned and
    // device-signed snapshot of the assignment policy. Personal v1 stays available.
    const capturedAt=Date.now()
    // Snapshot these fields once. Validation and the encrypted metadata
    // must refer to the same input even if UI changes during async binding.
    const privateFields={
      category:category.value,description:description.value,gps:gps.value,
    }
    const binding=selectedAssignment.value
      ?await signedCaptureBinding(selectedAssignment.value,capturedAt,privateFields)
      :undefined
    assertOwner()
    const photo=await captureEncrypted(jpeg,binding,privateFields)
    assertOwner()
    message.value='Зашифровано и сохранено локально: '+photo.photoId.slice(0,8)
  }catch(e){if(ownsCamera(identity,generation))error.value=e instanceof Error?e.message:'camera.capture_failed'}
  finally{busy.value=false}
}
// Restoring a trusted device after a page load is asynchronous. The camera
// must also start when that local identity appears, not just on first mount.
watch(activeSession,session=>{
  const identity=cameraIdentity(session)
  if(!sameIdentity(observedIdentity,identity)){
    observedIdentity=identity;cameraGeneration++
    releaseStream()
    policies.value=[];selectedAssignment.value='';policyNotice.value=''
    category.value='';description.value='';clearGPS()
    message.value='';error.value=''
  }
  if(!session)return
  void refreshPolicies()
  void nextTick().then(startCamera)
},{flush:'sync'})
onMounted(()=>{
  if(activeSession.value){void refreshPolicies();void nextTick().then(startCamera)}
})
watch(()=>route.query.assignmentId,()=>{
  if(recording.value)discardRecording()
  void refreshPolicies()
})
watch(captureMode,()=>{
  closeCamera()
  if(!disposed&&activeSession.value){
    cameraWanted=true
    void nextTick().then(startCamera)
  }
})
onUnmounted(()=>{disposed=true;closeCamera()})
</script>

<template>
  <section class="foundation-content">
    <h1>Камера</h1>
    <p class="subtitle">P1 · локальное шифрование до отправки</p>
    <div v-if="!activeSession" class="foundation-card">
      <p>Для съёмки нужен анонимный аккаунт.</p>
      <RouterLink to="/settings">Создать или восстановить аккаунт</RouterLink>
    </div>
    <template v-else>
      <div class="foundation-card">
        <label for="camera-mode">Режим съёмки</label>
        <select id="camera-mode" v-model="captureMode" :disabled="recording||busy"
          data-testid="camera-mode">
          <option value="photo">Фото</option>
          <option value="video">Видео</option>
          <option value="audio">Аудио</option>
        </select>
        <label for="camera-assignment">Задание для съёмки</label>
        <select id="camera-assignment" v-model="selectedAssignment" :disabled="busy||recording">
          <option value="">Личная запись (без задания)</option>
          <option v-for="policy in policies" :key="policy.assignmentId"
            :value="policy.assignmentId">
            Задание {{ policy.assignmentId.slice(0,8) }} · политика {{ policy.policyRevision }}
          </option>
        </select>
        <button type="button" :disabled="policyLoading||busy" @click="refreshPolicies">
          {{ policyLoading?'Проверка…':'Обновить задания' }}
        </button>
        <p class="muted">Доступны только проверенные подписанные политики. При съёмке без сети используется последний подтверждённый снимок политики; сервер повторно проверит права при загрузке.</p>
        <p v-if="policyNotice" class="muted" role="status">{{ policyNotice }}</p>
        <p v-if="captureMode!=='photo'" class="muted">
          Видео и аудио доступны только если владелец подписал разрешение
          соответствующего типа. Подтверждение записи связывается с
          версией правил и зашифрованным MediaFile; время — заявление
          устройства, не аппаратная аттестация.
        </p>
        <p v-if="requiredFields&&captureMode==='photo'" role="status" class="muted">
          Подписанные требования: категория {{ requiredFields.requiredCategory?'обязательна':'необязательна' }},
          описание минимум {{ requiredFields.descriptionMinLength }} символов,
          GPS {{ requiredFields.requiredGps?'обязателен':'необязателен' }}.
        </p>
      </div>
      <div v-if="captureMode==='photo'" class="foundation-card">
        <h2>Приватная информация снимка</h2>
        <label for="camera-category">Категория</label>
        <input id="camera-category" v-model="category" type="text" maxlength="64"
          autocomplete="off" placeholder="Например, репортаж">
        <label for="camera-description">Описание</label>
        <textarea id="camera-description" v-model="description" maxlength="4000"
          rows="3" placeholder="Описание снимка (необязательно)"/>
        <div class="action-row">
          <button type="button" :disabled="gpsLoading||busy" @click="obtainGPS">
            {{ gpsLoading?'Определение GPS…':'Получить GPS' }}
          </button>
          <button v-if="gps||gpsLoading" type="button" @click="clearGPS">
            Убрать GPS
          </button>
        </div>
        <p v-if="gps" role="status" class="muted">
          GPS получен · точность ±{{ Math.round(gps.accuracyMeters) }} м
        </p>
        <p v-if="gpsError" role="alert" class="error-text">{{ gpsError }}</p>
        <p class="muted">GPS запрашивается только по нажатию. Категория, описание и координаты шифруются на устройстве и не попадают на сервер открытым текстом.</p>
      </div>
      <div class="video-frame" v-show="captureMode!=='audio'">
        <video ref="video" playsinline muted autoplay aria-label="Предпросмотр камеры"/>
      </div>
      <p v-if="captureMode==='audio'" class="muted">
        Аудиозапись использует только микрофон. Видеопоток не запрашивается.
      </p>
      <div class="action-row">
        <button type="button" :disabled="!!stream||starting" @click="openCamera">Включить камеру</button>
        <button v-if="captureMode==='photo'" type="button"
          :disabled="!stream||starting||busy||gpsLoading||!canCaptureType"
          @click="capture">
          {{ busy ? 'Шифрование…' : 'Сделать снимок' }}
        </button>
        <button v-else-if="!recording" type="button"
          data-testid="camera-start-recording"
          :disabled="!stream||starting||busy||!canCaptureType"
          @click="beginRecording">Начать запись {{ captureMode==='video'?'видео':'аудио' }}</button>
        <button v-else type="button"
          data-testid="camera-stop-recording"
          @click="endRecording">Остановить запись</button>
        <button type="button" :disabled="!stream&&!starting" @click="closeCamera">
          {{ recording?'Отменить запись':'Отключить' }}
        </button>
      </div>
      <p v-if="recording" role="status" class="status-text" data-testid="camera-recording-status">
        Идёт запись с {{ recordingStartedAt?new Date(recordingStartedAt).toLocaleTimeString():'' }}. Максимум 175 секунд и 128 MiB.
      </p>
      <p class="muted">В системную медиатеку запись не сохраняется. Сначала создаётся только зашифрованный файл в локальном хранилище. Во время MediaRecorder исходные части находятся в оперативной памяти браузера; закрытие страницы до шифрования приведёт к потере несохранённой записи.</p>
    </template>
    <p v-if="message" role="status" class="status-text">{{ message }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
