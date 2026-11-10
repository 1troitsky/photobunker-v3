<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeSession, reauthenticate } from '../features/identity/application/session'
import {
  queueAssignmentCreation, listLocalAssignmentDrafts, listServerAssignmentUsage,
  listServerAssignments, listCachedAssignmentSnapshots, listAssignmentInvites,
  listCachedAssignmentInvites,
  cachePrivateAssignment, readCachedPrivateAssignment, listAssignmentOperations,
  queueAssignmentInvitation, queueAssignmentAcceptance,
  queueAssignmentSubmission, listAssignmentSubmissions, flushAssignmentOutbox,
  queueAssignmentMediaSubmission, listAssignmentMediaSubmissions,
  signedAllowedAssignmentMedia,
  queueAssignmentStateTransition,queueAssignmentPolicyChange,
  signedPolicyRequirements,signedPolicyGoals,signedMediaRequirements,
  signedAdvancedRequirements,verifyAssignmentInvite,
  effectiveAssignmentEnvelope,assignmentPrivateCacheScope,
  assignmentOpenAt,assignmentFilesOpenAt,
  signedAssignmentSchedule,
} from '../features/assignments/application/assignment-outbox'
import type {
  ReceivedAssignmentInvite, AssignmentOperation, AssignmentListing,
  CaptureRequirements, AssignmentMonthlyUsage, AllowedAssignmentMedia,
  AssignmentMediaSubmission,
} from '../features/assignments/application/assignment-outbox'
import { preflightAssignmentPhotoGrant } from '../features/assignments/application/submission-preflight'
import { preflightAssignmentMediaGrant } from '../features/assignments/application/media-submission-preflight'
import { parseRulesCsv, EMPTY_ADVANCED_RULES } from '../features/assignments/domain/advanced-rules'
import type { AdvancedRules } from '../features/assignments/domain/advanced-rules'
import {
  openOwnerAssignment, openRecipientAssignment,
} from '../features/assignments/infrastructure/assignment-crypto'
import type { PrivateAssignment } from '../features/assignments/infrastructure/assignment-crypto'
import {
  ensureOwnExchangeKey, inspectPeer, confirmPeer,
} from '../features/sharing/key-directory'
import { queueRecipientGrant, flushRecipientGrants, readReceivedPhoto,
  readReceivedPhotoMetadata } from '../features/sharing/grant-flow'
import type { GPSFix } from '../features/photo-sync/domain/capture-metadata'
import { listLocalPhotos, flushOutbox } from '../features/photo-sync/application/p1-photo'
import type { StoredPhoto } from '../features/photo-sync/application/p1-photo'
import {listLocalMedia} from '../features/media/application/media-outbox'
import type {StoredMedia} from '../features/media/application/media-outbox'
import {queueMediaRecipientGrant,flushMediaGrants,readReceivedMediaGrant} from '../features/media/application/media-grants'

type VisibleAssignment={
  id:string;ownerAccountId:string;data:PrivateAssignment|null
  state:string;revision:number;policyRevision:number;privateRevision:number
  requirements:CaptureRequirements;allowedMedia:AllowedAssignmentMedia
  videoRequirements:CaptureRequirements;audioRequirements:CaptureRequirements
  photoAdvanced:AdvancedRules;videoAdvanced:AdvancedRules;audioAdvanced:AdvancedRules
  localState?:string;goal:number|null;videoGoal:number|null;audioGoal:number|null
  confirmedPhotos:number|null // null = no authenticated server receipt count yet
  confirmedVideos:number|null;confirmedAudio:number|null
  createdAt:number;isOwner:boolean;startsAt:number;endsAt:number|null
  filesAccessUntil?:number|null;assignmentAccessUntil?:number|null
  blockBeforeStart:boolean;blockAfterEnd:boolean
}
type SafetyCheck={accountId:string;fingerprint:string;confirmed:boolean}
type Submission={submissionId:string;photoId:string;photoGrantId:string;contributorAccountId:string}

const assignments=ref<VisibleAssignment[]>([])
const invites=ref<ReceivedAssignmentInvite[]>([])
const operations=ref<AssignmentOperation[]>([])
const monthlyUsage=ref<AssignmentMonthlyUsage|null>(null)
const photos=ref<StoredPhoto[]>([])
const mediaFiles=ref<StoredMedia[]>([])
const mediaSubmissions=ref<AssignmentMediaSubmission[]>([])
const submissions=ref<Submission[]>([])
const selectedId=ref('')
const title=ref('')
const instructions=ref('')
const goal=ref<string|number>('')
const editedGoal=ref<string|number>('')
const editedVideoGoal=ref<string|number>('')
const editedAudioGoal=ref<string|number>('')
const editedRequiredCategory=ref(false)
const editedDescriptionMin=ref<string|number>(0)
const editedRequiredGps=ref(false)
const editedAllowVideo=ref(false)
const editedAllowAudio=ref(false)
const editedVideoReqCategory=ref(false)
const editedVideoReqDescription=ref<string|number>(0)
const editedVideoReqGps=ref(false)
const editedAudioReqCategory=ref(false)
const editedAudioReqDescription=ref<string|number>(0)
const editedAudioReqGps=ref(false)
const editedPhotoAllowed=ref('')
const editedPhotoTags=ref('')
const editedVideoAllowed=ref('')
const editedVideoTags=ref('')
const editedAudioAllowed=ref('')
const editedAudioTags=ref('')
// Legacy owner form: rebase only untouched fields when the authenticated
// server policy arrives after a fast click on a cached/offline card.
const ownerFormPolicyRevision=ref<number|null>(null)
const ownerFormTouched=ref(false)
const recipientId=ref('')
const ownerCheck=ref<SafetyCheck|null>(null)
const contributorCheck=ref<SafetyCheck|null>(null)
const checkAgreed=ref(false)
const incomingAgreed=ref(false)
const busy=ref(false)
const syncing=ref(false)
const showingOfflineSnapshot=ref(false)
const error=ref('')
const notice=ref('')
const search=ref('')
const showCreate=ref(false)
const previewUrl=ref('')
const previewMime=ref('image/jpeg')
const previewPrivate=ref<{category?:string;description?:string;tags?:string[];gps?:GPSFix}|null>(null)
const filters=ref<'all'|'active'>('active')

const selected=computed(()=>assignments.value.find(a=>a.id===selectedId.value)??null)
const visible=computed(()=>assignments.value
  .filter(a=>filters.value==='all'||a.state==='active'
    ||a.localState==='queued'||a.localState==='retry'
    ||a.localState==='conflict')
  .filter(a=>(a.data?.title??'').toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
      ||a.id.toLowerCase().includes(search.value.toLowerCase()))
  .sort((a,b)=>b.createdAt-a.createdAt))
const count=computed(()=>assignments.value.length)
const activeCount=computed(()=>assignments.value.filter(a=>a.state==='active').length)
const finishedCount=computed(()=>assignments.value.filter(a=>a.state==='finished').length)
const selectedOperations=computed(()=>operations.value.filter(op=>
  op.contract.includes(selectedId.value)&&!!selectedId.value))
const pendingStateChange=computed(()=>selectedOperations.value.some(op=>
  (op.kind==='state'||op.kind==='policy')
    &&(op.state==='queued'||op.state==='retry')))
