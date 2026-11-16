<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {cameraShellActions,clearCameraShellActions}
  from '../features/media/application/camera-shell-actions'
import {
  changeCameraPreset,defaultCameraPresetCatalog,loadCameraPresetCatalog,
} from '../features/media/application/camera-presets'
import type {
  CameraPhotoAspect,CameraPhotoQuality,CameraVideoQuality,CameraPresetSettings,
} from '../features/media/application/camera-presets'
import {cameraPhotoFormat} from '../features/media/domain/camera-photo-format'
import { activeSession, type Session } from '../features/identity/application/session'
import { captureEncrypted } from '../features/photo-sync/application/p1-photo'
import { enqueueEncryptedMedia } from '../features/media/application/media-outbox'
import {
  appendEncryptedRecordingSegment,createEncryptedRecordingDraft,
  deleteEncryptedRecordingDraft,interruptEncryptedRecordingDraft,
  listEncryptedRecordingDrafts,purgeExpiredEncryptedRecordingDrafts,
  readEncryptedRecordingForPrivateReview,recoverAbandonedEncryptedRecordingDraft,
  readCompletedEncryptedRecording,sealEncryptedRecordingDraft,
} from '../features/media/application/recording-encrypted-journal'
import type { MediaCaptureIntent } from '../features/media/application/media-outbox'
import {acquireCameraWriterLease,type CameraWriterLease} from '../features/media/application/recording-writer-lease'
import { MAX_MEDIA_BYTES } from '../features/media/domain/media-crypto'
import {assertRecordingDuration, signedRecordingBudget} from '../features/media/domain/recording-limits'
import {AUDIO_TARGET_BITRATES, DEFAULT_AUDIO_TARGET_BITRATE, recordingOptions} from '../features/media/domain/recording-options'
import type {AudioTargetBitrate} from '../features/media/domain/recording-options'
import { normalizeGPS, type GPSFix } from '../features/photo-sync/domain/capture-metadata'
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
const cameraHeaderOwner={}
const blindMode=ref(false)
const cameraSheet=ref<'assignment'|'settings'|null>(null)
const cameraFacing=ref<'environment'|'user'>('environment')
const torchOn=ref(false)
const desiredTorch=ref(false)
const torchBusy=ref(false)
// Expose only true hardware zoom, never a CSS-only simulated crop.
const cameraZoomRange=ref<{min:number;max:number;step:number}|null>(null)
const cameraZoom=ref(1)
const desiredPhotoZoom=ref(1)
const cameraZoomBusy=ref(false)
const permissionBusy=ref(false)
const devicePermissionStatus=ref('')
const gridVisible=ref(false)
const gpsStatusVisible=ref(true)
const desiredGpsTracking=ref(false)
const photoAspect=ref<CameraPhotoAspect>('4:3')
const photoQuality=ref<CameraPhotoQuality>('high')
const videoQuality=ref<CameraVideoQuality>('720p')
const videoAudioEnabled=ref(true)
const videoMaxSeconds=ref(300)
const audioMaxSeconds=ref(3000)
const cameraPresetCatalog=ref(defaultCameraPresetCatalog())
const selectedPresetId=ref('default')
const presetName=ref('По умолчанию')
const presetBusy=ref(false)
const presetNotice=ref('')
let presetLoadGeneration=0
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
// Device encoder target: the browser may choose a different effective bitrate.
const audioTargetBitrate=ref<AudioTargetBitrate>(DEFAULT_AUDIO_TARGET_BITRATE)
// A late IndexedDB read must NOT overwrite a user-touched setting (especially
// the P2 E2EE destination) or a newer on-device preset write.
let presetUiEpoch=0
let applyingCameraPreset=false
watch([
  photoAspect,photoQuality,photoStorage,videoQuality,videoAudioEnabled,
  videoMaxSeconds,audioMaxSeconds,audioTargetBitrate,gridVisible,
  gpsStatusVisible,desiredGpsTracking,desiredPhotoZoom,desiredTorch,
  selectedPresetId,presetName,
],()=>{if(!applyingCameraPreset)presetUiEpoch++},{flush:'sync'})
function cameraSettingsSnapshot():CameraPresetSettings {
  return {
    photoAspect:photoAspect.value,photoQuality:photoQuality.value,
    photoStorage:photoStorage.value,videoQuality:videoQuality.value,
    videoAudioEnabled:videoAudioEnabled.value,
    videoMaxSeconds:videoMaxSeconds.value,audioMaxSeconds:audioMaxSeconds.value,
    audioTargetBitrate:audioTargetBitrate.value,
    gridVisible:gridVisible.value,gpsStatusVisible:gpsStatusVisible.value,
    photoZoom:desiredPhotoZoom.value,torchEnabled:desiredTorch.value,
    gpsTrackingEnabled:desiredGpsTracking.value,
  }
}
function applyCameraPreset(settings:CameraPresetSettings):void {
  applyingCameraPreset=true
  try{
    photoAspect.value=settings.photoAspect
    photoQuality.value=settings.photoQuality
    photoStorage.value=settings.photoStorage
    videoQuality.value=settings.videoQuality
    videoAudioEnabled.value=settings.videoAudioEnabled
    videoMaxSeconds.value=settings.videoMaxSeconds
    audioMaxSeconds.value=settings.audioMaxSeconds
    audioTargetBitrate.value=settings.audioTargetBitrate
    gridVisible.value=settings.gridVisible
    gpsStatusVisible.value=settings.gpsStatusVisible
    desiredPhotoZoom.value=settings.photoZoom
    desiredTorch.value=settings.torchEnabled
    // A saved preference is NOT a geolocation grant: only an explicit user
    // click may start the GPS watcher or show a checked real tracking state.
    desiredGpsTracking.value=settings.gpsTrackingEnabled
  }finally{applyingCameraPreset=false}
}
async function reloadCameraPresets():Promise<void>{
  const session=activeSession.value,generation=++presetLoadGeneration
  // A cryptographic identity switch retires the old pending mutation UI.
  presetBusy.value=false
  const defaults=defaultCameraPresetCatalog()
  cameraPresetCatalog.value=defaults
  selectedPresetId.value=defaults.selectedId
  presetName.value=defaults.presets[0]!.name
  presetNotice.value=''
  applyCameraPreset(defaults.presets[0]!.settings)
  const beforeRead=presetUiEpoch
  if(!session)return
  try{
    const found=await loadCameraPresetCatalog()
    if(!sameIdentity(cameraIdentity(session),cameraIdentity(activeSession.value))
      ||generation!==presetLoadGeneration)return
    cameraPresetCatalog.value=found
    // User input during an IndexedDB read owns the current visible values.
    // Keep loaded encrypted presets available without overwriting those edits.
    if(presetUiEpoch!==beforeRead)return
    applyingCameraPreset=true
    try{
      selectedPresetId.value=found.selectedId
      const chosen=found.presets.find(p=>p.id===found.selectedId)!
      presetName.value=chosen.name
      applyCameraPreset(chosen.settings)
      void applyCameraHardwarePreferences()
    }finally{applyingCameraPreset=false}
  }catch(e){
    if(sameIdentity(cameraIdentity(session),cameraIdentity(activeSession.value))
      &&generation===presetLoadGeneration)
      presetNotice.value='Не удалось прочитать зашифрованные пресеты: '
        +(e instanceof Error?e.message:'camera.preset_unavailable')
  }
}
async function pickCameraPreset():Promise<void>{
  if(!activeSession.value||recording.value||busy.value||presetBusy.value)return
  const session=activeSession.value,id=selectedPresetId.value
  const chosen=cameraPresetCatalog.value.presets.find(p=>p.id===id)
  const generation=++presetLoadGeneration // Retire stale A→B→A actions.
  if(!chosen)return
  presetBusy.value=true;presetNotice.value=''
  try{
    const next=await changeCameraPreset({kind:'select',id})
    if(generation!==presetLoadGeneration
      ||!sameIdentity(cameraIdentity(session),cameraIdentity(activeSession.value)))return
    cameraPresetCatalog.value=next
    presetName.value=chosen.name
    applyCameraPreset(chosen.settings)
    void applyCameraHardwarePreferences()
    presetNotice.value=chosen.settings.gpsTrackingEnabled
      ?'Пресет выбран. Для GPS подтвердите разрешение кнопкой «Определить координаты».'
      :'Пресет выбран. Параметры камеры применены при поддержке устройства.'
  }catch(e){
    if(generation===presetLoadGeneration
      &&sameIdentity(cameraIdentity(session),cameraIdentity(activeSession.value))){
      selectedPresetId.value=cameraPresetCatalog.value.selectedId
      presetNotice.value=e instanceof Error?e.message:'camera.preset_unavailable'
    }
  }finally{
    if(generation===presetLoadGeneration
      &&sameIdentity(cameraIdentity(session),cameraIdentity(activeSession.value)))
      presetBusy.value=false
  }
}
async function writeCameraPreset(kind:'add'|'save'):Promise<void>{
  if(!activeSession.value||recording.value||busy.value||presetBusy.value)return
  const session=activeSession.value,name=presetName.value
  const settings=cameraSettingsSnapshot(),id=selectedPresetId.value
  const generation=++presetLoadGeneration // Retire stale A→B→A actions.
  presetBusy.value=true;presetNotice.value=''
  try{
    const next=await changeCameraPreset(kind==='add'
      ?{kind:'add',name,settings}:{kind:'save',id,name,settings})
    if(generation!==presetLoadGeneration
      ||!sameIdentity(cameraIdentity(session),cameraIdentity(activeSession.value)))return
    cameraPresetCatalog.value=next
    selectedPresetId.value=next.selectedId
    presetName.value=next.presets.find(p=>p.id===next.selectedId)!.name
    presetNotice.value='Пресет зашифрован и сохранён на этом устройстве.'
  }catch(e){
    if(generation===presetLoadGeneration
      &&sameIdentity(cameraIdentity(session),cameraIdentity(activeSession.value)))
      presetNotice.value=e instanceof Error?e.message:'camera.preset_unavailable'
  }finally{
    if(generation===presetLoadGeneration
      &&sameIdentity(cameraIdentity(session),cameraIdentity(activeSession.value)))
      presetBusy.value=false
  }
}
// Identity-bound preset reload is registered after cameraIdentity helpers.
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
type LocalRecordingDraft=Awaited<ReturnType<typeof listEncryptedRecordingDrafts>>[number]
const localDrafts=ref<LocalRecordingDraft[]>([])
const privateReviewUrl=ref<string|null>(null)
const privateReviewKind=ref<'audio'|'video'|null>(null)
const privateReviewId=ref<string|null>(null)
const localDraftError=ref('')
let privateReviewEpoch=0
function closePrivateRecordingReview():void {
  privateReviewEpoch++
  const url=privateReviewUrl.value
  privateReviewUrl.value=null
  privateReviewKind.value=null
  privateReviewId.value=null
  if(url)URL.revokeObjectURL(url)
}
async function refreshLocalRecordingDrafts(pruneExpired=false):Promise<void>{
  const identity=cameraIdentity(activeSession.value)
  if(!identity){localDrafts.value=[];return}
  try{
    if(pruneExpired){
      // Bounded, local-only GC per activation: at most 100 expired drafts.
      // Each batch rechecks the active account/key and never touches MediaFile.
      for(let batch=0;batch<4;batch++){
        const purged=await purgeExpiredEncryptedRecordingDrafts(25)
        if(purged<25)break
      }
    }
    const found=await listEncryptedRecordingDrafts()
    if(!disposed&&sameIdentity(identity,cameraIdentity(activeSession.value))){
      // Active drafts may belong to an open recorder in another tab. Never
      // expose an in-progress plaintext preview or provide a destructive UI.
      localDrafts.value=found.filter(r=>r.state==='interrupted'||r.state==='complete'
        ||(r.state==='writing'&&r.recoveryAvailable))
      localDraftError.value=''
    }
  }catch{
    if(!disposed&&sameIdentity(identity,cameraIdentity(activeSession.value))){
      localDrafts.value=[]
      localDraftError.value='camera.recording_draft_unavailable'
    }
  }
}
async function reviewPrivateRecordingDraft(id:string):Promise<void>{
  if(recording.value||busy.value||!localDrafts.value.some(
    row=>row.recordingId===id&&row.state!=='writing'))return
  closePrivateRecordingReview()
  const reviewEpoch=privateReviewEpoch
  const identity=cameraIdentity(activeSession.value)
  localDraftError.value=''
  try{
    const blob=await readEncryptedRecordingForPrivateReview(id)
    if(disposed||reviewEpoch!==privateReviewEpoch
      ||!sameIdentity(identity,cameraIdentity(activeSession.value)))return
    const entry=localDrafts.value.find(row=>row.recordingId===id)
    if(!entry||entry.state==='writing')return
    const url=URL.createObjectURL(blob)
    if(disposed||reviewEpoch!==privateReviewEpoch
      ||!sameIdentity(identity,cameraIdentity(activeSession.value))){
      URL.revokeObjectURL(url)
      return
    }
    privateReviewKind.value=entry.kind
    privateReviewUrl.value=url
    privateReviewId.value=id
  }catch{
    if(!disposed&&reviewEpoch===privateReviewEpoch
      &&sameIdentity(identity,cameraIdentity(activeSession.value)))
      localDraftError.value='camera.recording_review_unavailable'
  }
}
async function checkAbandonedPrivateRecordingDraft(id:string):Promise<void>{
  if(recording.value||busy.value||!localDrafts.value.some(
    row=>row.recordingId===id&&row.state==='writing'&&row.recoveryAvailable))return
  const identity=cameraIdentity(activeSession.value)
  localDraftError.value=''
  try{
    await recoverAbandonedEncryptedRecordingDraft(id)
    if(!disposed&&sameIdentity(identity,cameraIdentity(activeSession.value)))
      await refreshLocalRecordingDrafts()
  }catch(e){
    if(!disposed&&sameIdentity(identity,cameraIdentity(activeSession.value)))
      localDraftError.value=e instanceof Error?e.message:'camera.recording_recovery_unavailable'
  }
}
async function removePrivateRecordingDraft(id:string):Promise<void>{
  if(recording.value||busy.value||!localDrafts.value.some(
    row=>row.recordingId===id&&row.state!=='writing'))return
  if(!window.confirm('Удалить зашифрованные фрагменты этой записи с устройства?'))return
  const identity=cameraIdentity(activeSession.value)
  if(privateReviewId.value===id)closePrivateRecordingReview()
  try{
    await deleteEncryptedRecordingDraft(id)
    if(!disposed&&sameIdentity(identity,cameraIdentity(activeSession.value)))
      await refreshLocalRecordingDrafts()
  }catch{
    if(!disposed&&sameIdentity(identity,cameraIdentity(activeSession.value)))
      localDraftError.value='camera.recording_delete_failed'
  }
}
const recording=ref(false)
const recordingMaxSeconds=computed(()=>captureMode.value==='photo'?0
  :captureMode.value==='video'?videoMaxSeconds.value:audioMaxSeconds.value)
