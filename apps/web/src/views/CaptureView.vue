<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { activeSession, type Session } from '../features/identity/application/session'
import { captureEncrypted } from '../features/photo-sync/application/p1-photo'
import { enqueueEncryptedMedia } from '../features/media/application/media-outbox'
import type { MediaCaptureIntent } from '../features/media/application/media-outbox'
import { MAX_MEDIA_BYTES } from '../features/media/domain/media-crypto'
import type { GPSFix } from '../features/photo-sync/domain/capture-metadata'
import { parseRulesCsv } from '../features/assignments/domain/advanced-rules'
import {
  listAllServerAssignments, listVerifiedCapturePolicies, signedCaptureBinding,
  assertNoVerifiedAssignmentRemoval,
  signedMediaCaptureIntent,signedAllowedAssignmentMedia,
  signedPolicyRequirements,signedMediaRequirements,signedAdvancedRequirements,
  readCachedPrivateAssignment,assignmentPrivateCacheScope,verifySignedAssignmentPolicy,
} from '../features/assignments/application/assignment-outbox'
import type { AssignmentListing } from '../features/assignments/application/assignment-outbox'
import type { PrivateAssignment } from '../features/assignments/infrastructure/assignment-crypto'

const route=useRoute()
const video=ref<HTMLVideoElement|null>(null)
const policies=ref<AssignmentListing[]>([])
const selectedAssignment=ref('')
// Volatile display only; decrypt from account-scoped, signed-revision-bound AEAD cache.
const assignmentPrivate=ref<PrivateAssignment|null>(null)
const assignmentPrivateScope=ref('')
const privateInstructionState=ref<'none'|'loading'|'ready'|'unavailable'>('none')
/**
 * Bind volatile plaintext to the account, selected assignment and EXACT
 * already verified signed private revision. A Vue selection change must not
 * show another assignment's text even for one render before its watcher runs.
 */
const visiblePrivateInstructions=computed(()=>{
  const session=activeSession.value
  const row=policies.value.find(p=>p.assignmentId===selectedAssignment.value)
  if(!session||!row||!assignmentPrivate.value)return null
  const expected=session.accountId+'|'+row.assignmentId+'|'+assignmentPrivateCacheScope(row)
  return assignmentPrivateScope.value===expected?assignmentPrivate.value:null
})
let instructionGeneration=0
const captureMode=ref<'photo'|'video'|'audio'>('photo')
// Explicit migration path; legacy P1 photo remains the default until P2
// camera/photo cross-account release is accepted by the product owner.
const photoStorage=ref<'p1'|'p2'>('p1')
const currentMediaInstruction=computed(()=>{
  const value=visiblePrivateInstructions.value
  if(!canCaptureType.value||value?.version!==2)return ''
  return captureMode.value==='photo'?value.photoInstructions
    :captureMode.value==='video'?value.videoInstructions:value.audioInstructions
})
async function loadPrivateInstructions():Promise<void>{
  const version=++instructionGeneration
  assignmentPrivate.value=null
  assignmentPrivateScope.value=''
  const id=selectedAssignment.value
  const row=policies.value.find(p=>p.assignmentId===id)
  if(!id||!row){privateInstructionState.value='none';return}
  const identity=cameraIdentity(activeSession.value)
  // Private instructions belong to the identity/assignment/revision, not
  // the camera track generation. Mode changes and Stop release hardware
  // without invalidating an otherwise current in-flight cache decrypt.
  const current=()=>!disposed
    &&sameIdentity(identity,cameraIdentity(activeSession.value))
    &&version===instructionGeneration&&selectedAssignment.value===id
  privateInstructionState.value='loading'
  try{
    // The cached summary is AEAD-only, account-scoped and bound to the
    // CURRENT independently verified private revision (never older plaintext).
    await verifySignedAssignmentPolicy(row,true)
    const data=await readCachedPrivateAssignment(id,assignmentPrivateCacheScope(row))
    if(!current())return
    assignmentPrivate.value=data
    assignmentPrivateScope.value=data
      ?activeSession.value!.accountId+'|'+id+'|'+assignmentPrivateCacheScope(row)
      :''
    privateInstructionState.value=data?'ready':'unavailable'
  }catch{
    if(current()){
      assignmentPrivate.value=null
      assignmentPrivateScope.value=''
      privateInstructionState.value='unavailable'
    }
  }
}
const recording=ref(false)
const recordLimitMs=175000
const recorder=shallowRef<MediaRecorder|null>(null)
const recordingStartedAt=ref<number|null>(null)
let recordingTimer:ReturnType<typeof setTimeout>|null=null
let recordingParts:Blob[]=[]
let recordedSize=0
let activeRecording:{saveOnStop:boolean}|null=null
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
  return policy?(captureMode.value==='photo'
    ?signedPolicyRequirements(policy)
    :signedMediaRequirements(policy,captureMode.value)):null
})
const requiredAdvanced=computed(()=>{
  const policy=policies.value.find(p=>p.assignmentId===selectedAssignment.value)
  return policy?signedAdvancedRequirements(policy,captureMode.value):null
})
// Volatile capture form. These values never enter IndexedDB in plaintext.
const category=ref('')
const description=ref('')
const privateTags=ref('')
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
      try{await listAllServerAssignments()}
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
    void loadPrivateInstructions()
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
  // Any new request, cancel, account/device/assignment/mode change or teardown
  // invalidates both previous GPS consent and every pending callback.
  gpsAttempt++
  gps.value=null
  gpsLoading.value=false
  gpsError.value=''
}