const pendingPolicyChange=computed(()=>selectedOperations.value.some(op=>
  op.kind==='policy'&&(op.state==='queued'||op.state==='retry')))
const eligibleMedia=computed(()=>mediaFiles.value.filter(x=>{
  if(x.state!=='synced'||x.expiresAt<=Date.now()
    ||(x.mediaType!=='video'&&x.mediaType!=='audio')
    ||!selected.value?.allowedMedia.includes(x.mediaType))return false
  if(!x.capture)return true // personal media requires distinct confirmation
  try{
    const proof=JSON.parse(x.capture.contract) as {assignmentId?:string}
    return proof.assignmentId===selectedId.value
  }catch{return false}
}))
const eligiblePhotos=computed(()=>photos.value
  .filter(p=>p.state==='synced'
    &&(!p.capture||p.capture.assignmentId===selectedId.value))
  .sort((a,b)=>Number(!!b.capture)-Number(!!a.capture)))
function progressPercentage(assignment:VisibleAssignment):number|null{
  const targeted=[
    {goal:assignment.goal,count:assignment.confirmedPhotos},
    {goal:assignment.videoGoal,count:assignment.confirmedVideos},
    {goal:assignment.audioGoal,count:assignment.confirmedAudio},
  ].filter(x=>x.goal!==null)
  // Only live, server-confirmed E2EE receipts count. No goals => no percent.
  // Offline counts are unknown: never invent progress from pending captures.
  if(!targeted.length||targeted.some(x=>x.count===null))return null
  const total=targeted.reduce((sum,x)=>sum+x.goal!,0)
  const done=targeted.reduce((sum,x)=>sum+Math.min(x.goal!,x.count!),0)
  return Math.min(100,Math.round(100*done/total))
}
function pendingReceiptCount(assignmentId:string):number{
  const queuedCaptures=photos.value.filter(p=>p.capture?.assignmentId===assignmentId
    &&(p.state==='queued'||p.state==='retry')).length
  const queuedSubmissions=operations.value.filter(op=>{
    if(!['submit','media-submit'].includes(op.kind)
      ||(op.state!=='queued'&&op.state!=='retry'))return false
    try{
      const body=JSON.parse(op.contract) as {assignmentId?:string}
      return body.assignmentId===assignmentId
    }catch{return false}
  }).length
  return queuedCaptures+queuedSubmissions
}