const recorder=shallowRef<MediaRecorder|null>(null)
const recordingStartedAt=ref<number|null>(null)
const recordingClock=ref(Date.now())
let recordingClockTimer:ReturnType<typeof setInterval>|null=null
const recordingElapsed=computed(()=>recording.value&&recordingStartedAt.value!==null
  ?Math.max(0,Math.floor((recordingClock.value-recordingStartedAt.value)/1000)):0)
watch(recording,nowRecording=>{
  if(recordingClockTimer!==null){clearInterval(recordingClockTimer);recordingClockTimer=null}
  if(nowRecording){
    recordingClock.value=Date.now()
    recordingClockTimer=setInterval(()=>{recordingClock.value=Date.now()},1000)
  }
})
let recordingTimer:ReturnType<typeof setTimeout>|null=null
// Keep only bounded, queued native chunks in RAM. All durable draft parts
// are AEAD ciphertext before IndexedDB writes; never persist raw MediaRecorder blobs.
const MAX_PENDING_CLEAR_BYTES=16*1024*1024
let recordedSize=0
type RecordingTicket={
  saveOnStop:boolean;startedMono:number;stoppedMono:number|null
  finishedAt:number|null;draftId:string;writeTail:Promise<void>
  nextIndex:number;pendingBytes:number;writeError:Error|null
  writerLease:CameraWriterLease|null
}
let activeRecording:RecordingTicket|null=null
let releaseRecordingTrackListeners:(()=>void)|null=null
function detachRecordingTrackListeners():void {
  releaseRecordingTrackListeners?.()
  releaseRecordingTrackListeners=null
}
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
const gpsTracking=ref(false)
let gpsWatcherId:number|null=null
let captureContextGeneration=0
let gpsAttempt=0
let gpsPermission:PermissionStatus|null=null
let cancelGPSRequest:(()=>void)|null=null
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
let releaseCaptureTrackListeners:()=>void=()=>{}
const torchSupported=computed(()=>{
  if(captureMode.value==='audio'||!stream.value)return false
  const track=stream.value.getVideoTracks?.()[0]
  if(!track||track.readyState!=='live'||!track.getCapabilities)return false
  try{
    return (track.getCapabilities() as MediaTrackCapabilities & {torch?:boolean}).torch===true
  }catch{return false}
})
const busy=ref(false)
// Keyed flash animation matches the approved viewfinder without any
// plaintext screenshot, gallery write or timer that can outlive the camera.
const photoFlashRevision=ref(0)
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
// An online/offline hydration of the SAME cryptographic device must never
// overwrite a user's already edited media destination or in-flight presets.
let observedPresetIdentity:CameraIdentity=null
watch(activeSession,session=>{
  const identity=cameraIdentity(session)
  if(sameIdentity(observedPresetIdentity,identity)
    ||observedPresetIdentity===null&&identity===null)return
  observedPresetIdentity=identity
  void reloadCameraPresets()
},{immediate:true})
let observedIdentity=cameraIdentity(activeSession.value)
let streamIdentity:CameraIdentity=null
function ownsCamera(identity:CameraIdentity,generation:number):boolean {
  return !disposed && cameraGeneration===generation
    &&sameIdentity(identity,cameraIdentity(activeSession.value))
}
function discardRecording():void {
  detachRecordingTrackListeners()
  const ticket=activeRecording
  const old=recorder.value
  recorder.value=null
  activeRecording=null
  recording.value=false
  recordingStartedAt.value=null
  recordedSize=0
  // Cancellation/revocation can never become an authorized signed MediaFile.
  // Only already encrypted, successfully written parts remain as interrupted
  // private scratch for later EXPLICIT salvage policy, not automatic playback.
  if(ticket)void ticket.writeTail.then(async()=>{
    try{await interruptEncryptedRecordingDraft(ticket.draftId)}catch{
      // Lost identity/key/expiry must fail closed. Scratch is not published.
    }
    void refreshLocalRecordingDrafts()
    ticket.writerLease?.release()
  }).catch(()=>ticket.writerLease?.release())
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
  // A stream ended by the OS is not an intentional user Stop. Retire its
  // listeners before stopping any remaining tracks or clearing the preview.
  releaseCaptureTrackListeners()
  releaseCaptureTrackListeners=()=>{}
  torchOn.value=false
  torchBusy.value=false
  cameraZoomRange.value=null
  cameraZoom.value=1
  cameraZoomBusy.value=false
  discardRecording()
  if(stream.value)stopTracks(stream.value)
  stream.value=null;streamIdentity=null
  if(video.value)video.value.srcObject=null
}

function flipCamera():void {
  if(!activeSession.value||captureMode.value==='audio'||recording.value
    ||busy.value||starting.value)return
  cameraFacing.value=cameraFacing.value==='environment'?'user':'environment'
  closeCamera()
  cameraWanted=true
  void nextTick().then(startCamera)
}
/** Only available on live tracks that report a genuine zoom capability. */
function refreshHardwareZoom(track:MediaStreamTrack|undefined):void{
  cameraZoomRange.value=null
  cameraZoom.value=1
  if(!track||track.readyState!=='live'||!track.getCapabilities)return
  try{
    const caps=track.getCapabilities() as MediaTrackCapabilities & {
      zoom?:{min:number;max:number;step?:number}
    }
    const zoom=caps.zoom
    if(!zoom||!Number.isFinite(zoom.min)||!Number.isFinite(zoom.max)
      ||zoom.min<=0||zoom.max<=zoom.min||zoom.max>200)return
    // Approved Camera 1.2 exposes 1×–3×, but never fabricates a sensor
    // control outside what the live native hardware itself reports.
    const min=Math.max(1,zoom.min),max=Math.min(3,zoom.max)
    if(max<=min)return
    const step=typeof zoom.step==='number'&&Number.isFinite(zoom.step)
      &&zoom.step>0&&zoom.step<=max-min?zoom.step:0.1
    const actual=(track.getSettings?.() as MediaTrackSettings & {zoom?:number}|undefined)?.zoom
    cameraZoomRange.value={min,max,step}
    cameraZoom.value=typeof actual==='number'&&Number.isFinite(actual)
      ?Math.max(min,Math.min(max,actual)):min
  }catch{cameraZoomRange.value=null}
}
/**
 * Camera 1.2 stores hardware preferences in device-key-encrypted presets.
 * Only a live native track can confirm zoom/torch. Never fake capability,
 * turn on GPS, or retry a rejected camera permission through this path.
 */
