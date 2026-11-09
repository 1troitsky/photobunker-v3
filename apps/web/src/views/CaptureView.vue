<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
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
async function refreshPolicies():Promise<void> {
  const identity=activeSession.value
  if(!identity){policies.value=[];selectedAssignment.value='';return}
  if(policyLoading.value)return
  policyLoading.value=true
  policyNotice.value=''
  try{
    if(identity.online && navigator.onLine){
      try{await listServerAssignments()}
      catch{policyNotice.value='Не удалось обновить политики. Используются ранее проверенные.'}
    }
    const found=await listVerifiedCapturePolicies()
    if(activeSession.value!==identity)return
    policies.value=found
    const requested=route.query.assignmentId
    const preferred=typeof requested==='string'?requested:selectedAssignment.value
    selectedAssignment.value=found.some(x=>x.assignmentId===preferred)?preferred:''
    if(typeof requested==='string'&&requested&&!selectedAssignment.value)
      policyNotice.value='Для этого задания нет проверенной политики. Съёмка по нему заблокирована.'
  }catch(e){
    policyNotice.value=e instanceof Error?e.message:'assignment.policies_unavailable'
  }finally{policyLoading.value=false}
}

const stream=ref<MediaStream|null>(null)
const busy=ref(false)
const message=ref('')
const error=ref('')
let starting=false
let disposed=false

async function openCamera():Promise<void> {
  if(starting||stream.value||disposed)return
  error.value=''
  if(!activeSession.value){error.value='Сначала создайте или восстановите аккаунт';return}
  if(!navigator.mediaDevices?.getUserMedia){error.value='Браузер не поддерживает камеру';return}
  starting=true
  const identity=activeSession.value
  let opened:MediaStream|null=null
  try{
    opened=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280}},
    })
    await nextTick()
    // A late camera permission response cannot attach to a removed screen or account.
    if(disposed||activeSession.value!==identity||!video.value){
      opened.getTracks().forEach(track=>track.stop())
      return
    }
    stream.value=opened
    video.value.srcObject=opened
    await video.value.play()
  }catch(e){
    if(opened)opened.getTracks().forEach(track=>track.stop())
    if(stream.value===opened)stream.value=null
    error.value=e instanceof Error?e.message:'camera.unavailable'
  }finally{starting=false}
}
function closeCamera():void {
  stream.value?.getTracks().forEach(track=>track.stop())
  stream.value=null
  if(video.value)video.value.srcObject=null
}
async function capture():Promise<void> {
  const v=video.value
  if(busy.value||!v||!stream.value||v.videoWidth<1||v.videoHeight<1)return
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
    const photo=await captureEncrypted(jpeg,binding)
    message.value='Зашифровано и сохранено локально: '+photo.photoId.slice(0,8)
  }catch(e){error.value=e instanceof Error?e.message:'camera.capture_failed'}
  finally{busy.value=false}
}
// Restoring a trusted device after a page load is asynchronous. The camera
// must also start when that local identity appears, not just on first mount.
watch(activeSession,session=>{
  if(!session){closeCamera();policies.value=[];selectedAssignment.value='';return}
  void refreshPolicies()
  void nextTick().then(()=>{if(!stream.value&&!starting)void openCamera()})
},{flush:'post'})
onMounted(()=>{
  if(activeSession.value){void refreshPolicies();void nextTick().then(openCamera)}
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
        <button type="button" :disabled="!!stream" @click="openCamera">Включить камеру</button>
        <button type="button"
          :disabled="!stream||busy||(typeof route.query.assignmentId==='string'&&!!route.query.assignmentId&&selectedAssignment!==route.query.assignmentId)"
          @click="capture">
          {{ busy ? 'Шифрование…' : 'Сделать снимок' }}
        </button>
        <button type="button" :disabled="!stream" @click="closeCamera">Отключить</button>
      </div>
      <p class="muted">В системную медиатеку снимок не записывается. Сначала сохраняется только ciphertext; синхронизация выполняется отдельно.</p>
    </template>
    <p v-if="message" role="status" class="status-text">{{ message }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