function cleanPreview():void{
  if(previewUrl.value){URL.revokeObjectURL(previewUrl.value);previewUrl.value=''}
  previewPrivate.value=null
}
function resetSensitive():void {
  assignments.value=[];invites.value=[];operations.value=[];photos.value=[]
  mediaFiles.value=[];mediaSubmissions.value=[]
  monthlyUsage.value=null
  submissions.value=[];selectedId.value='';ownerCheck.value=null
  contributorCheck.value=null;showingOfflineSnapshot.value=false;cleanPreview()
}
function explain(e:unknown):string{
  return e instanceof Error?e.message:'assignment.operation_failed'
}
async function operate(fn:()=>Promise<void>):Promise<void>{
  if(busy.value)return
  busy.value=true;error.value='';notice.value=''
  try{await fn()}catch(e){error.value=explain(e)}
  finally{busy.value=false}
}
async function hydrate():Promise<void>{
  const identity=activeSession.value
  if(!identity){resetSensitive();return}
  // Render durable local drafts and signed queued operations BEFORE any HTTP.
  const [local,ops,localPhotos,localMedia]=await Promise.all([
    listLocalAssignmentDrafts(),listAssignmentOperations(),listLocalPhotos(),
    listLocalMedia(),
  ])
  if(activeSession.value!==identity)return
  operations.value=ops;photos.value=localPhotos;mediaFiles.value=localMedia
  // Once a create is ACKed, its signed, independently verified snapshot
  // (not a stale local plaintext summary) is the ONLY render authority.
  const localRows:VisibleAssignment[]=await Promise.all(
    local.filter(item=>item.state!=='sent').map(async item=>{
    let data:PrivateAssignment|null=null
    try{data=await openOwnerAssignment(identity.pkg,item.id,item.privateEnvelope)}
    catch { /* a corrupted local envelope must never reveal plaintext */ }
    return {
      id:item.id,ownerAccountId:item.ownerAccountId,data,
      state:'active',revision:1,policyRevision:1,privateRevision:1,
      requirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
      videoRequirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
      audioRequirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
      photoAdvanced:EMPTY_ADVANCED_RULES,videoAdvanced:EMPTY_ADVANCED_RULES,
      audioAdvanced:EMPTY_ADVANCED_RULES,
      allowedMedia:['photo'],
      localState:item.state,goal:item.photoGoal,videoGoal:null,audioGoal:null,
      confirmedPhotos:null,confirmedVideos:null,confirmedAudio:null,
      createdAt:item.createdAt,isOwner:true,startsAt:item.startsAt,endsAt:item.endsAt,
      filesAccessUntil:null,assignmentAccessUntil:null,
      blockBeforeStart:true,blockAfterEnd:item.endsAt!==null,
    }
  }))
  if(activeSession.value!==identity)return
  assignments.value=localRows
  let offline=!identity.online||!navigator.onLine
  showingOfflineSnapshot.value=offline
  if(offline)monthlyUsage.value=null
  else{
    // Never block encrypted local draft rendering on an accounting request.
    // Fresh account-scoped numbers are authoritative only when the server
    // answered successfully; a failed network read does not mean "0 used".
    void listServerAssignmentUsage().then(data=>{
      if(activeSession.value===identity&&!showingOfflineSnapshot.value)
        monthlyUsage.value=data
    }).catch(()=>{
      if(activeSession.value===identity)monthlyUsage.value=null
    })
  }
  let snapshots:AssignmentListing[]
  let received:ReceivedAssignmentInvite[]
  if(offline){
    // A warm offline route can read only previously authenticated, signed
    // cached assignments. This is NOT proof of current server membership.
    ;[snapshots,received]=await Promise.all([
      listCachedAssignmentSnapshots(),listCachedAssignmentInvites(),
    ])
  }else{
    try{
      const [server,invitesFromServer]=await Promise.all([
        listServerAssignments(),listAssignmentInvites(),
      ])
      snapshots=server.items
      received=invitesFromServer
    }catch(e){
      // navigator.onLine may remain true during API/S3 outages or captive
      // portals. Fall back to the previously verified encrypted cache, NEVER
      // claim fresh grants/receipts, and surface the failed verification.
      if(activeSession.value!==identity)return
      offline=true
      showingOfflineSnapshot.value=true
      error.value=explain(e)
      ;[snapshots,received]=await Promise.all([
        listCachedAssignmentSnapshots(),listCachedAssignmentInvites(),
      ])
    }
  }
  if(activeSession.value!==identity)return
  invites.value=received
  const rows=[...localRows]
  for(const item of snapshots){
    if(!assignmentOpenAt(item,Date.now()))continue
    const previous=rows.find(a=>a.id===item.assignmentId)
    // A fresh signed private revision must invalidate prior root/plaintext
    // previews. Never show an outdated title from a locally queued draft.
    let data=(previous?.privateRevision??1)===(item.privateRevision??1)
      ?previous?.data??null:null
    if(!data){
      try{
        if(item.ownerAccountId===identity.accountId){
          data=await openOwnerAssignment(identity.pkg,item.assignmentId,
            item.privateEnvelope,effectiveAssignmentEnvelope(item))
        }else{
          const invite=received.find(i=>i.assignmentId===item.assignmentId&&i.state==='accepted')
          if(invite){
            await verifyAssignmentInvite(invite,offline) // local pin for stale snapshot; fresh check online
            if(offline){
              // No network key-directory access is attempted offline. Only
              // an existing AEAD-encrypted account-scoped summary is opened.
              data=await readCachedPrivateAssignment(item.assignmentId,
                assignmentPrivateCacheScope(item))
            }else{
              const contract=JSON.parse(invite.contract)
              const own=await ensureOwnExchangeKey()
              data=await openRecipientAssignment(own.privateKey,{
                assignmentId:item.assignmentId,inviteId:invite.inviteId,
                ownerAccountId:item.ownerAccountId,
                recipientAccountId:identity.accountId,
                role:'contributor',expiresAt:invite.expiresAt,
              },contract.envelope,effectiveAssignmentEnvelope(item))
              await cachePrivateAssignment(item.assignmentId,
                assignmentPrivateCacheScope(item),data)
            }
          }
        }
      }catch{/* unconfirmed peer or invalid ciphertext remains opaque */}
    }
    const effectiveTime=signedAssignmentSchedule(item)
    const row:VisibleAssignment={
      id:item.assignmentId,ownerAccountId:item.ownerAccountId,data,
      state:item.state,revision:item.revision,policyRevision:item.policyRevision,
      privateRevision:item.privateRevision??1,
      requirements:signedPolicyRequirements(item),
      videoRequirements:signedMediaRequirements(item,'video'),
      audioRequirements:signedMediaRequirements(item,'audio'),
      photoAdvanced:signedAdvancedRequirements(item,'photo'),
      videoAdvanced:signedAdvancedRequirements(item,'video'),
      audioAdvanced:signedAdvancedRequirements(item,'audio'),
      localState:previous?.localState,
      goal:item.photoGoal,videoGoal:signedPolicyGoals(item).videoGoal,
      audioGoal:signedPolicyGoals(item).audioGoal,
      confirmedPhotos:offline?null:assignmentFilesOpenAt(item,Date.now())
        ?item.confirmedPhotoCount:0,
      confirmedVideos:offline?null:assignmentFilesOpenAt(item,Date.now())
        ?(item.confirmedVideoCount??null):0,
      confirmedAudio:offline?null:assignmentFilesOpenAt(item,Date.now())
        ?(item.confirmedAudioCount??null):0,
      allowedMedia:signedAllowedAssignmentMedia(item),
      createdAt:previous?.createdAt??item.startsAt,
      filesAccessUntil:item.filesAccessUntil??null,
      assignmentAccessUntil:item.assignmentAccessUntil??null,
      isOwner:item.ownerAccountId===identity.accountId,
      startsAt:effectiveTime.startsAt,endsAt:effectiveTime.endsAt,
      blockBeforeStart:effectiveTime.blockBeforeStart,
      blockAfterEnd:effectiveTime.blockAfterEnd,
    }
    if(previous)rows[rows.indexOf(previous)]=row
    else rows.push(row)
  }
  if(activeSession.value!==identity)return
  assignments.value=rows
}
// Coalesce overlapping initial offline hydration, subsequent online proof and
// explicit refresh. Dropping a refresh while the old session is still being
// hydrated can hide freshly accepted invitations until another navigation.
let currentRefresh:Promise<void>|null=null
let refreshRequested=false
function refresh():Promise<void>{
  if(currentRefresh){
    refreshRequested=true
    return currentRefresh
  }
  currentRefresh=(async()=>{
    syncing.value=true
    try{
      do{
        refreshRequested=false
        try{await hydrate()}catch(e){error.value=explain(e)}
      }while(refreshRequested)
    }finally{syncing.value=false}
  })().finally(()=>{currentRefresh=null})
  return currentRefresh
}
async function synchronize():Promise<void>{
  await operate(async()=>{
    if(!activeSession.value?.online)await reauthenticate()
    await flushOutbox()
    await flushRecipientGrants()
    await flushAssignmentOutbox()
    await refresh()
    notice.value='Локальное и серверное состояние обновлено'
  })
}
async function create():Promise<void>{
  await operate(async()=>{
    const trimmed=title.value.trim()
    if(!trimmed)throw Error('Введите название задания')
    const parsed=String(goal.value).trim()?Number(goal.value):null
    const id=await queueAssignmentCreation({
      title:trimmed,instructions:instructions.value,photoGoal:parsed,
    })
    showCreate.value=false;title.value='';instructions.value='';goal.value=''
    await hydrate()
    selectedId.value=id
    notice.value='Задание зашифровано и принято локально. Синхронизация — в очереди.'
  })
}
function populateOwnerPolicyForm(chosen:VisibleAssignment|undefined):void{
  editedGoal.value=chosen?.goal??''
  editedVideoGoal.value=chosen?.videoGoal??''
  editedAudioGoal.value=chosen?.audioGoal??''
  editedRequiredCategory.value=chosen?.requirements.requiredCategory??false
  editedDescriptionMin.value=chosen?.requirements.descriptionMinLength??0
  editedRequiredGps.value=chosen?.requirements.requiredGps??false
  editedAllowVideo.value=chosen?.allowedMedia.includes('video')??false
  editedAllowAudio.value=chosen?.allowedMedia.includes('audio')??false
  editedVideoReqCategory.value=chosen?.videoRequirements.requiredCategory??false
  editedVideoReqDescription.value=chosen?.videoRequirements.descriptionMinLength??0
  editedVideoReqGps.value=chosen?.videoRequirements.requiredGps??false
  editedAudioReqCategory.value=chosen?.audioRequirements.requiredCategory??false
  editedAudioReqDescription.value=chosen?.audioRequirements.descriptionMinLength??0
  editedAudioReqGps.value=chosen?.audioRequirements.requiredGps??false
  editedPhotoAllowed.value=chosen?.photoAdvanced.allowedCategories.join(', ')??''
  editedPhotoTags.value=chosen?.photoAdvanced.requiredTags.join(', ')??''
  editedVideoAllowed.value=chosen?.videoAdvanced.allowedCategories.join(', ')??''
  editedVideoTags.value=chosen?.videoAdvanced.requiredTags.join(', ')??''
  editedAudioAllowed.value=chosen?.audioAdvanced.allowedCategories.join(', ')??''
  editedAudioTags.value=chosen?.audioAdvanced.requiredTags.join(', ')??''
  ownerFormPolicyRevision.value=chosen?.policyRevision??null
  ownerFormTouched.value=false
}
function choose(assignmentId:string):void{
  selectedId.value=assignmentId
  const chosen=assignments.value.find(a=>a.id===assignmentId)
  populateOwnerPolicyForm(chosen)
  ownerCheck.value=null
  contributorCheck.value=null;recipientId.value=''
  submissions.value=[];mediaSubmissions.value=[];cleanPreview()
  if(selected.value?.isOwner)void loadSubmissions()
}
async function loadSubmissions():Promise<void>{
  const id=selectedId.value
  const owner=selected.value
  if(!owner?.isOwner||!activeSession.value?.online)return
  try{
    const [result,mediaResult]=await Promise.all([
      listAssignmentSubmissions(id),listAssignmentMediaSubmissions(id),
    ])
    if(selectedId.value===id){
      submissions.value=result;mediaSubmissions.value=mediaResult.items
    }
  }catch(e){error.value=explain(e)}
}
async function changeState(action:'finish'|'resume'):Promise<void>{
  await operate(async()=>{
    const assignment=selected.value
    if(!assignment?.isOwner||assignment.localState==='queued')
      throw new Error('assignment.owner_required')
    await queueAssignmentStateTransition(assignment.id,action)
    if(activeSession.value?.online&&navigator.onLine)await flushAssignmentOutbox()
    await refresh()
    notice.value=action==='finish'
      ?'Завершение задания подписано и поставлено в очередь. Личные файлы участников сохраняются.'
      :'Возобновление задания подписано и поставлено в очередь.'
  })
}