async function applyCameraHardwarePreferences():Promise<void>{
  const identity=streamIdentity,generation=cameraGeneration
  const track=stream.value?.getVideoTracks?.()[0]
  if(!track||track.readyState!=='live'||!ownsCamera(identity,generation)
    ||recording.value||busy.value)return
  const ownsTrack=()=>ownsCamera(identity,generation)
    &&stream.value?.getVideoTracks?.()[0]===track&&track.readyState==='live'
  const range=cameraZoomRange.value
  if(captureMode.value==='photo'&&range&&!cameraZoomBusy.value){
    const target=Math.max(range.min,Math.min(range.max,desiredPhotoZoom.value))
    if(Math.abs(target-cameraZoom.value)>=0.00001){
      cameraZoomBusy.value=true
      try{
        await track.applyConstraints({advanced:[{zoom:target}]} as unknown as MediaTrackConstraints)
        if(ownsTrack())cameraZoom.value=target
      }catch{
        if(ownsTrack())error.value='Не удалось применить масштаб из пресета.'
      }finally{if(ownsTrack())cameraZoomBusy.value=false}
    }
  }
  if(!ownsTrack()||torchBusy.value||!torchSupported.value
    ||torchOn.value===desiredTorch.value)return
  torchBusy.value=true
  try{
    await track.applyConstraints({
      advanced:[{torch:desiredTorch.value}],
    } as unknown as MediaTrackConstraints)
    if(ownsTrack())torchOn.value=desiredTorch.value
  }catch{
    if(ownsTrack())error.value='Фонарик из пресета недоступен на этой камере.'
  }finally{if(ownsTrack())torchBusy.value=false}
}
async function setCameraZoom(event:Event):Promise<void>{
  const control=event.target
  const range=cameraZoomRange.value
  if(!(control instanceof HTMLInputElement)||!range||cameraZoomBusy.value
    ||captureMode.value!=='photo'||recording.value||busy.value||starting.value)return
  const desired=Number(control.value)
  const track=stream.value?.getVideoTracks?.()[0]
  const identity=streamIdentity,generation=cameraGeneration
  if(!Number.isFinite(desired)||desired<range.min||desired>range.max
    ||!track||track.readyState!=='live'||!ownsCamera(identity,generation))return
  if(Math.abs(desired-cameraZoom.value)<0.00001)return
  cameraZoomBusy.value=true
  try{
    await track.applyConstraints({advanced:[{zoom:desired}]} as unknown as MediaTrackConstraints)
    if(ownsCamera(identity,generation)&&track===stream.value?.getVideoTracks?.()[0]){
      cameraZoom.value=desired
      desiredPhotoZoom.value=Math.min(3,Math.max(1,desired))
    }
  }catch{
    if(ownsCamera(identity,generation)&&track===stream.value?.getVideoTracks?.()[0]){
      control.value=String(cameraZoom.value)
      error.value='Не удалось применить масштаб камеры.'
    }
  }finally{
    if(ownsCamera(identity,generation)&&track===stream.value?.getVideoTracks?.()[0])
      cameraZoomBusy.value=false
  }
}
/** Light is a real track capability, not a simulated UI toggle. */
async function toggleTorch():Promise<void>{
  if(!activeSession.value||!torchSupported.value||torchBusy.value
    ||recording.value||busy.value||starting.value)return
  const session=cameraIdentity(activeSession.value),generation=cameraGeneration
  const track=stream.value?.getVideoTracks?.()[0]
  if(!track||track.readyState!=='live')return
  const next=!torchOn.value
  torchBusy.value=true
  try{
    await track.applyConstraints({
      advanced:[{torch:next}],
    } as unknown as MediaTrackConstraints)
    if(ownsCamera(session,generation)&&stream.value?.getVideoTracks?.()[0]===track){
      torchOn.value=next
      desiredTorch.value=next
    }
  }catch{
    if(ownsCamera(session,generation)&&stream.value?.getVideoTracks?.()[0]===track){
      // A failed attempt to turn the torch OFF must not claim that it is off.
      error.value='Фонарик недоступен на этой камере.'
    }
  }finally{
    if(ownsCamera(session,generation)&&stream.value?.getVideoTracks?.()[0]===track)
      torchBusy.value=false
  }
}
async function setTorchFromSettings(event:Event):Promise<void>{
  const input=event.target
  if(!(input instanceof HTMLInputElement))return
  await toggleTorch()
  // Native checkbox clicks toggle before the hardware operation resolves.
  // Restore actual last-confirmed state on rejection or camera replacement.
  if(input.isConnected)input.checked=torchOn.value
}
function toggleBlindMode():void{
  if(!activeSession.value)return
  blindMode.value=!blindMode.value
}
function onBlindKeydown(event:KeyboardEvent):void{
  if(!blindMode.value)return
  if(event.key==='Escape'){
    event.preventDefault()
    toggleBlindMode()
    return
  }
  // The full-screen cover traps keyboard focus inside its real controls.
  // Do not intercept Space/Enter: native button behavior must stay intact.
  if(event.key!=='Tab')return
  const root=document.querySelector<HTMLElement>('[data-testid="camera-blind-overlay"]')
  const enabled=Array.from(root?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[])
  if(!enabled.length)return
  const first=enabled[0]!,last=enabled[enabled.length-1]!
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus()
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus()
  }
}
watch(blindMode,async shown=>{
  await nextTick()
  if(disposed||blindMode.value!==shown)return
  if(shown){
    const shutter=document.querySelector<HTMLButtonElement>('[data-testid="camera-blind-shutter"]')
    ;(shutter?.disabled
      ?document.querySelector<HTMLButtonElement>('.camera-blind-return')
      :shutter)?.focus()
  }else{
    document.querySelector<HTMLButtonElement>('[data-testid="camera-header-blind"]')
      ?.focus()
  }
})
function cameraAssignmentBlockReason():string|null{
  if(!selectedAssignment.value)return null
  if(!canCaptureType.value)return 'Недоступна подтверждённая политика задания'
  const fields=requiredFields.value,advanced=requiredAdvanced.value
  if(fields?.requiredCategory&&!category.value.trim())
    return 'Категория обязательна по правилам задания'
  if(advanced?.allowedCategories.length
    &&!advanced.allowedCategories.includes(category.value))
    return 'Выберите категорию из списка задания'
  if(description.value.trim().length<(fields?.descriptionMinLength??0))
    return 'Заполните описание по правилам задания'
  if(fields?.requiredGps&&!gps.value)
    return 'GPS обязателен по правилам задания'
  let tags:string[]
  try{tags=parseRulesCsv(privateTags.value,12,48)}
  catch{return 'Проверьте теги по правилам задания'}
  if(advanced?.requiredTags.some(tag=>!tags.includes(tag)))
    return 'Добавьте обязательные теги по правилам задания'
  return null
}
const canConfirmCameraAssignment=computed(()=>cameraAssignmentBlockReason()===null)
function openCameraSheet(which:'assignment'|'settings',focusGps=false):void{
  // Match the approved Fieldwork camera: no editing capture/policy metadata
  // while the native recorder owns the stream or a photo is being sealed.
  if(!activeSession.value||recording.value||busy.value)return
  cameraSheet.value=which
  void nextTick().then(()=>{
    if(cameraSheet.value!==which)return
    if(focusGps&&which==='settings')
      document.querySelector<HTMLElement>('[data-testid="camera-gps-settings-status"]')
        ?.scrollIntoView?.({block:'nearest'})
    document.querySelector<HTMLButtonElement>('.camera-sheet-close')?.focus()
  })
}
function trapCameraSheetFocus(event:KeyboardEvent,which:'assignment'|'settings'):void{
  if(cameraSheet.value!==which||event.key!=='Tab')return
  const root=document.querySelector<HTMLElement>(
    '[data-testid="camera-'+which+'-panel"]')
  const controls=Array.from(root?.querySelectorAll<HTMLElement>(
    'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]'
  )??[])
  if(!controls.length)return
  const first=controls[0]!,last=controls[controls.length-1]!
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus()
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus()
  }
}
function closeCameraSheet():void{
  const last=cameraSheet.value
  cameraSheet.value=null
  if(last)void nextTick().then(()=>{
    document.querySelector<HTMLButtonElement>(
      '[data-testid="camera-open-'+last+'"]')?.focus()
  })
}
function finishCameraAssignment():void{
  if(canConfirmCameraAssignment.value)closeCameraSheet()
}
watch([activeSession,captureMode,stream,recording,busy,starting,torchOn,torchBusy,blindMode],
  ()=>{
    cameraShellActions.value={
      owner:cameraHeaderOwner,
      canFlip:!!activeSession.value&&captureMode.value!=='audio'
        &&!recording.value&&!busy.value&&!starting.value,
      canTorch:!!activeSession.value&&torchSupported.value&&!torchBusy.value
        &&!recording.value&&!busy.value&&!starting.value,
      torchOn:torchOn.value,blind:blindMode.value,
      canBlind:!!activeSession.value,
      flip:flipCamera,toggleTorch:()=>{void toggleTorch()},
      toggleBlind:toggleBlindMode,
    }
  },{immediate:true})

/**
 * Explicit browser permission preflight only. The temporary stream is
 * always released; permission success is not proof of future capture
 * rights, sustained hardware access, or persistent OS authorization.
 */
