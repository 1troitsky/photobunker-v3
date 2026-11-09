<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { activeSession, type Session } from '../features/identity/application/session'
import { captureEncrypted } from '../features/photo-sync/application/p1-photo'
import {
  listServerAssignments, listVerifiedCapturePolicies, signedCaptureBinding,
} from '../features/assignments/application/assignment-outbox'
import type { AssignmentListing } from '../features/assignments/application/assignment-outbox'

const route=useRoute()
const video=ref<HTMLVideoElement|null>(null)
const policies=ref<AssignmentListing[]>([])
const selectedAssignment=ref('')
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
function stopTracks(opened:MediaStream):void {
  for(const track of opened.getTracks())if(track.readyState!=='ended')track.stop()
}
function releaseStream():void {
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
    opened=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280}},
    })
    await nextTick()
    if(!cameraWanted||!ownsCamera(identity,generation)||!video.value){
      stopTracks(opened)
      return
    }
    stream.value=opened;streamIdentity=identity
    const preview=video.value
    preview.srcObject=opened
    await preview.play()
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
function closeCamera():void {
  cameraWanted=false;cameraGeneration++
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
    const binding=selectedAssignment.value
      ?await signedCaptureBinding(selectedAssignment.value,Date.now())
      :undefined
    assertOwner()
    const photo=await captureEncrypted(jpeg,binding)
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
    message.value='';error.value=''
  }
  if(!session)return
  void refreshPolicies()
  void nextTick().then(startCamera)
},{flush:'sync'})
onMounted(()=>{
  if(activeSession.value){void refreshPolicies();void nextTick().then(startCamera)}
})
watch(()=>route.query.assignmentId,()=>{void refreshPolicies()})
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
        <label for="camera-assignment">Задание для съёмки</label>
        <select id="camera-assignment" v-model="selectedAssignment" :disabled="busy">
          <option value="">Личное фото (без задания)</option>
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
      </div>
      <div class="video-frame">
        <video ref="video" playsinline muted autoplay aria-label="Предпросмотр камеры"/>
      </div>
      <div class="action-row">
        <button type="button" :disabled="!!stream||starting" @click="openCamera">Включить камеру</button>
        <button type="button"
          :disabled="!stream||starting||busy||(typeof route.query.assignmentId==='string'&&!!route.query.assignmentId&&selectedAssignment!==route.query.assignmentId)"
          @click="capture">
          {{ busy ? 'Шифрование…' : 'Сделать снимок' }}
        </button>
        <button type="button" :disabled="!stream&&!starting" @click="closeCamera">Отключить</button>
      </div>
      <p class="muted">В системную медиатеку снимок не записывается. Сначала сохраняется только ciphertext; синхронизация выполняется отдельно.</p>
    </template>
    <p v-if="message" role="status" class="status-text">{{ message }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