async function changeGoal():Promise<void>{
  await operate(async()=>{
    const a=selected.value
    if(!a?.isOwner||a.localState==='queued')
      throw new Error('assignment.owner_required')
    if(ownerFormPolicyRevision.value!==a.policyRevision)
      throw Error('assignment.editor_revision_changed')
    const input=String(editedGoal.value).trim()
    const value=input===''?null:Number(input)
    const videoInput=String(editedVideoGoal.value).trim()
    const audioInput=String(editedAudioGoal.value).trim()
    await queueAssignmentPolicyChange(a.id,{
      photoGoal:value,
      videoGoal:editedAllowVideo.value&&videoInput!==''?Number(videoInput):null,
      audioGoal:editedAllowAudio.value&&audioInput!==''?Number(audioInput):null,
      videoRequirements:{
        requiredCategory:editedAllowVideo.value&&editedVideoReqCategory.value,
        descriptionMinLength:editedAllowVideo.value?Number(editedVideoReqDescription.value):0,
        requiredGps:editedAllowVideo.value&&editedVideoReqGps.value,
      },
      photoAdvanced:{
        allowedCategories:parseRulesCsv(editedPhotoAllowed.value,16,64),
        requiredTags:parseRulesCsv(editedPhotoTags.value,12,48),
      },
      videoAdvanced:{
        allowedCategories:editedAllowVideo.value?parseRulesCsv(editedVideoAllowed.value,16,64):[],
        requiredTags:editedAllowVideo.value?parseRulesCsv(editedVideoTags.value,12,48):[],
      },
      audioAdvanced:{
        allowedCategories:editedAllowAudio.value?parseRulesCsv(editedAudioAllowed.value,16,64):[],
        requiredTags:editedAllowAudio.value?parseRulesCsv(editedAudioTags.value,12,48):[],
      },
      audioRequirements:{
        requiredCategory:editedAllowAudio.value&&editedAudioReqCategory.value,
        descriptionMinLength:editedAllowAudio.value?Number(editedAudioReqDescription.value):0,
        requiredGps:editedAllowAudio.value&&editedAudioReqGps.value,
      },
      requiredCategory:editedRequiredCategory.value,
      descriptionMinLength:Number(editedDescriptionMin.value),
      requiredGps:editedRequiredGps.value,
      allowedMedia:[
        'photo',...(editedAllowVideo.value?['video']:[]),
        ...(editedAllowAudio.value?['audio']:[]),
      ] as AllowedAssignmentMedia,
    })
    ownerFormTouched.value=false
    if(activeSession.value?.online&&navigator.onLine)await flushAssignmentOutbox()
    await refresh()
    notice.value='Новые правила подписаны и сохранены. До подтверждения сервером действует прежняя версия.'
  })
}

async function inspectRecipient():Promise<void>{
  await operate(async()=>{
    const id=recipientId.value.trim().toLowerCase()
    const {directory,confirmed}=await inspectPeer(id)
    ownerCheck.value={
      accountId:id,fingerprint:directory.safetyFingerprint,confirmed,
    }
    checkAgreed.value=false
  })
}
async function approveRecipient():Promise<void>{
  await operate(async()=>{
    if(!ownerCheck.value||!checkAgreed.value)
      throw Error('Требуется независимая сверка отпечатка')
    const {accountId,fingerprint}=ownerCheck.value
    await confirmPeer(accountId,fingerprint)
    ownerCheck.value={accountId,fingerprint,confirmed:true}
    notice.value='Ключ получателя подтверждён на этом устройстве'
  })
}
async function invite():Promise<void>{
  await operate(async()=>{
    if(!selected.value?.isOwner||!ownerCheck.value?.confirmed)
      throw Error('Получатель не подтверждён')
    const id=await queueAssignmentInvitation(selected.value.id,ownerCheck.value.accountId)
    await hydrate()
    notice.value='Подписанное приглашение сохранено в очереди: '+id.slice(0,8)
  })
}
async function inspectOwner(invite:ReceivedAssignmentInvite):Promise<void>{
  await operate(async()=>{
    const {directory,confirmed}=await inspectPeer(invite.ownerAccountId)
    contributorCheck.value={
      accountId:invite.ownerAccountId,
      fingerprint:directory.safetyFingerprint,confirmed,
    }
    incomingAgreed.value=false
  })
}
async function approveOwner():Promise<void>{
  await operate(async()=>{
    if(!contributorCheck.value||!incomingAgreed.value)
      throw Error('Требуется независимая сверка отпечатка')
    await confirmPeer(contributorCheck.value.accountId,contributorCheck.value.fingerprint)
    contributorCheck.value={...contributorCheck.value,confirmed:true}
    notice.value='Ключ отправителя подтверждён'
  })
}
async function accept(invite:ReceivedAssignmentInvite):Promise<void>{
  await operate(async()=>{
    if(contributorCheck.value?.accountId!==invite.ownerAccountId
      ||!contributorCheck.value.confirmed)
      throw Error('Сначала подтвердите ключ владельца')
    await queueAssignmentAcceptance(invite)
    await flushAssignmentOutbox()
    await hydrate()
    notice.value='Согласие подписано. Если нет сети, оно ожидает отправки.'
  })
}
async function submit(photo:StoredPhoto):Promise<void>{
  await operate(async()=>{
    const target=selected.value
    if(!target||target.isOwner||photo.state!=='synced')
      throw Error('Нужен синхронизированный снимок и принятое задание')
    if(contributorCheck.value?.accountId!==target.ownerAccountId
      ||!contributorCheck.value.confirmed)
      throw Error('Подтвердите отпечаток владельца задания')
    // Verify owner-signed policy, actual photo scope, historical policy and
    // decrypted private requirements BEFORE revealing ANY recipient DEK.
    const checked=await preflightAssignmentPhotoGrant(
      target.id,photo.photoId,target.ownerAccountId)
    if(checked.personalPhoto&&!window.confirm(
      'Это личное фото, снятое вне задания. Дать владельцу задания доступ к фото и его приватным метаданным (включая описание и GPS, если они есть)?'
    ))return
    const grantId=await queueRecipientGrant(photo.photoId,target.ownerAccountId,
      target.id,checked.grantExpiresAtCap)
    await queueAssignmentSubmission(target.id,photo.photoId,grantId,
      checked.policyRevision)
    await flushRecipientGrants()
    await flushAssignmentOutbox()
    operations.value=await listAssignmentOperations()
    notice.value='Зашифрованный grant и отправка задания поставлены в очередь'
  })
}
async function submitMedia(media:StoredMedia):Promise<void>{
  await operate(async()=>{
    const target=selected.value
    if(!target||target.isOwner||media.state!=='synced'
      ||!['video','audio'].includes(media.mediaType))
      throw Error('assignment.media_not_synced')
    if(contributorCheck.value?.accountId!==target.ownerAccountId
      ||!contributorCheck.value.confirmed)
      throw Error('Подтвердите отпечаток владельца задания')
    // Verify the freshly signed owner policy, local AEAD-decrypted
    // category/description/GPS, and exact recording binding before creating
    // ANY recipient key envelope; offline captures remain Local-First.
    const checked=await preflightAssignmentMediaGrant(
      target.id,media.mediaId,target.ownerAccountId)
    if(!window.confirm(
      (media.capture?'Эта запись была создана для задания. ':'Это личный файл вне задания. ')
      +'Передать владельцу задания E2EE-ключ всего '
      +(media.mediaType==='video'?'видео':'аудио')
      +', включая исходное имя и приватные метаданные? Отзыв не удалит уже скачанные копии.'
    ))return
    const grantId=await queueMediaRecipientGrant(media.mediaId,target.ownerAccountId,target.id)
    await queueAssignmentMediaSubmission(target.id,media.mediaId,grantId)
    await flushMediaGrants()
    await flushAssignmentOutbox()
    operations.value=await listAssignmentOperations()
    notice.value='Подписанный media-grant и отправка сохранены в очереди. Прогресс изменится только после серверного подтверждения.'
  })
}
async function openMediaSubmission(grantId:string):Promise<void>{
  await operate(async()=>{
    // The owner must have independently pinned the contributor fingerprint.
    const result=await readReceivedMediaGrant(grantId)
    cleanPreview()
    previewUrl.value=URL.createObjectURL(result.blob)
    previewMime.value=result.metadata.mime
    previewPrivate.value=result.metadata
    notice.value='Видео/аудио и приватные метаданные расшифрованы на устройстве'
  })
}
async function openSubmission(grantId:string):Promise<void>{
  await operate(async()=>{
    const [blob,metadata]=await Promise.all([
      readReceivedPhoto(grantId),readReceivedPhotoMetadata(grantId),
    ]) // both assets independently verify pinned owner + DEK + active ACL
    cleanPreview()
    previewUrl.value=URL.createObjectURL(blob)
    previewMime.value='image/jpeg'
    previewPrivate.value=metadata
    notice.value='Фотография расшифрована только на этом устройстве'
  })
}
watch(()=>selected.value?.policyRevision,(version)=>{
  const chosen=selected.value
  if(!chosen?.isOwner||version===undefined
    ||version===ownerFormPolicyRevision.value)return
  if(!ownerFormTouched.value)populateOwnerPolicyForm(chosen)
  else error.value='Новые подписанные правила получены. Сохраните свои заметки отдельно, закройте задание и откройте заново — устаревшие правки не будут подписаны.'
})
watch(activeSession,(next,previous)=>{
  // Online reauthentication refreshes Session by replacing the object, even
  // when account/device keys are unchanged. Only an identity boundary may
  // clear selection, decrypted previews and peer confirmation state.
  const identityChanged=!next||!previous
    ||next.accountId!==previous.accountId
    ||next.deviceId!==previous.deviceId
    ||next.pkg.accountSpki!==previous.pkg.accountSpki
    ||next.pkg.revision!==previous.pkg.revision
  if(identityChanged)resetSensitive()
  void refresh()
})
onMounted(()=>{void refresh()})
onUnmounted(cleanPreview)
</script>