async function requestDevicePermission(which:'camera'|'microphone'):Promise<void>{
  const session=activeSession.value
  if(!session||recording.value||busy.value||starting.value||permissionBusy.value)return
  const identity=cameraIdentity(session)
  if(!navigator.mediaDevices?.getUserMedia){
    devicePermissionStatus.value='Браузер не предоставляет доступ к оборудованию.'
    return
  }
  // A permission grant from another mode may not start a new capture stream.
  const permissionMode=captureMode.value
  permissionBusy.value=true;devicePermissionStatus.value=''
  let temp:MediaStream|null=null,granted=false
  try{
    temp=await navigator.mediaDevices.getUserMedia(which==='camera'
      ?{audio:false,video:{facingMode:{ideal:cameraFacing.value}}}
      :{audio:true,video:false})
    if(disposed||!sameIdentity(identity,cameraIdentity(activeSession.value)))return
    const tracks=temp.getTracks()
    if(tracks.length===0||tracks.some(t=>t.readyState!=='live'))
      throw Error('camera.permission_stream_ended')
    granted=true
    devicePermissionStatus.value=which==='camera'
      ?'Камера доступна для текущей сессии.'
      :'Микрофон доступен для текущей сессии.'
  }catch(e){
    if(!disposed&&sameIdentity(identity,cameraIdentity(activeSession.value)))
      devicePermissionStatus.value=e instanceof Error?e.message:'camera.permission_denied'
  }finally{
    if(temp)stopTracks(temp)
    permissionBusy.value=false
  }
  // The approved UI has ONLY two permission actions inside Camera Settings.
  // They are also the explicit retry after a denied initial camera start.
  // First close the temporary preflight stream; do not race two live cameras.
  const relevant=permissionMode==='photo'?which==='camera'
    :permissionMode==='audio'?which==='microphone'
      :which==='camera'||(videoAudioEnabled.value&&which==='microphone')
  if(granted&&relevant&&!disposed&&captureMode.value===permissionMode
    &&sameIdentity(identity,cameraIdentity(activeSession.value))
    &&!stream.value&&!starting.value)await openCamera()
}
async function openCamera():Promise<void> {
  cameraWanted=true
  await startCamera()
}
async function startCamera():Promise<void> {
  if(starting.value||stream.value||disposed||!cameraWanted)return
  error.value=''
  if(!activeSession.value){error.value='Сначала создайте или восстановите аккаунт';return}
  if(!navigator.mediaDevices?.getUserMedia){
    error.value=captureMode.value==='audio'
      ?'Браузер не поддерживает доступ к микрофону':'Браузер не поддерживает камеру'
    return
  }
  starting.value=true
  const identity=cameraIdentity(activeSession.value),generation=cameraGeneration
  const mode=captureMode.value
  let opened:MediaStream|null=null
  try{
    opened=await navigator.mediaDevices.getUserMedia({
      audio:mode==='audio'||mode==='video'&&videoAudioEnabled.value,
      video:mode!=='audio'
        ?{facingMode:{ideal:cameraFacing.value},
          width:{ideal:mode==='video'
            ?videoQuality.value==='1080p'?1920:videoQuality.value==='480p'?854:1280
            // Request enough native detail for the approved Maximum 1600px
            // JPEG tier even when the user changes quality without restart.
            :1920}}:false,
    })
    await nextTick()
    if(!opened.getTracks().length||opened.getTracks().some(track=>track.readyState!=='live'))
      throw Error('camera.stream_ended')
    if(!cameraWanted||!ownsCamera(identity,generation)||!video.value){
      stopTracks(opened)
      return
    }
    stream.value=opened;streamIdentity=identity
    // Outside a recording, an OS/permission/hardware 'ended' event must
    // discard the stale preview and prevent capture of the last video frame.
    // MediaRecorder has its own fail-closed interruption handlers.
    const tracks=opened.getTracks()
    const onTrackEnded=()=>{
      if(stream.value!==opened||!ownsCamera(identity,generation)
        ||activeRecording||recording.value)return
      error.value=mode==='audio'?'camera.microphone_interrupted':'camera.stream_ended'
      closeCamera() // Explicit user retry only through approved Settings permissions.
    }
    const listened:MediaStreamTrack[]=[]
    for(const track of tracks){
      if(typeof track.addEventListener==='function'){
        track.addEventListener('ended',onTrackEnded)
        listened.push(track)
      }
    }
    releaseCaptureTrackListeners=()=>{
      for(const track of listened)track.removeEventListener('ended',onTrackEnded)
    }
    if(tracks.some(track=>track.readyState!=='live')){
      onTrackEnded()
      return
    }
    torchOn.value=false
    refreshHardwareZoom(mode==='audio'?undefined:opened.getVideoTracks?.()[0])
    if(mode!=='audio')await applyCameraHardwarePreferences()
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
      const errorName=e instanceof Error?e.name:''
      if(mode==='audio'&&['NotAllowedError','PermissionDeniedError','SecurityError'].includes(errorName))
        error.value='camera.microphone_permission_denied'
      else if(mode==='audio'&&['NotFoundError','DevicesNotFoundError'].includes(errorName))
        error.value='camera.microphone_unavailable'
      else error.value=e instanceof Error?e.message:'camera.unavailable'
    }
  }finally{
    starting.value=false
    // Serialize requests. Only an intervening ownership/cancel event can
    // schedule this follow-up; ordinary errors cannot create a retry loop.
    if(cameraWanted && !disposed && cameraGeneration!==generation
      &&activeSession.value && !stream.value)void nextTick().then(startCamera)
  }
}
// GPS tracking is opt-in (or required by a verified signed assignment),
// ephemeral and restricted to this mounted Camera. Geolocation permissions
// are never inferred from a displayed indicator; native callbacks are
// validated and checked again at shutter. No background PWA GPS is promised.
async function readGPSPermission():Promise<PermissionStatus|null>{
  if(!navigator.permissions?.query)return null
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
    return await Promise.race([
      navigator.permissions.query({name:'geolocation'}),
      new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),1000)}),
    ])
  }catch{return null}
  finally{if(timer!==undefined)clearTimeout(timer)}
}
function stopGPSWatcher():void{
  const id=gpsWatcherId
  gpsWatcherId=null
  if(id!==null)navigator.geolocation?.clearWatch?.(id)
}
function startGPSWatcher(identity:CameraIdentity,generation:number,attempt:number):void{
  stopGPSWatcher()
  if(!gpsPermission||gpsPermission.state!=='granted'
    ||!gps.value||!navigator.geolocation?.watchPosition
    ||!(gpsTracking.value||requiredFields.value?.requiredGps))return
  const permission=gpsPermission
  try{
    gpsWatcherId=navigator.geolocation.watchPosition(
      position=>{
        if(attempt!==gpsAttempt||!ownsCamera(identity,generation)
          ||!(gpsTracking.value||requiredFields.value?.requiredGps))return
        if(permission.state!=='granted'){
          gpsTracking.value=false
          clearGPS();gpsError.value='camera.gps_permission_required';return
        }
        if(busy.value||recording.value)return
        const fix={
          latitude:position.coords.latitude,
          longitude:position.coords.longitude,
          accuracyMeters:position.coords.accuracy,
          recordedAt:Math.round(position.timestamp),
        }
        try{normalizeGPS(fix,Date.now());gps.value=fix}
        catch{
          // Invalid hardware update must not replace a previously trusted
          // current fix; shutter independently checks GPS freshness.
          gpsError.value='camera.gps_unavailable'
        }
      },
      failure=>{
        if(attempt!==gpsAttempt||!ownsCamera(identity,generation))return
        if(failure.code===1){
          gpsTracking.value=false
          clearGPS();gpsError.value='camera.gps_permission_required'
        }else gpsError.value='camera.gps_unavailable'
      },
      {enableHighAccuracy:true,maximumAge:0,timeout:12000},
    )
  }catch{gpsError.value='camera.gps_unavailable'}
}
async function toggleGPSTracking():Promise<void>{
  if(!activeSession.value)return
  if(requiredFields.value?.requiredGps){
    // Only a verified signed assignment can force tracking. The switch
    // cannot relax it; a native permission prompt still needs an explicit
    // "Получить GPS" click before coordinates are accepted.
    gpsTracking.value=true
    return
  }
  gpsTracking.value=!gpsTracking.value
  if(!gpsTracking.value){
    desiredGpsTracking.value=false
    clearGPS()
    return
  }
  await obtainGPS()
  if(!gps.value)gpsTracking.value=false
  desiredGpsTracking.value=gpsTracking.value
}
function clearGPS():void {
  gpsAttempt++
  stopGPSWatcher()
  if(gpsPermission)gpsPermission.onchange=null
  gpsPermission=null
  cancelGPSRequest?.();cancelGPSRequest=null
  gps.value=null
  gpsLoading.value=false
  gpsError.value=''
}
function gpsRequestFailure(e:unknown):string{
  // Native GeolocationPositionError is not required to extend Error. Its
  // code 1 is a genuine permission denial, not a generic unavailable sensor.
  // Do not leak browser-specific native error messages into account UI.
  if(e&&typeof e==='object'&&'code' in e&&e.code===1)
    return 'camera.gps_permission_required'
  return e instanceof Error?e.message:'camera.gps_unavailable'
}
async function obtainGPS():Promise<void>{
  // Clear BEFORE requesting, including missing identity/API and pending prompts.
  clearGPS()
  const current=activeSession.value
  if(!current){gpsError.value='Сначала создайте или восстановите аккаунт';return}
  if(!navigator.geolocation){gpsError.value='Геолокация недоступна';return}
  const generation=cameraGeneration,identity=cameraIdentity(current)
  const attempt=gpsAttempt
  const owns=()=>attempt===gpsAttempt&&ownsCamera(identity,generation)
  gpsLoading.value=true
  try{
    const permission=await readGPSPermission()
    if(!owns())return
    gpsPermission=permission
    if(permission)permission.onchange=()=>{
      if(owns()&&permission.state!=='granted'){
        gpsTracking.value=false
        clearGPS();gpsError.value='camera.gps_permission_required'
      }
    }
    // Only this explicit user action can prompt. A native success provides the
    // fix; freshness and live consent are independently checked at shutter.
    const point=await new Promise<GeolocationPosition>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('camera.gps_unavailable')),12000)
      const cancel=()=>{finish();reject(Error('camera.gps_cancelled'))}
      const finish=()=>{
        clearTimeout(timer)
        if(cancelGPSRequest===cancel)cancelGPSRequest=null
      }
      cancelGPSRequest=cancel
      try{
        navigator.geolocation.getCurrentPosition(
          point=>{finish();resolve(point)},failure=>{finish();reject(failure)},
          {enableHighAccuracy:true,maximumAge:0,timeout:12000},
        )
      }catch(e){finish();reject(e)}
    })
    if(!owns())return
    const fix={
      latitude:point.coords.latitude,longitude:point.coords.longitude,
      accuracyMeters:point.coords.accuracy,recordedAt:Math.round(point.timestamp),
    }
    if(permission?.state!=='granted'){
      // A queued native callback cannot resurrect a fresh fix after silent
      // withdrawal. Preserve the existing QA stale-provider display/error
      // contract: invalid fixes still fail normalizeGPS at shutter, never save.
      try{normalizeGPS(fix,Date.now())}
      catch{gps.value=fix;return}
      clearGPS();gpsError.value='camera.gps_permission_required';return
    }
    gps.value=fix
    // Selecting a GPS-enabled encrypted preset is NOT a permission grant.
    // After this separate, explicit hardware consent and live fix, activate
    // the saved tracking preference; never start on preset load alone.
    if(desiredGpsTracking.value&&permission?.state==='granted')
      gpsTracking.value=true
    startGPSWatcher(identity,generation,attempt)
  }catch(e){
    if(owns()){
      clearGPS()
      gpsError.value=gpsRequestFailure(e)
    }
  }finally{
    if(attempt===gpsAttempt)gpsLoading.value=false
  }
}
async function consentedGPS(fix:GPSFix|null,attempt:number,at:number):Promise<GPSFix|null>{
  if(!fix)return null
  // Keep the existing stale/range safety gate even if consent also expired.
  normalizeGPS(fix,at)
  const permission=await readGPSPermission()
  if(attempt!==gpsAttempt||gps.value!==fix)return null
  if(permission?.state!=='granted'){
    gpsTracking.value=false
    clearGPS();gpsError.value='camera.gps_permission_required'
    return null
  }
  if(gpsPermission!==permission){
    if(gpsPermission)gpsPermission.onchange=null
    gpsPermission=permission
    permission.onchange=()=>{
      if(attempt===gpsAttempt&&permission.state!=='granted'){
        gpsTracking.value=false
        clearGPS();gpsError.value='camera.gps_permission_required'
      }
    }
  }
  return fix
}
function assertGPSConsent(fix:GPSFix|null,attempt:number):void{
  if(fix&&(attempt!==gpsAttempt||gps.value!==fix
    ||gpsPermission?.state!=='granted'))throw Error('camera.gps_consent_changed')
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
  const contextGeneration=captureContextGeneration
  if(mode==='photo'||recording.value||busy.value||torchBusy.value||!canCaptureType.value
    ||!stream.value||!ownsCamera(identity,generation))return
  const assertOwner=()=>{
    if(!ownsCamera(identity,generation)||contextGeneration!==captureContextGeneration
      ||captureMode.value!==mode)throw Error('camera.identity_changed')
  }
  busy.value=true;error.value='';message.value=''
  let acquiringLease:CameraWriterLease|null=null
  try{
    const required=route.query.assignmentId
    if(typeof required==='string'&&required&&selectedAssignment.value!==required)
      throw Error('assignment.policy_not_verified')
    const startedAt=Date.now()
    // Snapshot values BEFORE recording. Both policy preflight and AES-GCM
    // metadata encryption use these values, never mutable form state.
    const gpsAtStart=gpsAttempt
    const privateFields={
      category:category.value,description:description.value,gps:gps.value,
      tags:parseRulesCsv(privateTags.value,12,48),
    }
    privateFields.gps=await consentedGPS(privateFields.gps,gpsAtStart,startedAt)
    assertOwner()
    // Snapshot verified owner policy BEFORE acquiring any recording bytes.
    // MediaFile v1 stays opaque; an independent account-signed capture
    // sidecar will later bind its exact ciphertext manifest digest.
    const intent=selectedAssignment.value
      ?await signedMediaCaptureIntent(
        selectedAssignment.value,mode,startedAt,privateFields)
      :undefined
    assertOwner()
    if(intent&&selectedAssignment.value!==intent.assignmentId)
      throw Error('camera.capture_context_changed')
    assertGPSConsent(privateFields.gps,gpsAtStart)
    const mime=mediaMime(mode)
    const streamRef=stream.value
    if(!streamRef)throw Error('camera.stream_unavailable')
    const tracks=streamRef.getTracks()
    if(!tracks.length||tracks.some(track=>track.readyState!=='live'))
      throw Error('camera.stream_ended')
    const worker=new MediaRecorder(streamRef,recordingOptions(
      mode,mime,audioTargetBitrate.value))
    // Create account-key-wrapped journal BEFORE accepting media bytes. Any
    // database/crypto failure refuses to start recording instead of leaving
    // a long-running plaintext-only recording in volatile memory.
    acquiringLease=await acquireCameraWriterLease(activeSession.value!.accountId)
    assertOwner()
    const draftId=await createEncryptedRecordingDraft(mode,mime,acquiringLease)
    assertOwner()
    const token={identity,generation,mode,intent,startedAt,mime,
      privateFields,saveOnStop:false,startedMono:performance.now(),
      stoppedMono:null as number|null,finishedAt:null as number|null,
      draftId,writeTail:Promise.resolve(),nextIndex:0,pendingBytes:0,
      writeError:null as Error|null,writerLease:acquiringLease}
    activeRecording=token
    // Transfer lock lifetime to the recording ticket. Always release only
    // after pending AEAD writes and final E2EE enqueue or interrupt.
    acquiringLease=null
    recordedSize=0
    recorder.value=worker
    // Hardware revoke/interruption can end a track without a MediaRecorder.stop
    // event. Fail closed immediately, never grant upload permission by timeout.
    const onTrackEnded=()=>{
      if(activeRecording!==token)return
      error.value='camera.recording_interrupted'
      closeCamera()
    }
    const listened:MediaStreamTrack[]=[]
    for(const track of tracks){
      if(typeof track.addEventListener==='function'){
        track.addEventListener('ended',onTrackEnded)
        listened.push(track)
      }
    }
    releaseRecordingTrackListeners=()=>{
      for(const track of listened)track.removeEventListener('ended',onTrackEnded)
    }
    if(tracks.some(track=>track.readyState!=='live')){
      onTrackEnded()
      return
    }
    recording.value=true
    recordingStartedAt.value=startedAt
    worker.ondataavailable=event=>{
      if(activeRecording!==token||!event.data.size)return
      const piece=event.data
      recordedSize+=piece.size
      if(recordedSize>MAX_MEDIA_BYTES||piece.size>8*1024*1024
        ||token.pendingBytes+piece.size>MAX_PENDING_CLEAR_BYTES){
        error.value='media.invalid_size'
        closeCamera()
        return
      }
      const index=token.nextIndex++
      token.pendingBytes+=piece.size
      // Explicit single-writer ordering: MediaRecorder callbacks are sync
      // but AES-GCM/IndexedDB are async. A failed commit must not skip an
      // index or allow Stop to publish a partially encrypted recording.
      token.writeTail=token.writeTail.then(async()=>{
        if(token.writeError)return
        await appendEncryptedRecordingSegment(token.draftId,index,piece)
      }).catch(e=>{
        token.writeError=e instanceof Error?e:Error('camera.recording_storage_failed')
        if(activeRecording===token){
          error.value='camera.recording_storage_failed'
          closeCamera()
        }
      }).finally(()=>{token.pendingBytes-=piece.size})
    }
    worker.onerror=()=>{error.value='camera.recording_failed';closeCamera()}
    worker.onstop=()=>{
      if(activeRecording!==token)return
      // Automatic browser/permission interruption is never permission to
      // persist a partial recording. Only user Stop or the bounded timer
      // may turn this ephemeral MediaRecorder buffer into a new MediaFile.
      if(!token.saveOnStop||token.stoppedMono===null||token.finishedAt===null
        ||tracks.some(track=>track.readyState!=='live')){
        error.value='camera.recording_interrupted'
        closeCamera();return
      }
      detachRecordingTrackListeners()
      if(recordingTimer!==null){clearTimeout(recordingTimer);recordingTimer=null}
      recorder.value=null;recording.value=false;recordingStartedAt.value=null
      activeRecording=null
      const bytes=recordedSize;recordedSize=0
      const finishedAt=token.finishedAt
      const durationMs=token.stoppedMono-token.startedMono
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
        busy.value=true
        try{
          // Native final dataavailable may be encrypted AFTER onstop fires;
          // await every ordered ciphertext commit before any signed enqueue.
          await token.writeTail
          if(token.writeError)throw token.writeError
          assertOwner()
          if(bytes<128||bytes>MAX_MEDIA_BYTES)
            throw Error('media.invalid_size')
          // A formerly valid signed recording claim must not outlive a
          // newly verified local removal while MediaRecorder was active.
          if(token.intent)
            await assertNoVerifiedAssignmentRemoval(token.intent.assignmentId)
          if(!ownsCamera(identity,generation))return
          if(finishedAt<=startedAt)throw Error('camera.recording_duration_invalid')
          // Recheck sensitive consent before generic duration failures. A
          // revoked GPS permission must remain a distinct fail-closed reason.
          if(token.privateFields.gps&&await consentedGPS(
            token.privateFields.gps,gpsAtStart,startedAt)!==token.privateFields.gps)
            throw Error('camera.gps_consent_changed')
          assertRecordingDuration(mode,durationMs)
          await sealEncryptedRecordingDraft(token.draftId,durationMs)
          assertOwner()
          // Decrypted bytes only exist in RAM at explicit finalization.
          // Existing MediaFile E2EE encrypts again before durable outbox.
          const recorded=await readCompletedEncryptedRecording(token.draftId)
          assertOwner()
          if(recorded.size!==bytes)throw Error('camera.recording_size_mismatch')
          const suffix=mime.includes('webm')?'webm'
            :mime.includes('ogg')?'ogg':'mp4'
          const file=new File([recorded],
            'recording-'+new Date(startedAt).toISOString()+'.'+suffix,
            {type:mime,lastModified:startedAt})
          const capture:MediaCaptureIntent|undefined=intent
            ?{...intent,finishedAt}:undefined
          const assertCurrent=()=>{
            assertOwner()
            if(intent&&selectedAssignment.value!==intent.assignmentId)
              throw Error('camera.capture_context_changed')
            assertGPSConsent(token.privateFields.gps,gpsAtStart)
          }
          assertCurrent()
          const id=await enqueueEncryptedMedia(file,capture,token.privateFields,assertCurrent)
          // Only after durable signed encrypted MediaFile exists may we GC
          // the scratch ciphertext. A failed GC cannot invalidate success.
          try{await deleteEncryptedRecordingDraft(token.draftId)}catch{}
          void refreshLocalRecordingDrafts()
          if(!ownsCamera(identity,generation))return
          message.value='Запись зашифрована и сохранена локально: '+id.slice(0,8)
        }catch(e){
          // No implicit publication of invalid or interrupted drafts.
          try{await interruptEncryptedRecordingDraft(token.draftId)}catch{}
          void refreshLocalRecordingDrafts()
          if(ownsCamera(identity,generation))
            error.value=e instanceof Error?e.message:'camera.media_failed'
        }finally{
          token.writerLease?.release()
          busy.value=false
        }
      })()
    }
    // Signed intent was captured before async policy/GPS preflight. Reserve
    // enough of its server-visible wall-clock window for both clocks to stay
    // under the same 300s/3000s ceiling when the native max timer fires.
    const stopBudgetMs=Math.min(
      signedRecordingBudget(mode,startedAt,Date.now()),
      (mode==='video'?videoMaxSeconds.value:audioMaxSeconds.value)*1000,
    )
    worker.start(1000)
    recordingTimer=setTimeout(()=>{
      if(activeRecording===token&&worker.state==='recording'){
        token.saveOnStop=true
        token.stoppedMono=performance.now()
        token.finishedAt=Date.now()
        worker.stop()
      }
    },stopBudgetMs)
  }catch(e){
    acquiringLease?.release()
    discardRecording()
    if(ownsCamera(identity,generation))
      error.value=e instanceof Error?e.message:'camera.recording_failed'
  }finally{busy.value=false}
}
function endRecording():void{
  const worker=recorder.value
  if(worker&&worker.state==='recording'){
    if(activeRecording){
      activeRecording.saveOnStop=true
      activeRecording.stoppedMono=performance.now()
      activeRecording.finishedAt=Date.now()
    }
    worker.stop()
  }
}