/**
 * A browser permission is a live capability, NOT a property of a historical
 * GPS fix. Checking is passive: this never requests location or prompts.
 * Unsupported/throwing Permissions API is unknown, never implicit granted.
 */
async function gpsPermission():Promise<PermissionState|'unknown'>{
  try{
    if(!navigator.permissions?.query)return 'unknown'
    return (await navigator.permissions.query({name:'geolocation'})).state
  }catch{return 'unknown'}
}
/** Consent check at shutter and again at the actual encryption boundary. */
async function consentedGPS(fix:GPSFix|null):Promise<GPSFix|null>{
  if(!fix)return null
  const attempt=gpsAttempt
  // Preserve the existing signed-policy stale-fix error; it can never be
  // persisted because normalizeGPS rejects it before encryption.
  if(Date.now()-fix.recordedAt>120000)return fix
  const permission=await gpsPermission()
  if(gpsAttempt!==attempt||gps.value!==fix||disposed)return null
  if(permission!=='granted'){
    clearGPS()
    gpsError.value='camera.gps_permission_required'
    return null
  }
  return fix
}
/** After owner policy signing, never persist an older GPS consent snapshot. */
async function requireLiveGPS(fix:GPSFix|null):Promise<void>{
  if(!fix)return
  if(await consentedGPS(fix)!==fix)
    throw Error('camera.gps_permission_revoked')
}
async function obtainGPS():Promise<void>{
  // Retry must immediately erase the old location even if this attempt fails
  // or the browser never invokes the geolocation error callback.
  clearGPS()
  const current=activeSession.value
  if(!current){gpsError.value='Сначала создайте или восстановите аккаунт';return}
  if(!navigator.geolocation){gpsError.value='Геолокация недоступна';return}
  const generation=cameraGeneration,identity=cameraIdentity(current)
  const assignment=selectedAssignment.value
  const attempt=++gpsAttempt
  gpsLoading.value=true;gpsError.value=''
  try{
    // Explicit user action only. Never start a background location watcher.
    const point=await new Promise<GeolocationPosition>((resolve,reject)=>{
      navigator.geolocation.getCurrentPosition(resolve,reject,{
        enableHighAccuracy:true,maximumAge:0,timeout:12000,
      })
    })
    if(attempt!==gpsAttempt||!ownsCamera(identity,generation)
      ||selectedAssignment.value!==assignment)return
    const permission=await gpsPermission()
    if(attempt!==gpsAttempt||!ownsCamera(identity,generation)
      ||selectedAssignment.value!==assignment)return
    // A previous fix cannot be reaccepted after permission revocation.
    // A genuinely stale provider value may still be displayed; the existing
    // metadata validator will reject it, preserving the stale-fix test gate.
    if(permission!=='granted'&&Date.now()-point.timestamp<=120000)
      throw Error('camera.gps_permission_required')
    gps.value={
      latitude:point.coords.latitude,longitude:point.coords.longitude,
      accuracyMeters:point.coords.accuracy,recordedAt:Math.round(point.timestamp),
    }
  }catch(e){
    if(attempt===gpsAttempt&&ownsCamera(identity,generation)
      &&selectedAssignment.value===assignment){
      gps.value=null
      gpsError.value=e instanceof Error?e.message:'camera.gps_unavailable'
    }
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
    // Snapshot values BEFORE recording. Both policy preflight and AES-GCM
    // metadata encryption use these values, never mutable form state.
    const privateFields={
      category:category.value,description:description.value,
      gps:await consentedGPS(gps.value),
      tags:parseRulesCsv(privateTags.value,12,48),
    }
    if(!ownsCamera(identity,generation))throw Error('camera.identity_changed')
    // Snapshot verified owner policy BEFORE acquiring any recording bytes.
    // MediaFile v1 stays opaque; an independent account-signed capture
    // sidecar will later bind its exact ciphertext manifest digest.
    const intent=selectedAssignment.value
      ?await signedMediaCaptureIntent(
        selectedAssignment.value,mode,startedAt,privateFields)
      :undefined
    await requireLiveGPS(privateFields.gps)
    if(!ownsCamera(identity,generation)||captureMode.value!==mode
      ||(intent&&selectedAssignment.value!==intent.assignmentId))
      throw Error('camera.identity_changed')
    const mime=mediaMime(mode)
    const streamRef=stream.value
    if(!streamRef)throw Error('camera.stream_unavailable')
    const worker=new MediaRecorder(streamRef,{mimeType:mime})
    const token={identity,generation,mode,intent,startedAt,mime,
      privateFields,saveOnStop:false}
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
        closeCamera()
      }
    }
    worker.onerror=()=>{error.value='camera.recording_failed';closeCamera()}
    worker.onstop=()=>{
      if(activeRecording!==token)return
      // Automatic browser/permission interruption is never permission to
      // persist a partial recording. Only user Stop or the bounded timer
      // may turn this ephemeral MediaRecorder buffer into a new MediaFile.
      if(!token.saveOnStop){closeCamera();return}
      if(recordingTimer!==null){clearTimeout(recordingTimer);recordingTimer=null}
      const parts=recordingParts
      recordingParts=[]
      recorder.value=null;recording.value=false;recordingStartedAt.value=null
      activeRecording=null
      const bytes=recordedSize;recordedSize=0
      // MediaRecorder.stop() by itself does NOT release the hardware.
      // Release microphone and camera immediately before encryption; a
      // second recording requires the explicit "Включить камеру" action.
      if(stream.value===streamRef){
        stopTracks(streamRef)
        stream.value=null;streamIdentity=null
        if(video.value)video.value.srcObject=null
        cameraWanted=false
      }
      void (async()=>{
        if(!ownsCamera(identity,generation)||captureMode.value!==mode
          ||(intent&&selectedAssignment.value!==intent.assignmentId))return
        busy.value=true
        try{
          if(bytes<128||bytes>MAX_MEDIA_BYTES)
            throw Error('media.invalid_size')
          // A formerly valid signed recording claim must not outlive a
          // newly verified local removal while MediaRecorder was active.
          if(token.intent)
            await assertNoVerifiedAssignmentRemoval(token.intent.assignmentId)
          // A permission revoked while recording never permits attaching its
          // old coordinates. Drop this recording rather than reinterpret the
          // already signed owner policy with a different metadata snapshot.
          await requireLiveGPS(token.privateFields.gps)
          if(!ownsCamera(identity,generation))return
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
          const id=await enqueueEncryptedMedia(file,capture,token.privateFields)
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
      if(activeRecording===token&&worker.state==='recording'){
        token.saveOnStop=true
        worker.stop()
      }
    },recordLimitMs)
  }catch(e){
    discardRecording()
    if(ownsCamera(identity,generation))
      error.value=e instanceof Error?e.message:'camera.recording_failed'
  }finally{busy.value=false}
}
function endRecording():void{
  const worker=recorder.value
  if(worker&&worker.state==='recording'){
    if(activeRecording)activeRecording.saveOnStop=true
    worker.stop()
  }
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
  const assignmentAtCapture=selectedAssignment.value
  const storageAtCapture=photoStorage.value
  const startedAt=Date.now()
  busy.value=true;error.value='';message.value=''
  try{
    if(captureMode.value!=='photo')throw Error('camera.photo_mode_changed')
    // Snapshot private fields at shutter click, before asynchronous JPEG
    // rendering. User edits during toBlob cannot silently change evidence.
    const privateFields={
      category:category.value,description:description.value,
      gps:await consentedGPS(gps.value),
      tags:parseRulesCsv(privateTags.value,12,48),
    }
    assertOwner()
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
    const capturedAt=startedAt
    // Recheck AFTER potentially asynchronous JPEG encoding, before the
    // signed assignment binding freezes any private GPS field.
    privateFields.gps=await consentedGPS(privateFields.gps)
    assertOwner()
    // The policy binding and encrypted metadata use the SAME fields
    // frozen at shutter click, not values edited while Canvas ran.
    const binding=assignmentAtCapture
      ?await signedCaptureBinding(assignmentAtCapture,capturedAt,privateFields)
      :undefined
    await requireLiveGPS(privateFields.gps)
    assertOwner()
    if(captureMode.value!=='photo'
      ||selectedAssignment.value!==assignmentAtCapture
      ||photoStorage.value!==storageAtCapture)
      throw Error('camera.capture_context_changed')
    if(storageAtCapture==='p2'){
      const intent:MediaCaptureIntent|undefined=binding
        ?{
          assignmentId:binding.assignmentId,
          ownerAccountId:binding.ownerAccountId,
          contributorAccountId:activeSession.value!.accountId,
          policyRevision:binding.policyRevision,policyHash:binding.policyHash,
          mediaType:'photo',startedAt:capturedAt,
          finishedAt:Math.max(Date.now(),capturedAt+1),
        }:undefined
      const file=new File([jpeg],
        'capture-'+new Date(capturedAt).toISOString()+'.jpg',
        {type:'image/jpeg',lastModified:capturedAt})
      const mediaId=await enqueueEncryptedMedia(file,intent,privateFields)
      assertOwner()
      message.value='P2 JPEG зашифрован в Media Library: '+mediaId.slice(0,8)
    }else{
      const photo=await captureEncrypted(jpeg,binding,privateFields)
      assertOwner()
      message.value='Зашифровано и сохранено локально: '+photo.photoId.slice(0,8)
    }
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
    ++instructionGeneration;assignmentPrivate.value=null
    assignmentPrivateScope.value=''
    privateInstructionState.value='none'
    category.value='';description.value='';privateTags.value='';clearGPS()
    message.value='';error.value=''
  }
  if(!session)return
  void refreshPolicies()
  void nextTick().then(startCamera)
},{flush:'sync'})
onMounted(()=>{
  if(activeSession.value){void refreshPolicies();void nextTick().then(startCamera)}
})
watch(selectedAssignment,()=>{
  clearGPS()
  void loadPrivateInstructions()
})
watch(()=>route.query.assignmentId,()=>{
  clearGPS()
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
onUnmounted(()=>{
  disposed=true;++instructionGeneration;assignmentPrivate.value=null
  assignmentPrivateScope.value=''
  privateInstructionState.value='none';closeCamera()
})
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
        <div v-if="captureMode==='photo'">
          <label for="camera-photo-storage">Сохранить фото в</label>
          <select id="camera-photo-storage" v-model="photoStorage"
            :disabled="busy||recording" data-testid="camera-photo-storage">
            <option value="p1">P1 — зашифрованное фото (по умолчанию)</option>
            <option value="p2">P2 — Media Library JPEG</option>
          </select>
          <p v-if="photoStorage==='p2'" class="muted">
            Снимок сохраняется сразу в зашифрованный MediaFile без системной
            галереи. Для задания версия правил и время съёмки подписываются
            аккаунтом исполнителя. Это заявление клиента, не аппаратная
            проверка камеры или достоверности GPS.
          </p>
        </div>
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
        <div v-if="selectedAssignment" class="camera-private-instructions"
          data-testid="camera-private-instructions">
          <template v-if="privateInstructionState==='ready'&&visiblePrivateInstructions">
            <h3>Зашифрованные инструкции задания</h3>
            <p v-if="visiblePrivateInstructions.instructions" class="muted">
              Общие: {{ visiblePrivateInstructions.instructions }}
            </p>
            <p v-if="currentMediaInstruction" data-testid="camera-media-instruction"
              class="muted">
              {{ captureMode==='photo'?'Для фото':captureMode==='video'?'Для видео':'Для аудио' }}:
              {{ currentMediaInstruction }}
            </p>
            <p v-else class="muted">Отдельных инструкций для выбранного типа нет.</p>
          </template>
          <p v-else-if="privateInstructionState==='loading'" role="status" class="muted">
            Расшифровка инструкций…
          </p>
          <p v-else class="muted" role="status">
            Приватные инструкции недоступны в проверенном кэше.
            Откройте карточку задания, чтобы проверить и расшифровать их.
          </p>
        </div>
        <p v-if="captureMode!=='photo'" class="muted">
          Видео и аудио доступны только если владелец подписал разрешение
          соответствующего типа. Подтверждение записи связывается с
          версией правил и зашифрованным MediaFile; время — заявление
          устройства, не аппаратная аттестация.
        </p>
        <p v-if="requiredFields" role="status" class="muted" data-testid="camera-media-requirements">
          Подписанные требования: категория {{ requiredFields.requiredCategory?'обязательна':'необязательна' }},
          описание минимум {{ requiredFields.descriptionMinLength }} символов,
          GPS {{ requiredFields.requiredGps?'обязателен':'необязателен' }}.
        </p>
        <p v-if="requiredAdvanced" class="muted" data-testid="camera-advanced-rules">
          Категории (публичный список правил): {{ requiredAdvanced.allowedCategories.join(', ')||'любые' }};
          обязательные теги: {{ requiredAdvanced.requiredTags.join(', ')||'нет' }}.
        </p>
      </div>
      <div class="foundation-card">
        <h2>Приватная информация {{ captureMode==='photo'?'снимка':captureMode==='video'?'видео':'аудио' }}</h2>
        <label for="camera-category">Категория</label>
        <input id="camera-category" v-model="category" type="text" maxlength="64"
          autocomplete="off" placeholder="Например, репортаж">
        <label for="camera-description">Описание</label>
        <textarea id="camera-description" v-model="description" maxlength="4000"
          rows="3" placeholder="Приватное описание (необязательно)"/>
        <label for="camera-tags">Теги (через запятую)</label>
        <input id="camera-tags" v-model="privateTags" type="text" autocomplete="off"
          data-testid="camera-tags" placeholder="например, репортаж, событие" maxlength="600">
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
          :disabled="!stream||starting||busy||gpsLoading||!canCaptureType"
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