<template>
  <section class="foundation-content assignments-p1">
    <div class="assignments-heading">
      <h1>Задания</h1>
      <div class="assignment-counters" aria-label="Счётчики заданий">
        <span>Всего <strong>{{ count }}</strong></span>
        <span>Активных <strong>{{ activeCount }}</strong></span>
        <span>Готово <strong>{{ finishedCount }}</strong></span>
      </div>
    </div>
    <p class="subtitle">P1 · рабочий E2EE-сценарий · полный Fieldwork 5.0 / Editor 2.2 ещё не перенесён</p>
    <p v-if="activeSession&&monthlyUsage&&!showingOfflineSnapshot"
      class="muted" role="status" data-testid="assignment-monthly-usage">
      Тариф Free · создано заданий за месяц:
      <strong>{{ monthlyUsage.used }} / {{ monthlyUsage.limit }}</strong>.
      <template v-if="monthlyUsage.remaining>0">
        Осталось {{ monthlyUsage.remaining }}.
      </template>
      <template v-else>
        Месячная квота исчерпана. Сброс после {{ new Date(monthlyUsage.periodEnd).toLocaleDateString('ru-RU') }}.
      </template>
    </p>
    <p v-else-if="activeSession&&!showingOfflineSnapshot" class="muted">
      Текущая квота заданий будет уточнена после ответа сервера.
    </p>
    <p v-if="activeSession&&showingOfflineSnapshot" class="muted" role="status">
      Офлайн: показаны последние проверенные подписью снимки заданий. Текущие права и количество подтверждённых материалов неизвестны до синхронизации.
    </p>

    <div v-if="!activeSession" class="foundation-card">
      <p>Для управления зашифрованными заданиями необходим аккаунт.</p>
      <RouterLink to="/settings">Создать или восстановить аккаунт</RouterLink>
    </div>

    <template v-else>
      <div class="assignment-toolbar">
        <button type="button" :disabled="busy||syncing" @click="synchronize">Синхронизировать</button>
        <button type="button" :disabled="busy" @click="showCreate=!showCreate">
          {{ showCreate?'Закрыть':'Создать задание' }}
        </button>
      </div>

      <form v-if="showCreate" class="foundation-card" @submit.prevent="create">
        <h2>Создать задание · P1 (фото)</h2>
        <p class="muted">Временная функциональная форма. Полный редактор: Основное / Файлы / Участники / Правила — по утверждённому Fieldwork 2.2.</p>
        <label for="assignment-title">Название</label>
        <input id="assignment-title" v-model="title" maxlength="120" autocomplete="off" required>
        <label for="assignment-instructions">Инструкции</label>
        <textarea id="assignment-instructions" v-model="instructions" rows="4" maxlength="4000"/>
        <label for="assignment-goal">Нужно фотографий (необязательная цель)</label>
        <input id="assignment-goal" v-model="goal" type="number" min="1" max="9999" step="1" placeholder="Например, 30">
        <p class="muted">Название и инструкции шифруются до сохранения. Цель нужна только для прогресса, не ограничивает число файлов. Офлайн-черновик сохраняется независимо от доступной квоты; сервер принимает создание только в пределах действующего лимита Free.</p>
        <button type="submit" :disabled="busy">Создать зашифрованное задание</button>
      </form>

      <div class="assignment-toolbar">
        <div class="assignment-tabs">
          <button type="button" :class="{selected:filters==='active'}" @click="filters='active'">Активные</button>
          <button type="button" :class="{selected:filters==='all'}" @click="filters='all'">Все</button>
        </div>
        <input v-model="search" aria-label="Поиск заданий" placeholder="Поиск по названию или ID">
        <button type="button" :disabled="syncing" @click="refresh">Обновить</button>
      </div>

      <div v-if="!visible.length" class="foundation-card">
        <p>Нет доступных заданий. Локальные зашифрованные черновики появляются здесь без ожидания сервера.</p>
      </div>
      <div class="assignments-cards">
        <article v-for="assignment in visible" :key="assignment.id" class="assignment-card">
          <div class="assignment-card-top">
            <span class="assignment-icon" aria-hidden="true">▤</span>
            <div class="assignment-card-name">
              <strong>{{ assignment.data?.title||'Зашифрованное задание' }}</strong>
              <small>{{ assignment.id.slice(0,8) }} · {{ assignment.isOwner?'Владелец':'Исполнитель' }}</small>
            </div>
            <span class="assignment-state">{{ assignment.localState==='conflict'?'Не принято сервером':assignment.localState==='retry'?'Повтор отправки':assignment.localState==='queued'?'В очереди':assignment.state==='active'?'Активно':assignment.state==='finished'?'Завершено':assignment.state }}</span>
          </div>
          <p v-if="assignment.data?.instructions" class="assignment-description">{{ assignment.data.instructions }}</p>
          <div class="assignment-card-bottom">
            <div class="assignment-card-progress">
              <span v-if="assignment.confirmedPhotos!==null">
                Фото: {{ assignment.confirmedPhotos }}{{ assignment.goal===null?'':' / '+assignment.goal }}
              </span>
              <span v-else class="muted">Фото: цель {{ assignment.goal??'не задана' }} · ожидает подтверждения</span>
              <span v-if="assignment.allowedMedia.includes('video')&&assignment.confirmedVideos!==null">
                · Видео: {{ assignment.confirmedVideos }}{{ assignment.videoGoal===null?'':' / '+assignment.videoGoal }}
              </span>
              <span v-if="assignment.allowedMedia.includes('audio')&&assignment.confirmedAudio!==null">
                · Аудио: {{ assignment.confirmedAudio }}{{ assignment.audioGoal===null?'':' / '+assignment.audioGoal }}
              </span>
              <span v-if="progressPercentage(assignment)!==null">
                · Всего {{ progressPercentage(assignment) }}%
              </span>
              <progress v-if="progressPercentage(assignment)!==null"
                :max="100" :value="progressPercentage(assignment)??0"
                :aria-label="'Подтверждённый прогресс задания '+assignment.id"/>
              <small v-if="pendingReceiptCount(assignment.id)>0" class="muted">
                Локально ожидают отправки: {{ pendingReceiptCount(assignment.id) }}
              </small>
            </div>
            <button type="button" :disabled="busy" @click="choose(assignment.id)">Открыть</button>
          </div>
        </article>
      </div>

      <div v-if="selected" class="foundation-card assignment-detail">
        <div class="assignment-detail-title">
          <h2>{{ selected.data?.title||'Зашифрованное задание' }}</h2>
          <button type="button" @click="choose('')">Закрыть</button>
        </div>
        <p v-if="selected.state==='active'&&selected.localState!=='queued'">
          <RouterLink :to="{path:'/camera',query:{assignmentId:selected.id}}">Снимать по заданию</RouterLink>
        </p>
        <p v-if="selected.data" class="muted">{{ selected.data.instructions }}</p>
        <p><code>{{ selected.id }}</code></p>
        <p class="muted">Разрешённые типы: {{ selected.allowedMedia.join(', ') }} · {{ selected.goal===null?'Без цели по фото':'Фото: цель '+selected.goal }} · {{ selected.isOwner?'Владелец':'Исполнитель' }}</p>
        <p class="muted">Цели для прогресса: Видео — {{ selected.videoGoal??'не задана' }}, Аудио — {{ selected.audioGoal??'не задана' }}. Цели не ограничивают отправку файлов.</p>
        <p class="muted">
          Подписанные требования: категория {{ selected.requirements.requiredCategory?'обязательна':'необязательна' }};
          описание минимум {{ selected.requirements.descriptionMinLength }} символов;
          GPS {{ selected.requirements.requiredGps?'обязателен':'необязателен' }}.
        </p>
        <p v-if="selected.allowedMedia.includes('video')" class="muted" data-testid="assignment-video-requirements">
          Видео: категория {{ selected.videoRequirements.requiredCategory?'обязательна':'необязательна' }},
          описание минимум {{ selected.videoRequirements.descriptionMinLength }} символов,
          GPS {{ selected.videoRequirements.requiredGps?'обязателен':'необязателен' }}.
        </p>
        <p v-if="selected.allowedMedia.includes('audio')" class="muted" data-testid="assignment-audio-requirements">
          Аудио: категория {{ selected.audioRequirements.requiredCategory?'обязательна':'необязательна' }},
          описание минимум {{ selected.audioRequirements.descriptionMinLength }} символов,
          GPS {{ selected.audioRequirements.requiredGps?'обязателен':'необязателен' }}.
        </p>
        <p v-for="item in [
          {name:'Фото',allowed:selected.allowedMedia.includes('photo'),rules:selected.photoAdvanced},
          {name:'Видео',allowed:selected.allowedMedia.includes('video'),rules:selected.videoAdvanced},
          {name:'Аудио',allowed:selected.allowedMedia.includes('audio'),rules:selected.audioAdvanced},
        ]" :key="item.name" v-show="item.allowed" class="muted">
          {{ item.name }} — допустимые категории: {{ item.rules.allowedCategories.join(', ')||'любые' }};
          обязательные теги: {{ item.rules.requiredTags.join(', ')||'нет' }}.
        </p>
        <p v-if="selected.confirmedPhotos!==null" class="muted">
          Подтверждено сервером: Фото {{ selected.confirmedPhotos }}
          <template v-if="selected.goal!==null"> / {{ selected.goal }}</template>
          <template v-if="progressPercentage(selected)!==null">
            · Общий прогресс {{ progressPercentage(selected) }}%
          </template>
        </p>
        <p v-if="selected.confirmedVideos!==null&&selected.confirmedAudio!==null"
          class="muted" data-testid="assignment-media-counts">
          Видео: {{ selected.confirmedVideos }}{{ selected.videoGoal===null?'':' / '+selected.videoGoal }} · Аудио: {{ selected.confirmedAudio }}{{ selected.audioGoal===null?'':' / '+selected.audioGoal }}
          (только при действующих E2EE-разрешениях)
        </p>
        <p v-if="pendingReceiptCount(selected.id)>0" class="muted">
          Локально ожидают отправки: {{ pendingReceiptCount(selected.id) }} · не включены в прогресс
        </p>

        <template v-if="selected.isOwner">
          <div class="assignment-toolbar">
            <RouterLink :to="'/assignments/'+encodeURIComponent(selected.id)+'/edit'"
              class="fieldwork-editor-link" data-testid="open-fieldwork-editor">Редактор · 4 вкладки</RouterLink>
            <span class="muted">Версия состояния: {{ selected.revision }}</span>
            <span class="muted">Версия правил: {{ selected.policyRevision }}</span>
            <button v-if="selected.state==='active'" type="button"
              :disabled="busy||selected.localState==='queued'||pendingStateChange"
              @click="changeState('finish')">Завершить задание</button>
            <button v-else-if="selected.state==='finished'" type="button"
              :disabled="busy||pendingStateChange||(selected.blockAfterEnd&&selected.endsAt!==null&&selected.endsAt<=Date.now())"
              @click="changeState('resume')">Возобновить задание</button>
          </div>
          <p v-if="pendingStateChange" class="muted" role="status">Подписанное изменение состояния или правил ожидает подтверждения сервера.</p>
          <div v-if="selected.state==='active'" class="foundation-card"
            @input="ownerFormTouched=true" @change="ownerFormTouched=true">
            <h3>Подписанные правила съёмки</h3>
            <label for="assignment-edited-goal">Цель по фото (пусто — без цели)</label>
            <input id="assignment-edited-goal" v-model="editedGoal" type="number" min="1" max="9999" placeholder="Без цели">
            <label class="checkline">
              <input id="assignment-category-required" v-model="editedRequiredCategory" type="checkbox">
              Категория обязательна
            </label>
            <label for="assignment-description-min">Описание: минимум символов (0 — необязательно)</label>
            <input id="assignment-description-min" v-model="editedDescriptionMin"
              type="number" min="0" max="4000">
            <label class="checkline">
              <input id="assignment-gps-required" v-model="editedRequiredGps" type="checkbox">
              GPS обязателен
            </label>
            <label for="assignment-photo-allowed">Фото · допустимые категории (через запятую; пусто — любые)</label>
            <textarea id="assignment-photo-allowed" v-model="editedPhotoAllowed" rows="2" maxlength="1500"/>
            <label for="assignment-photo-required-tags">Фото · обязательные теги (через запятую; пусто — нет)</label>
            <textarea id="assignment-photo-required-tags" v-model="editedPhotoTags" rows="2" maxlength="600"/>
            <p class="muted">Дополнительные типы — отдельное добровольное расширение подписанной политики. Ранее созданные задания разрешают только фото.</p>
            <label class="checkline">
              <input id="assignment-allow-video" v-model="editedAllowVideo" type="checkbox">
              Разрешить видео (E2EE)
            </label>
            <label class="checkline">
              <input id="assignment-allow-audio" v-model="editedAllowAudio" type="checkbox">
              Разрешить аудио (E2EE)
            </label>
            <label v-if="editedAllowVideo" for="assignment-video-goal">Цель по видео (1–999, пусто — без цели)</label>
            <input v-if="editedAllowVideo" id="assignment-video-goal" v-model="editedVideoGoal"
              type="number" min="1" max="999" step="1" placeholder="Без цели">
            <label v-if="editedAllowAudio" for="assignment-audio-goal">Цель по аудио (1–999, пусто — без цели)</label>
            <input v-if="editedAllowAudio" id="assignment-audio-goal" v-model="editedAudioGoal"
              type="number" min="1" max="999" step="1" placeholder="Без цели">
            <div v-if="editedAllowVideo" class="foundation-card">
              <h4>Обязательные приватные поля видео</h4>
              <label class="checkline"><input id="assignment-video-required-category"
                v-model="editedVideoReqCategory" type="checkbox">Категория обязательна</label>
              <label for="assignment-video-description-min">Описание: минимум символов (0 — необязательно)</label>
              <input id="assignment-video-description-min" v-model="editedVideoReqDescription"
                type="number" min="0" max="4000" step="1">
              <label class="checkline"><input id="assignment-video-required-gps"
                v-model="editedVideoReqGps" type="checkbox">GPS обязателен</label>
              <label for="assignment-video-allowed">Допустимые категории видео (через запятую)</label>
              <textarea id="assignment-video-allowed" v-model="editedVideoAllowed" rows="2" maxlength="1500"/>
              <label for="assignment-video-required-tags">Обязательные теги видео (через запятую)</label>
              <textarea id="assignment-video-required-tags" v-model="editedVideoTags" rows="2" maxlength="600"/>
            </div>
            <div v-if="editedAllowAudio" class="foundation-card">
              <h4>Обязательные приватные поля аудио</h4>
              <label class="checkline"><input id="assignment-audio-required-category"
                v-model="editedAudioReqCategory" type="checkbox">Категория обязательна</label>
              <label for="assignment-audio-description-min">Описание: минимум символов (0 — необязательно)</label>
              <input id="assignment-audio-description-min" v-model="editedAudioReqDescription"
                type="number" min="0" max="4000" step="1">
              <label class="checkline"><input id="assignment-audio-required-gps"
                v-model="editedAudioReqGps" type="checkbox">GPS обязателен</label>
              <label for="assignment-audio-allowed">Допустимые категории аудио (через запятую)</label>
              <textarea id="assignment-audio-allowed" v-model="editedAudioAllowed" rows="2" maxlength="1500"/>
              <label for="assignment-audio-required-tags">Обязательные теги аудио (через запятую)</label>
              <textarea id="assignment-audio-required-tags" v-model="editedAudioTags" rows="2" maxlength="600"/>
            </div>
            <p class="muted">Цели — только для подсчёта подтверждённого прогресса. При отключении типа его цель и требования сбрасываются в следующей подписанной версии.</p>
            <button type="button"
              :disabled="busy||selected.localState==='queued'||pendingStateChange"
              @click="changeGoal">Подписать новые правила</button>
            <p class="muted">Допустимые категории и обязательные названия тегов — открытая часть подписанной политики и видны серверу. Фактически выбранная категория, применённые теги, описание и GPS шифруются на устройстве. Это проверка клиента, а не независимое подтверждение происхождения файла или GPS.</p>
          </div>
          <p v-if="pendingPolicyChange" class="muted">Новая версия правил находится в локальной очереди. Старые снимки сохраняют исходную подписанную политику.</p>
          <p class="muted">Завершение прекращает новые отправки в задание и съёмку после закрытия, но не удаляет личные фотографии участников и выданные ранее разрешения.</p>
          <h3>Участники</h3>
          <label for="assignment-recipient-id">ID аккаунта исполнителя</label>
          <input id="assignment-recipient-id" v-model="recipientId" autocomplete="off" spellcheck="false" placeholder="UUID аккаунта">
          <button type="button" :disabled="busy||!recipientId" @click="inspectRecipient">Проверить ключ исполнителя</button>
          <div v-if="ownerCheck" class="fingerprint-panel">
            <strong>Отпечаток исполнителя</strong>
            <code>{{ ownerCheck.fingerprint }}</code>
            <template v-if="!ownerCheck.confirmed">
              <p class="muted">Сверьте отпечаток через независимый канал. Подпись из серверного каталога не заменяет независимую проверку.</p>
              <label class="checkline"><input v-model="checkAgreed" type="checkbox"> Я сверил отпечаток исполнителя</label>
              <button type="button" :disabled="busy||!checkAgreed" @click="approveRecipient">Подтвердить исполнителя</button>
            </template>
            <p v-else class="status-text">Ключ подтверждён</p>
          </div>
          <button v-if="ownerCheck?.confirmed" type="button" :disabled="busy||selected.localState==='queued'" @click="invite">Пригласить исполнителя</button>
          <h3>Подтверждённые материалы</h3>
          <button type="button" :disabled="busy" @click="loadSubmissions">Обновить материалы</button>
          <p v-if="!submissions.length&&!mediaSubmissions.length" class="muted">Нет подтверждённых отправок или доступа по E2EE grant.</p>
          <div v-for="entry in submissions" :key="entry.submissionId" class="photo-row">
            <div><strong>{{ entry.photoId.slice(0,8) }}</strong><small>Автор: {{ entry.contributorAccountId.slice(0,8) }}</small></div>
            <button type="button" :disabled="busy" @click="openSubmission(entry.photoGrantId)">Просмотр</button>
          </div>
          <div v-for="entry in mediaSubmissions" :key="entry.submissionId" class="photo-row" data-testid="assignment-media-submission">
            <div>
              <strong>{{ entry.mediaType==='video'?'Видео':'Аудио' }} · {{ entry.mediaId.slice(0,8) }}</strong>
              <small>{{ entry.capturedInAssignment?'Запись по заданию · подписана':'Личный файл · передан вручную' }}</small>
              <small>Автор: {{ entry.contributorAccountId.slice(0,8) }}</small>
            </div>
            <button type="button" :disabled="busy" @click="openMediaSubmission(entry.mediaGrantId)">Открыть медиа задания</button>
          </div>
        </template>

        <template v-else>
          <h3>Исполнитель</h3>
          <button v-if="invites.find(i=>i.assignmentId===selected?.id&&i.state==='accepted')"
            type="button" :disabled="busy" @click="inspectOwner(invites.find(i=>i.assignmentId===selected?.id&&i.state==='accepted')!)">
            Проверить ключ владельца
          </button>
          <h3>Файлы · мои снимки</h3>
          <p class="muted">Перед передачей проверяются подпись правил, принадлежность фото заданию и обязательные поля. Подписанный E2EE grant даст владельцу задания возможность расшифровать и фото, и метаданные (включая описание и GPS, если указаны). Сервер их не видит. Для личного снимка потребуется отдельное подтверждение.</p>
          <div v-for="photo in eligiblePhotos" :key="photo.key" class="photo-row">
            <div><strong>{{ photo.photoId.slice(0,8) }}</strong>
              <small>{{ photo.capture?'Снято для этого задания':'Личный снимок · отдельная передача' }}</small>
              <small>{{ photo.state }}</small>
            </div>
            <button type="button" :disabled="busy||!contributorCheck?.confirmed" @click="submit(photo)">Отправить в задание</button>
          </div>
          <p v-if="!eligiblePhotos.length" class="muted">Для этого задания нет подходящих синхронизированных фотографий.</p>
          <template v-if="selected.allowedMedia.some(kind=>kind==='video'||kind==='audio')">
            <h3>Видео и аудио · из Browser</h3>
            <p class="muted">Понадобится зашифрованный файл разрешённого типа. До E2EE-передачи проверяются подписанные требования задания к категории, описанию, GPS и тегам; фактические приватные значения серверу недоступны.</p>
            <div v-for="file in eligibleMedia" :key="file.key" class="photo-row">
              <div><strong>{{ file.mediaType==='video'?'Видео':'Аудио' }} · {{ file.mediaId.slice(0,8) }}</strong>
                <small>{{ file.capture?'Снято по заданию · подписано':'Личный медиафайл · требуется согласие' }}</small>
                <small>{{ file.state }} · {{ file.plainBytes.toLocaleString('ru-RU') }} байт</small>
              </div>
              <button type="button" :disabled="busy||!contributorCheck?.confirmed"
                @click="submitMedia(file)">Отправить медиа в задание</button>
            </div>
            <p v-if="!eligibleMedia.length" class="muted">Нет синхронизированных файлов разрешённого типа.</p>
            <RouterLink to="/browser">Импортировать видео или аудио</RouterLink>
            <p><RouterLink :to="{path:'/camera',query:{assignmentId:selected.id}}">Записать видео/аудио по заданию</RouterLink></p>
          </template>
          <RouterLink :to="{path:'/camera',query:{assignmentId:selected.id}}">Камера задания</RouterLink>
        </template>
      </div>

      <div v-if="invites.some(i=>i.state==='pending')" class="foundation-card">
        <h2>Приглашения</h2>
        <div v-for="invitation in invites.filter(i=>i.state==='pending')" :key="invitation.inviteId" class="assignment-invite">
          <div><strong>Задание {{ invitation.assignmentId.slice(0,8) }}</strong>
            <p class="muted">От {{ invitation.ownerAccountId.slice(0,8) }} · до {{ new Date(invitation.expiresAt).toLocaleString() }}</p>
          </div>
          <button type="button" :disabled="busy" @click="inspectOwner(invitation)">Ключ владельца</button>
          <button type="button" :disabled="busy||contributorCheck?.accountId!==invitation.ownerAccountId||!contributorCheck.confirmed" @click="accept(invitation)">Принять задание</button>
        </div>
      </div>
      <div v-if="contributorCheck" class="foundation-card fingerprint-panel">
        <strong>Отпечаток владельца задания</strong>
        <code>{{ contributorCheck.fingerprint }}</code>
        <template v-if="!contributorCheck.confirmed">
          <p class="muted">Сверьте непосредственно с владельцем вне приложения.</p>
          <label class="checkline"><input v-model="incomingAgreed" type="checkbox"> Я сверил отпечаток владельца</label>
          <button type="button" :disabled="busy||!incomingAgreed" @click="approveOwner">Подтвердить владельца</button>
        </template>
        <p v-else class="status-text">Владелец подтверждён</p>
      </div>

      <div v-if="selectedOperations.length" class="foundation-card">
        <h2>Состояние операций</h2>
        <div v-for="op in selectedOperations" :key="op.id" class="photo-row">
          <div><strong>{{ op.kind }}</strong><small>{{ op.state }} · {{ new Date(op.createdAt).toLocaleString() }}</small></div>
          <small v-if="op.lastError" class="error-text">{{ op.lastError }}</small>
        </div>
      </div>

      <div v-if="previewUrl" class="foundation-card">
        <h2>Расшифровано на устройстве</h2>
        <img v-if="previewMime.startsWith('image/')" :src="previewUrl" class="decrypted-preview" alt="Полученная зашифрованная фотография">
        <video v-else-if="previewMime.startsWith('video/')" :src="previewUrl" class="decrypted-preview" controls playsinline preload="metadata"/>
        <audio v-else-if="previewMime.startsWith('audio/')" :src="previewUrl" controls preload="metadata"/>
        <div v-if="previewPrivate" class="muted" data-testid="assignment-decrypted-private-metadata">
          <p v-if="previewPrivate.category">Категория: {{ previewPrivate.category }}</p>
          <p v-if="previewPrivate.description">Описание: {{ previewPrivate.description }}</p>
          <p v-if="previewPrivate.tags?.length">Теги: {{ previewPrivate.tags.join(', ') }}</p>
          <p v-if="previewPrivate.gps">GPS: {{ previewPrivate.gps.latitude }}, {{ previewPrivate.gps.longitude }} (±{{ Math.round(previewPrivate.gps.accuracyMeters) }} м)</p>
          <small>Приватные поля расшифрованы на устройстве по отдельному E2EE-разрешению.</small>
        </div>
        <button type="button" @click="cleanPreview">Закрыть</button>
      </div>

      <p v-if="notice" role="status" class="status-text">{{ notice }}</p>
      <p v-if="error" role="alert" class="error-text">{{ error }}</p>
      <p class="muted assignment-contract-note">Это P1-интеграция. Полный принятый UX Fieldwork 5.0 и редактор 2.2 не считаются внедрёнными. Готовность сервера определяется подтверждёнными операциями, а не локальными состояниями.</p>
    </template>
  </section>
</template>