function closeCamera():void {
  cameraWanted=false;cameraGeneration++
  // Do not replay the previous photo's flash on mode/account changes or
  // after native hardware unexpectedly ends the stream.
  photoFlashRevision.value=0
  clearGPS()
  releaseStream()
}
async function capture():Promise<void> {
  const v=video.value
  const identity=streamIdentity,generation=cameraGeneration
  const liveTracks=()=>{
    const tracks=stream.value?.getTracks()
    return !!tracks?.length&&tracks.every(track=>track.readyState==='live')
  }
  const contextGeneration=captureContextGeneration
  if(busy.value||starting.value||cameraZoomBusy.value||torchBusy.value||!v||!stream.value||!ownsCamera(identity,generation)
    ||!liveTracks()||v.videoWidth<1||v.videoHeight<1)return
  // User-facing form preflight complements (never replaces) signed
  // assignment verification before ciphertext is committed.
  const blocked=cameraAssignmentBlockReason()
  if(blocked){
    message.value='';error.value=blocked
    if(!blindMode.value)openCameraSheet('assignment')
    return
  }
  const assertOwner=()=>{
    if(!cameraWanted||!ownsCamera(identity,generation)
      ||!liveTracks()||contextGeneration!==captureContextGeneration)
      throw new Error('camera.identity_changed')
  }
  const assignmentAtCapture=selectedAssignment.value
  const storageAtCapture=photoStorage.value
  const startedAt=Date.now()
  busy.value=true;error.value='';message.value=''
  try{
    if(captureMode.value!=='photo')throw Error('camera.photo_mode_changed')
    // Snapshot private fields at shutter click, before asynchronous JPEG
    // rendering. User edits during toBlob cannot silently change evidence.
    const gpsAtStart=gpsAttempt
    const privateFields={
      category:category.value,description:description.value,gps:gps.value,
      tags:parseRulesCsv(privateTags.value,12,48),
    }
    privateFields.gps=await consentedGPS(privateFields.gps,gpsAtStart,startedAt)
    assertOwner()
    const format=cameraPhotoFormat(
      v.videoWidth,v.videoHeight,photoAspect.value,photoQuality.value)
    const canvas=document.createElement('canvas')
    canvas.width=format.width;canvas.height=format.height
    const ctx=canvas.getContext('2d')
    if(!ctx)throw new Error('camera.canvas_unavailable')
    ctx.drawImage(v,format.sx,format.sy,format.sw,format.sh,
      0,0,format.width,format.height)
    photoFlashRevision.value++
    const jpeg=await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('camera.jpeg_failed')),
        'image/jpeg',format.jpegQuality)
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
    // The policy binding and encrypted metadata use the SAME fields
    // frozen at shutter click, not values edited while Canvas ran.
    privateFields.gps=await consentedGPS(privateFields.gps,gpsAtStart,startedAt)
    assertOwner()
    const binding=assignmentAtCapture
      ?await signedCaptureBinding(assignmentAtCapture,capturedAt,privateFields)
      :undefined
    assertOwner()
    if(captureMode.value!=='photo'
      ||selectedAssignment.value!==assignmentAtCapture
      ||photoStorage.value!==storageAtCapture)
      throw Error('camera.capture_context_changed')
    const assertCurrent=()=>{
      assertOwner()
      if(captureMode.value!=='photo'||selectedAssignment.value!==assignmentAtCapture
        ||photoStorage.value!==storageAtCapture)throw Error('camera.capture_context_changed')
      assertGPSConsent(privateFields.gps,gpsAtStart)
    }
    assertCurrent()
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
      const mediaId=await enqueueEncryptedMedia(file,intent,privateFields,assertCurrent)
      assertOwner()
      message.value='Зашифровано и сохранено локально: '+mediaId.slice(0,8)
    }else{
      const photo=await captureEncrypted(jpeg,binding,privateFields,assertCurrent)
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
    closePrivateRecordingReview()
    devicePermissionStatus.value=''
    cameraSheet.value=null
    blindMode.value=false;torchOn.value=false
    // Hardware preferences are scoped to the CURRENT encrypted device key.
    // Never reuse prior account's zoom/torch/GPS intent during a key switch.
    desiredPhotoZoom.value=1;desiredTorch.value=false;desiredGpsTracking.value=false
    localDrafts.value=[];localDraftError.value=''
    observedIdentity=identity;cameraGeneration++
    releaseStream()
    policies.value=[];selectedAssignment.value='';policyNotice.value=''
    ++instructionGeneration;assignmentPrivate.value=null
    assignmentPrivateScope.value=''
    privateInstructionState.value='none'
    category.value='';description.value='';privateTags.value=''
    gpsTracking.value=false;clearGPS()
    message.value='';error.value=''
  }
  if(!session)return
  void refreshLocalRecordingDrafts(true)
  void refreshPolicies()
  void nextTick().then(startCamera)
},{flush:'sync'})
function onCameraVisibilityChange():void{
  // Never continue collecting GPS while this PWA is in the background.
  // A future foreground visit requires fresh explicit permission/fix.
  if(document.visibilityState!=='visible'){
    gpsTracking.value=false
    clearGPS()
  }
}
onMounted(()=>{
  document.addEventListener('visibilitychange',onCameraVisibilityChange)
  if(activeSession.value){
    void refreshLocalRecordingDrafts(true)
    void refreshPolicies()
    void nextTick().then(startCamera)
  }
})
watch(selectedAssignment,()=>{
  captureContextGeneration++
  gpsTracking.value=false
  clearGPS()
  if(recording.value)discardRecording()
  void loadPrivateInstructions()
},{flush:'sync'})
watch(()=>route.query.assignmentId,()=>{
  captureContextGeneration++
  gpsTracking.value=false
  clearGPS()
  if(recording.value)discardRecording()
  void refreshPolicies()
},{flush:'sync'})
watch(videoAudioEnabled,()=>{
  // Disabling video sound must revoke an already active microphone track;
  // a note about "next session" would otherwise create false privacy.
  if(disposed||!activeSession.value||captureMode.value!=='video'
    ||recording.value||busy.value)return
  closeCamera()
  cameraWanted=true
  void nextTick().then(startCamera)
})
watch(captureMode,()=>{
  gpsTracking.value=false
  clearGPS()
  closePrivateRecordingReview()
  closeCamera()
  if(!disposed&&activeSession.value){
    cameraWanted=true
    void nextTick().then(startCamera)
  }
})
onUnmounted(()=>{
  document.removeEventListener('visibilitychange',onCameraVisibilityChange)
  gpsTracking.value=false
  clearGPS()
  cameraSheet.value=null
  clearCameraShellActions(cameraHeaderOwner)
  if(recordingClockTimer!==null){clearInterval(recordingClockTimer);recordingClockTimer=null}
  closePrivateRecordingReview()
  disposed=true;++instructionGeneration;assignmentPrivate.value=null
  assignmentPrivateScope.value=''
  privateInstructionState.value='none';closeCamera()
})
</script>

<template>
  <section class="foundation-content camera-fieldwork" data-testid="camera-fieldwork">
    <h1 class="camera-screen-title">Камера</h1>
    <div v-if="!activeSession" class="foundation-card">
      <p>Для съёмки нужен анонимный аккаунт.</p>
      <RouterLink to="/settings">Создать или восстановить аккаунт</RouterLink>
    </div>
    <template v-else>
      <nav class="camera-mode-tabs" aria-label="Режим съёмки" data-testid="camera-mode-tabs">
        <button v-for="mode in (['photo','video','audio'] as const)" :key="mode"
          type="button" :aria-pressed="captureMode===mode"
          :class="{selected:captureMode===mode}"
          :data-testid="'camera-mode-tab-'+mode"
          :disabled="recording||busy||starting" @click="captureMode=mode">
          {{mode==='photo'?'Фото':mode==='video'?'Видео':'Аудио'}}
        </button>
      </nav>
      <div class="camera-stage" data-testid="camera-stage">
      <div class="camera-viewfinder" data-testid="camera-viewfinder"
        :class="{'is-audio':captureMode==='audio'}"
        :style="{aspectRatio:captureMode==='audio'?'auto':photoAspect.replace(':',' / ')}">
        <!-- Keep the video node and active stream mounted beneath blind mode. -->
        <div class="video-frame" v-show="captureMode!=='audio'">
          <video ref="video" playsinline muted autoplay aria-label="Предпросмотр камеры"/>
        </div>
        <!-- Camera 1.2 fixed corner guides belong only to visual media;
             they do not alter or appear in the encrypted JPEG itself. -->
        <template v-if="captureMode!=='audio'">
          <i class="camera-finder-corner tl" aria-hidden="true"></i>
          <i class="camera-finder-corner tr" aria-hidden="true"></i>
          <i class="camera-finder-corner bl" aria-hidden="true"></i>
          <i class="camera-finder-corner br" aria-hidden="true"></i>
        </template>
        <div v-if="photoFlashRevision>0&&captureMode==='photo'"
          :key="photoFlashRevision" class="camera-snap-flash" aria-hidden="true"
          data-testid="camera-snap-flash"></div>
        <div v-if="recording&&captureMode==='video'"
          class="camera-record-badge" data-testid="camera-record-badge">
          <span class="camera-record-dot" aria-hidden="true"></span>
          <time>{{Math.floor(recordingElapsed/60).toString().padStart(2,'0')}}:{{(recordingElapsed%60).toString().padStart(2,'0')}}</time>
        </div>
        <span v-if="captureMode==='photo'&&cameraZoomRange&&cameraZoom>1.01"
          class="camera-photo-zoom-indicator" data-testid="camera-zoom-indicator">
          {{cameraZoom.toFixed(1)}}×
        </span>
        <div v-if="captureMode==='photo'&&gridVisible"
          class="camera-grid-3x3" aria-hidden="true" data-testid="camera-grid">
          <span></span><span></span><span></span><span></span>
        </div>
        <div v-if="captureMode==='audio'" class="camera-audio-view"
          :class="{recording}" data-testid="camera-audio-view" aria-label="Диктофон">
          <span class="camera-audio-emblem" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.6" aria-hidden="true">
              <rect x="9" y="2" width="6" height="13" rx="3"/>
              <path d="M5 11a7 7 0 0 0 14 0M12 18v4m-5 0h10"/>
            </svg>
          </span>
          <div class="camera-audio-bars" aria-hidden="true">
            <i v-for="n in 9" :key="n"></i>
          </div>
          <strong>Диктофон</strong>
          <small>Только аудио, без видеозаписи</small>
          <time v-if="recording" data-testid="camera-audio-time">
            {{Math.floor(recordingElapsed/60).toString().padStart(2,'0')}}:{{(recordingElapsed%60).toString().padStart(2,'0')}}
          </time>
        </div>
        <!-- The approved blind cover obscures the WHOLE app, not only the
             video surface. Teleport leaves MediaStream/MediaRecorder untouched. -->
        <Teleport to="body">
        <div v-if="blindMode" class="camera-blind-overlay" data-testid="camera-blind-overlay" role="dialog" aria-modal="true" aria-label="Слепой режим" @keydown="onBlindKeydown">
          <span class="camera-blind-emblem" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.15" aria-hidden="true">
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/>
              <circle cx="12" cy="12" r="3"/><path d="m3 3 18 18"/>
            </svg>
          </span>
          <h2>Слепой режим</h2>
          <p>Что-бы другие не видели, что вы делаете 👻</p>
          <time v-if="recording" data-testid="camera-blind-time">
            {{Math.floor(recordingElapsed/60).toString().padStart(2,'0')}}:{{(recordingElapsed%60).toString().padStart(2,'0')}}
          </time>
          <button v-if="captureMode==='photo'" type="button" class="camera-blind-shutter"
            data-testid="camera-blind-shutter" aria-label="Сделать снимок"
            :disabled="!stream||starting||busy||cameraZoomBusy||torchBusy||gpsLoading||!canCaptureType"
            @click="capture">Снять</button>
          <button v-else-if="!recording" type="button" class="camera-blind-shutter video"
            data-testid="camera-blind-shutter"
            :disabled="!stream||starting||busy||cameraZoomBusy||torchBusy||gpsLoading||!canCaptureType"
            @click="beginRecording">Начать запись</button>
          <button v-else type="button" class="camera-blind-shutter recording"
            data-testid="camera-blind-shutter" @click="endRecording">Остановить запись</button>
          <p class="camera-blind-note">Если клавиши громкости недоступны — нажмите кнопку</p>
          <button type="button" class="camera-blind-return"
            @click="toggleBlindMode">Вернуться назад</button>
        </div>
        </Teleport>
      </div>
      <!-- The approved Camera toast is part of the preview stage, never
           another row below the 124px capture controls / fixed Dock. -->
      <p v-if="message" role="status" class="camera-toast" data-testid="camera-capture-feedback">{{message}}</p>
      <p v-if="error" role="alert" class="camera-toast camera-toast-error" data-testid="camera-capture-error">{{error}}</p>
      </div>
      <div class="camera-stage-controls" data-testid="camera-stage-controls" v-show="!blindMode">
        <div v-if="gpsStatusVisible"
          class="camera-gps-indicator" data-testid="camera-gps-indicator">
          <button type="button" class="camera-gps-pill"
            data-testid="camera-gps-pill" aria-label="Открыть настройки GPS"
            :disabled="recording||busy" @click="openCameraSheet('settings',true)">
            <span class="camera-gps-dot" :class="{ready:!!gps}" aria-hidden="true"></span>
            <span>{{gps?'GPS ±'+Math.round(gps.accuracyMeters)+' м'
              :gpsLoading?'GPS: поиск…'
              :gpsError?'GPS недоступен'
              :(!gpsTracking&&!requiredFields?.requiredGps)?'GPS выключен':'GPS: ожидание'}}</span>
          </button>
        </div>
        <div class="camera-control-trio">
          <button type="button" class="camera-side-action" data-testid="camera-open-assignment"
            :disabled="recording||busy" @click="openCameraSheet('assignment')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="3" width="16" height="18" rx="2"/>
              <path d="M8 9h8M8 14h8"/>
            </svg><strong>Задание</strong>
          </button>
          <button v-if="captureMode==='photo'" type="button" class="camera-shutter"
            aria-label="Сделать снимок"
            :disabled="!stream||starting||busy||cameraZoomBusy||torchBusy||gpsLoading||!canCaptureType" @click="capture">
              <span class="camera-shutter-fill" aria-hidden="true"></span>
              <span class="camera-screen-title">Сделать снимок</span>
            </button>
          <button v-else-if="!recording" type="button"
            class="camera-shutter camera-shutter-record"
            data-testid="camera-start-recording" aria-label="Начать запись"
            :disabled="!stream||starting||busy||cameraZoomBusy||torchBusy||gpsLoading||!canCaptureType"
            @click="beginRecording">
              <span class="camera-shutter-fill" aria-hidden="true"></span>
              <span class="camera-screen-title">Начать запись {{captureMode==='video'?'видео':'аудио'}}</span>
            </button>
          <button v-else type="button" class="camera-shutter camera-shutter-record active"
            data-testid="camera-stop-recording" aria-label="Остановить запись"
            @click="endRecording">
              <span class="camera-shutter-fill" aria-hidden="true"></span>
              <span class="camera-screen-title">Остановить запись</span>
            </button>
          <button type="button" class="camera-side-action" data-testid="camera-open-settings"
            :disabled="recording||busy" @click="openCameraSheet('settings')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="m19.4 15.1 1.2 1.4-2.1 2.1-1.5-1a8 8 0 0 1-2 .9l-.4 1.9h-3l-.5-1.9a8 8 0 0 1-2-.9l-1.6 1-2-2 1.1-1.5a8 8 0 0 1-.8-2L4 12.6v-3l1.9-.5a8 8 0 0 1 .8-2L5.6 5.6l2-2 1.6 1.1a8 8 0 0 1 2-.8l.5-1.9h3l.4 1.9a8 8 0 0 1 2 .8l1.5-1.1 2.1 2-1.2 1.5a8 8 0 0 1 .8 2l1.9.5v3l-1.9.5a8 8 0 0 1-.9 2z"/>
            </svg><strong>Настройки</strong>
          </button>
        </div>
      </div>
      <div v-if="cameraSheet" class="camera-sheet-backdrop"
        data-testid="camera-sheet-backdrop" @click="closeCameraSheet"></div>
      <div class="camera-details" v-show="cameraSheet!==null" data-testid="camera-details">
        <div v-show="cameraSheet==='settings'" class="foundation-card camera-config-card"
          :class="{'is-camera-sheet':cameraSheet==='settings'}"
          data-testid="camera-settings-panel"
          :role="cameraSheet==='settings'?'dialog':undefined"
          :aria-modal="cameraSheet==='settings'?'true':undefined"
          :aria-label="cameraSheet==='settings'?'Настройки камеры':undefined"
          @keydown.esc.stop.prevent="closeCameraSheet"
          @keydown.tab="trapCameraSheetFocus($event,'settings')">
          <span v-if="cameraSheet==='settings'" class="camera-sheet-handle" aria-hidden="true"></span>
          <header v-if="cameraSheet==='settings'" class="camera-sheet-heading">
            <strong>Настройки камеры</strong>
            <button type="button" class="camera-sheet-close"
              data-testid="camera-sheet-close" aria-label="Закрыть настройки"
              @click="closeCameraSheet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <path d="M5 5 19 19M19 5 5 19"/>
              </svg>
            </button>
          </header>
          <h2 v-else>Настройки камеры</h2>
          <section class="camera-preset-section" data-testid="camera-presets">
            <h3>Пресеты камеры</h3>
            <label for="camera-preset-select">Выбрать пресет</label>
            <select id="camera-preset-select" v-model="selectedPresetId"
              data-testid="camera-preset-select"
              :disabled="presetBusy||busy||recording" @change="pickCameraPreset">
              <option v-for="preset in cameraPresetCatalog.presets"
                :key="preset.id" :value="preset.id">{{preset.name}}</option>
            </select>
            <label for="camera-preset-name">Название пресета</label>
            <input id="camera-preset-name" v-model="presetName" maxlength="36"
              autocomplete="off" :disabled="presetBusy||busy||recording"
              data-testid="camera-preset-name">
            <div class="camera-preset-actions">
              <button type="button" data-testid="camera-preset-save"
                :disabled="presetBusy||busy||recording||!presetName.trim()"
                @click="writeCameraPreset('save')">Сохранить пресет</button>
              <button type="button" data-testid="camera-preset-add"
                :disabled="presetBusy||busy||recording||!presetName.trim()"
                @click="writeCameraPreset('add')">Добавить пресет</button>
            </div>
            <p v-if="presetNotice" data-testid="camera-preset-status"
              role="status" class="muted">{{presetNotice}}</p>
            <p class="muted">Пресеты шифруются на этом устройстве. 
              Не содержат GPS, названия заданий или данных съёмки.</p>
          </section>

        <section class="camera-preset-options" aria-label="Фото">
          <h3>Фото</h3>
          <label for="camera-photo-aspect">Пропорции</label>
          <select id="camera-photo-aspect" v-model="photoAspect" :disabled="busy||recording"
            data-testid="camera-photo-aspect">
            <option value="1:1">1:1</option>
            <option value="4:3">4:3</option>
            <option value="3:2">3:2</option>
            <option value="16:9">16:9</option>
          </select>
          <label for="camera-photo-quality">Качество фото</label>
          <select id="camera-photo-quality" v-model="photoQuality" :disabled="busy||recording"
            data-testid="camera-photo-quality">
            <option value="maximum">Максимальное</option>
            <option value="high">Высокое</option>
            <option value="medium">Среднее</option>
            <option value="low">Низкое</option>
          </select>
          <template v-if="cameraZoomRange&&captureMode==='photo'">
            <label for="camera-photo-zoom">Масштаб: {{cameraZoom.toFixed(1)}}×</label>
            <input id="camera-photo-zoom" type="range" data-testid="camera-photo-zoom"
              :min="cameraZoomRange.min" :max="cameraZoomRange.max"
              :step="cameraZoomRange.step" :value="cameraZoom"
              :disabled="cameraZoomBusy||busy||recording||starting"
              @change="setCameraZoom">
          </template>
          <p v-else class="muted" data-testid="camera-photo-zoom-unavailable">
            Масштаб доступен только при поддержке подключённой камеры.
          </p>
        <label class="camera-appearance-setting">
          <input type="checkbox" v-model="gridVisible" data-testid="camera-grid-setting">
          Сетка кадрирования 3х3
          <small>Не показывается на готовых кадрах.</small>
        </label>
          <label class="camera-appearance-setting">
            <input type="checkbox" data-testid="camera-photo-torch"
              :checked="torchOn"
              :disabled="!torchSupported||torchBusy||busy||recording||starting"
              @change="setTorchFromSettings">
            Фонарик
            <small v-if="!torchSupported">Доступен только при поддержке подключённой камеры.</small>
          </label>
        </section>
        <section class="camera-preset-options" aria-label="Видео">
          <h3>Видео</h3>
          <label for="camera-video-quality">Качество видео</label>
          <select id="camera-video-quality" v-model="videoQuality"
            :disabled="busy||recording||starting" data-testid="camera-video-quality">
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
          <p class="muted">Разрешение запрашивается при следующем включении камеры.
            Фактическое разрешение зависит от устройства.</p>
          <label class="camera-appearance-setting">
            <input type="checkbox" v-model="videoAudioEnabled"
              :disabled="busy||recording||starting" data-testid="camera-video-audio">
            Записывать звук в видео
            <small>При отключении микрофон освобождается; для аудио требуется отдельное разрешение.</small>
          </label>
          <label for="camera-video-duration">
            Максимальная длительность видео: {{videoMaxSeconds}} сек.
          </label>
          <input id="camera-video-duration" v-model.number="videoMaxSeconds"
            type="range" min="5" max="300" step="5" :disabled="busy||recording"
            data-testid="camera-video-duration">
        </section>
        <section class="camera-preset-options" aria-label="Аудио">
          <h3>Аудио</h3>
          <label for="camera-audio-bitrate">Качество аудио</label>
          <select id="camera-audio-bitrate" v-model.number="audioTargetBitrate"
            :disabled="recording||busy" data-testid="camera-audio-bitrate">
            <option v-for="rate in AUDIO_TARGET_BITRATES" :key="rate" :value="rate">
              {{ rate/1000 }} кбит/с
            </option>
          </select>
          <label for="camera-audio-duration">
            Максимальная длительность аудио: {{audioMaxSeconds}} сек.
          </label>
          <input id="camera-audio-duration" v-model.number="audioMaxSeconds"
            type="range" min="5" max="3000" step="5" :disabled="busy||recording"
            data-testid="camera-audio-duration">
          <p class="muted">Аудио записывается без видеопотока. Фактический битрейт зависит от браузера и кодека.</p>
        </section>
        <section class="camera-preset-options" data-testid="camera-geolocation-section">
          <h3>Геолокация</h3>
        <label class="camera-appearance-setting">
          <input type="checkbox" data-testid="camera-gps-tracking"
            :checked="gpsTracking||!!requiredFields?.requiredGps"
            :disabled="!!requiredFields?.requiredGps||gpsLoading||busy||recording"
            @change="toggleGPSTracking">
          Отслеживать GPS
          <small>Только после разрешения пользователя. На iOS PWA
            фоновое отслеживание не гарантируется.</small>
        </label>
        <p v-if="requiredFields?.requiredGps" class="muted"
          data-testid="camera-gps-required">
          Отслеживание геолокации требуется подписанными правилами задания.
          Для получения координат нажмите «Получить GPS».
        </p>
        <label class="camera-appearance-setting">
          <input type="checkbox" v-model="gpsStatusVisible" data-testid="camera-gps-visibility">
          Показывать GPS над кнопкой «Снять»
          <small>Только видимость индикатора; не изменяет GPS-согласие и требования задания.</small>
        </label>
        <p v-if="desiredGpsTracking&&!gpsTracking&&!gps" class="muted"
          data-testid="camera-preset-gps-consent">
          Для GPS из пресета требуется новое разрешение. Нажмите «Определить координаты».
        </p>
        <div class="camera-gps-state" data-testid="camera-gps-settings-status">
          <p role="status">{{gps?'GPS · ±'+Math.round(gps.accuracyMeters)+' м':'GPS не получен'}}</p>
          <button type="button" :disabled="gpsLoading||busy||recording"
            @click="obtainGPS">{{gpsLoading?'Определяем…':'Определить координаты'}}</button>
        </div>
        </section>
        <section class="camera-preset-options" data-testid="camera-permissions">
          <h3>Разрешения устройства</h3>
          <div class="camera-preset-actions">
            <button type="button" data-testid="camera-permission-camera"
              :disabled="permissionBusy||busy||recording||starting"
              @click="requestDevicePermission('camera')">Разрешить камеру</button>
            <button type="button" data-testid="camera-permission-microphone"
              :disabled="permissionBusy||busy||recording||starting"
              @click="requestDevicePermission('microphone')">Разрешить микрофон</button>
          </div>
          <p class="muted">Камера нужна для фото и видео; микрофон — для аудио и видео со звуком.
            Браузер запросит разрешение отдельно.</p>
          <p v-if="devicePermissionStatus" role="status"
            data-testid="camera-permission-status">{{devicePermissionStatus}}</p>
        </section>

        </div>
        <div v-show="cameraSheet==='assignment'" class="foundation-card camera-assignment-card"
          :class="{'is-camera-sheet':cameraSheet==='assignment'}"
          data-testid="camera-assignment-panel"
          :role="cameraSheet==='assignment'?'dialog':undefined"
          :aria-modal="cameraSheet==='assignment'?'true':undefined"
          :aria-label="cameraSheet==='assignment'?'Задание и данные съёмки':undefined"
          @keydown.esc.stop.prevent="closeCameraSheet"
          @keydown.tab="trapCameraSheetFocus($event,'assignment')">
          <span v-if="cameraSheet==='assignment'" class="camera-sheet-handle" aria-hidden="true"></span>
          <header v-if="cameraSheet==='assignment'" class="camera-sheet-heading">
            <strong>Задание и данные съёмки</strong>
            <button type="button" class="camera-sheet-close"
              data-testid="camera-sheet-close" aria-label="Закрыть задание"
              @click="closeCameraSheet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <path d="M5 5 19 19M19 5 5 19"/>
              </svg>
            </button>
          </header>
          <h2 v-else>Задание и данные съёмки</h2>
        <label for="camera-assignment">Выбрать задание</label>
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
        <p v-if="requiredFields?.requiredGps" class="camera-policy-required"
          data-testid="camera-required-gps">GPS обязателен по правилам задания</p>
        <p v-if="requiredFields?.requiredCategory" class="camera-policy-required"
          data-testid="camera-required-category">Категория обязательна по правилам задания</p>
        <p v-if="requiredAdvanced" class="muted" data-testid="camera-advanced-rules">
          Категории (публичный список правил): {{ requiredAdvanced.allowedCategories.join(', ')||'любые' }};
          обязательные теги: {{ requiredAdvanced.requiredTags.join(', ')||'нет' }}.
        </p>

        <h2>Приватная информация {{ captureMode==='photo'?'снимка':captureMode==='video'?'видео':'аудио' }}</h2>
        <label for="camera-category">Категория</label>
        <select v-if="requiredAdvanced?.allowedCategories.length" id="camera-category"
          v-model="category" data-testid="camera-category-select"
          :required="!!requiredFields?.requiredCategory">
          <option value="">Без категории</option>
          <option v-for="name in requiredAdvanced.allowedCategories" :key="name"
            :value="name">{{name}}</option>
        </select>
        <input v-else id="camera-category" v-model="category" type="text" maxlength="64"
          :required="!!requiredFields?.requiredCategory"
          autocomplete="off" placeholder="Например, репортаж">
        <label for="camera-description">Описание съёмки</label>
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

          <div v-if="cameraSheet==='assignment'" class="camera-sheet-footer">
            <button type="button" :disabled="!canConfirmCameraAssignment"
              data-testid="camera-assignment-finish"
              @click="finishCameraAssignment">Готово</button>
          </div>
        </div>
      </div>
      <p v-if="recording" role="status" class="status-text" data-testid="camera-recording-status">
        Идёт запись с {{ recordingStartedAt?new Date(recordingStartedAt).toLocaleTimeString():'' }}. От 5 до {{ recordingMaxSeconds }} секунд, не более 128 MiB.
      </p>
      <section v-if="localDrafts.length" class="foundation-card"
        data-testid="camera-encrypted-draft-recovery">
        <h2>Сохранённые зашифрованные фрагменты</h2>
        <p class="muted">После прерывания доступны только для приватного просмотра на этом устройстве. Частичный файл может не воспроизводиться из-за формата браузера. Ничего не отправляется в облако автоматически.</p>
        <ul>
          <li v-for="draft in localDrafts" :key="draft.recordingId"
            :data-testid="'camera-encrypted-draft-'+draft.recordingId">
            {{ draft.kind==='audio'?'Аудио':'Видео' }} ·
            {{ draft.chunkCount }} фрагментов ·
            {{ Math.ceil(draft.plainBytes/1024) }} КиБ ·
            {{ draft.state==='writing'?'Возможна незавершённая запись в другой вкладке':draft.state==='interrupted'?'Прервана':'Не отправлена' }}
            <div class="action-row">
              <button v-if="draft.state==='writing'" type="button"
                :disabled="recording||busy" @click="checkAbandonedPrivateRecordingDraft(draft.recordingId)">
                Проверить прерванную запись
              </button>
              <button v-if="draft.state!=='writing'" type="button" :disabled="recording||busy"
                @click="reviewPrivateRecordingDraft(draft.recordingId)">
                Просмотреть локально
              </button>
              <button v-if="draft.state!=='writing'" type="button" :disabled="recording||busy"
                @click="removePrivateRecordingDraft(draft.recordingId)">
                Удалить фрагменты
              </button>
            </div>
          </li>
        </ul>
        <div v-if="privateReviewUrl" data-testid="camera-private-draft-preview">
          <audio v-if="privateReviewKind==='audio'" controls :src="privateReviewUrl"
            aria-label="Приватный предпросмотр аудиофрагментов"/>
          <video v-else controls playsinline :src="privateReviewUrl"
            aria-label="Приватный предпросмотр видеофрагментов"/>
          <button type="button" @click="closePrivateRecordingReview">Закрыть предпросмотр</button>
        </div>
      </section>
      <p v-if="localDraftError" role="alert" class="error-text"
        data-testid="camera-draft-error">{{ localDraftError }}</p>
    </template>
  </section>
</template>
