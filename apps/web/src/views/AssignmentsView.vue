<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeSession, reauthenticate } from '../features/identity/application/session'
import {
  queueAssignmentCreation, listLocalAssignmentDrafts,
  listServerAssignments, listCachedAssignmentSnapshots, listAssignmentInvites,
  cachePrivateAssignment, readCachedPrivateAssignment, listAssignmentOperations,
  queueAssignmentInvitation, queueAssignmentAcceptance,
  queueAssignmentSubmission, listAssignmentSubmissions, flushAssignmentOutbox,
  queueAssignmentStateTransition,
  verifyAssignmentInvite,
} from '../features/assignments/application/assignment-outbox'
import type {
  ReceivedAssignmentInvite, AssignmentOperation, AssignmentListing,
} from '../features/assignments/application/assignment-outbox'
import {
  openOwnerAssignment, openRecipientAssignment,
} from '../features/assignments/infrastructure/assignment-crypto'
import type { PrivateAssignment } from '../features/assignments/infrastructure/assignment-crypto'
import {
  ensureOwnExchangeKey, inspectPeer, confirmPeer,
} from '../features/sharing/key-directory'
import { queueRecipientGrant, flushRecipientGrants, readReceivedPhoto } from '../features/sharing/grant-flow'
import { listLocalPhotos, flushOutbox } from '../features/photo-sync/application/p1-photo'
import type { StoredPhoto } from '../features/photo-sync/application/p1-photo'

type VisibleAssignment={
  id:string;ownerAccountId:string;data:PrivateAssignment|null
  state:string;revision:number;localState?:string;goal:number|null
  confirmedPhotos:number|null // null = no authenticated server receipt count yet
  createdAt:number;isOwner:boolean;startsAt:number;endsAt:number|null
}
type SafetyCheck={accountId:string;fingerprint:string;confirmed:boolean}
type Submission={submissionId:string;photoId:string;photoGrantId:string;contributorAccountId:string}

const assignments=ref<VisibleAssignment[]>([])
const invites=ref<ReceivedAssignmentInvite[]>([])
const operations=ref<AssignmentOperation[]>([])
const photos=ref<StoredPhoto[]>([])
const submissions=ref<Submission[]>([])
const selectedId=ref('')
const title=ref('')
const instructions=ref('')
const goal=ref<string|number>('')
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
const filters=ref<'all'|'active'>('active')

const selected=computed(()=>assignments.value.find(a=>a.id===selectedId.value)??null)
const visible=computed(()=>assignments.value
  .filter(a=>filters.value==='all'||a.state==='active'||a.localState==='queued')
  .filter(a=>(a.data?.title??'').toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
      ||a.id.toLowerCase().includes(search.value.toLowerCase()))
  .sort((a,b)=>b.createdAt-a.createdAt))
const count=computed(()=>assignments.value.length)
const activeCount=computed(()=>assignments.value.filter(a=>a.state==='active').length)
const finishedCount=computed(()=>assignments.value.filter(a=>a.state==='finished').length)
const selectedOperations=computed(()=>operations.value.filter(op=>
  op.contract.includes(selectedId.value)&&!!selectedId.value))
const pendingStateChange=computed(()=>selectedOperations.value.some(op=>
  op.kind==='state'&&(op.state==='queued'||op.state==='retry')))
const eligiblePhotos=computed(()=>photos.value
  .filter(p=>p.state==='synced'
    &&(!p.capture||p.capture.assignmentId===selectedId.value))
  .sort((a,b)=>Number(!!b.capture)-Number(!!a.capture)))
function progressPercentage(assignment:VisibleAssignment):number|null{
  if(assignment.goal===null||assignment.confirmedPhotos===null)return null
  return Math.min(100,Math.round(assignment.confirmedPhotos/assignment.goal*100))
}
function pendingReceiptCount(assignmentId:string):number{
  const queuedCaptures=photos.value.filter(p=>p.capture?.assignmentId===assignmentId
    &&(p.state==='queued'||p.state==='retry')).length
  const queuedSubmissions=operations.value.filter(op=>{
    if(op.kind!=='submit'||(op.state!=='queued'&&op.state!=='retry'))return false
    try{
      const body=JSON.parse(op.contract) as {assignmentId?:string}
      return body.assignmentId===assignmentId
    }catch{return false}
  }).length
  return queuedCaptures+queuedSubmissions
}

function cleanPreview():void{
  if(previewUrl.value){URL.revokeObjectURL(previewUrl.value);previewUrl.value=''}
}
function resetSensitive():void {
  assignments.value=[];invites.value=[];operations.value=[];photos.value=[]
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
  const [local,ops,localPhotos]=await Promise.all([
    listLocalAssignmentDrafts(),listAssignmentOperations(),listLocalPhotos(),
  ])
  if(activeSession.value!==identity)return
  operations.value=ops;photos.value=localPhotos
  const localRows:VisibleAssignment[]=await Promise.all(local.map(async item=>{
    let data:PrivateAssignment|null=null
    try{data=await openOwnerAssignment(identity.pkg,item.id,item.privateEnvelope)}
    catch { /* a corrupted local envelope must never reveal plaintext */ }
    return {
      id:item.id,ownerAccountId:item.ownerAccountId,data,
      state:'active',revision:1,localState:item.state,goal:item.photoGoal,
      confirmedPhotos:null,
      createdAt:item.createdAt,isOwner:true,startsAt:item.startsAt,endsAt:item.endsAt,
    }
  }))
  if(activeSession.value!==identity)return
  assignments.value=localRows
  const offline=!identity.online||!navigator.onLine
  showingOfflineSnapshot.value=offline
  let snapshots:AssignmentListing[]
  let received:ReceivedAssignmentInvite[]
  if(offline){
    // A warm offline route can read only previously authenticated, signed
    // cached assignments. This is NOT proof of current server membership.
    ;[snapshots,received]=await Promise.all([
      listCachedAssignmentSnapshots(),listAssignmentInvites(),
    ])
  }else{
    const [server,invitesFromServer]=await Promise.all([
      listServerAssignments(),listAssignmentInvites(),
    ])
    snapshots=server.items
    received=invitesFromServer
  }
  if(activeSession.value!==identity)return
  invites.value=received
  const rows=[...localRows]
  for(const item of snapshots){
    const previous=rows.find(a=>a.id===item.assignmentId)
    let data=previous?.data??null
    if(!data){
      try{
        if(item.ownerAccountId===identity.accountId){
          data=await openOwnerAssignment(identity.pkg,item.assignmentId,item.privateEnvelope)
        }else{
          const invite=received.find(i=>i.assignmentId===item.assignmentId&&i.state==='accepted')
          if(invite){
            await verifyAssignmentInvite(invite) // independently pinned owner SPKI
            if(offline){
              // No network key-directory access is attempted offline. Only
              // an existing AEAD-encrypted account-scoped summary is opened.
              data=await readCachedPrivateAssignment(item.assignmentId,item.policyContract)
            }else{
              const contract=JSON.parse(invite.contract)
              const own=await ensureOwnExchangeKey()
              data=await openRecipientAssignment(own.privateKey,{
                assignmentId:item.assignmentId,inviteId:invite.inviteId,
                ownerAccountId:item.ownerAccountId,
                recipientAccountId:identity.accountId,
                role:'contributor',expiresAt:invite.expiresAt,
              },contract.envelope,item.privateEnvelope)
              await cachePrivateAssignment(item.assignmentId,item.policyContract,data)
            }
          }
        }
      }catch{/* unconfirmed peer or invalid ciphertext remains opaque */}
    }
    const row:VisibleAssignment={
      id:item.assignmentId,ownerAccountId:item.ownerAccountId,data,
      state:item.state,revision:item.revision,localState:previous?.localState,
      goal:item.photoGoal,confirmedPhotos:offline?null:item.confirmedPhotoCount,
      createdAt:previous?.createdAt??item.startsAt,
      isOwner:item.ownerAccountId===identity.accountId,
      startsAt:item.startsAt,endsAt:item.endsAt,
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
function choose(assignmentId:string):void{
  selectedId.value=assignmentId;ownerCheck.value=null
  contributorCheck.value=null;recipientId.value=''
  submissions.value=[];cleanPreview()
  if(selected.value?.isOwner)void loadSubmissions()
}
async function loadSubmissions():Promise<void>{
  const id=selectedId.value
  const owner=selected.value
  if(!owner?.isOwner||!activeSession.value?.online)return
  try{
    const result=await listAssignmentSubmissions(id)
    if(selectedId.value===id)submissions.value=result
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
    // The recipient never gains access merely through assignment membership.
    const grantId=await queueRecipientGrant(photo.photoId,target.ownerAccountId)
    await queueAssignmentSubmission(target.id,photo.photoId,grantId)
    await flushRecipientGrants()
    await flushAssignmentOutbox()
    operations.value=await listAssignmentOperations()
    notice.value='Зашифрованный grant и отправка задания поставлены в очередь'
  })
}
async function openSubmission(grantId:string):Promise<void>{
  await operate(async()=>{
    const blob=await readReceivedPhoto(grantId) // verifies pinned owner + DEK and server ACL
    cleanPreview()
    previewUrl.value=URL.createObjectURL(blob)
    notice.value='Фотография расшифрована только на этом устройстве'
  })
}
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
        <p class="muted">Название и инструкции шифруются до сохранения. Цель нужна только для прогресса, не ограничивает число файлов.</p>
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
            <span class="assignment-state">{{ assignment.localState==='queued'?'В очереди':assignment.state==='active'?'Активно':assignment.state==='finished'?'Завершено':assignment.state }}</span>
          </div>
          <p v-if="assignment.data?.instructions" class="assignment-description">{{ assignment.data.instructions }}</p>
          <div class="assignment-card-bottom">
            <div class="assignment-card-progress">
              <span v-if="assignment.confirmedPhotos!==null">
                Фото: {{ assignment.confirmedPhotos }}{{ assignment.goal===null?'':' / '+assignment.goal }}
                <template v-if="progressPercentage(assignment)!==null">
                  · {{ progressPercentage(assignment) }}%
                </template>
              </span>
              <span v-else class="muted">Фото: цель {{ assignment.goal??'не задана' }} · ожидает подтверждения</span>
              <progress v-if="assignment.goal!==null&&assignment.confirmedPhotos!==null"
                :max="assignment.goal" :value="Math.min(assignment.confirmedPhotos,assignment.goal)"
                :aria-label="'Подтверждённый прогресс по фото '+assignment.id"/>
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
        <p class="muted">Тип: фото · {{ selected.goal===null?'без цели':'Цель: '+selected.goal }} · {{ selected.isOwner?'Владелец':'Исполнитель' }}</p>
        <p v-if="selected.confirmedPhotos!==null" class="muted">
          Подтверждено сервером: {{ selected.confirmedPhotos }}
          <template v-if="selected.goal!==null"> / {{ selected.goal }} · {{ progressPercentage(selected) }}%</template>
        </p>
        <p v-if="pendingReceiptCount(selected.id)>0" class="muted">
          Локально ожидают отправки: {{ pendingReceiptCount(selected.id) }} · не включены в прогресс
        </p>

        <template v-if="selected.isOwner">
          <div class="assignment-toolbar">
            <span class="muted">Версия состояния: {{ selected.revision }}</span>
            <button v-if="selected.state==='active'" type="button"
              :disabled="busy||selected.localState==='queued'||pendingStateChange"
              @click="changeState('finish')">Завершить задание</button>
            <button v-else-if="selected.state==='finished'" type="button"
              :disabled="busy||pendingStateChange||(selected.endsAt!==null&&selected.endsAt<=Date.now())"
              @click="changeState('resume')">Возобновить задание</button>
          </div>
          <p v-if="pendingStateChange" class="muted" role="status">Подписанное изменение состояния ожидает подтверждения сервера.</p>
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
          <p v-if="!submissions.length" class="muted">Нет подтверждённых отправок или доступа по E2EE grant.</p>
          <div v-for="entry in submissions" :key="entry.submissionId" class="photo-row">
            <div><strong>{{ entry.photoId.slice(0,8) }}</strong><small>Автор: {{ entry.contributorAccountId.slice(0,8) }}</small></div>
            <button type="button" :disabled="busy" @click="openSubmission(entry.photoGrantId)">Просмотр</button>
          </div>
        </template>

        <template v-else>
          <h3>Исполнитель</h3>
          <button v-if="invites.find(i=>i.assignmentId===selected?.id&&i.state==='accepted')"
            type="button" :disabled="busy" @click="inspectOwner(invites.find(i=>i.assignmentId===selected?.id&&i.state==='accepted')!)">
            Проверить ключ владельца
          </button>
          <h3>Файлы · мои снимки</h3>
          <p class="muted">Выберите синхронизированный снимок. Передача создаст отдельное зашифрованное разрешение; участие в задании само по себе не раскрывает фото.</p>
          <div v-for="photo in eligiblePhotos" :key="photo.key" class="photo-row">
            <div><strong>{{ photo.photoId.slice(0,8) }}</strong>
              <small>{{ photo.capture?'Снято для этого задания':'Личный снимок · отдельная передача' }}</small>
              <small>{{ photo.state }}</small>
            </div>
            <button type="button" :disabled="busy||!contributorCheck?.confirmed" @click="submit(photo)">Отправить в задание</button>
          </div>
          <p v-if="!eligiblePhotos.length" class="muted">Для этого задания нет подходящих синхронизированных фотографий.</p>
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
        <img :src="previewUrl" class="decrypted-preview" alt="Полученная зашифрованная фотография">
        <button type="button" @click="cleanPreview">Закрыть</button>
      </div>

      <p v-if="notice" role="status" class="status-text">{{ notice }}</p>
      <p v-if="error" role="alert" class="error-text">{{ error }}</p>
      <p class="muted assignment-contract-note">Это P1-интеграция. Полный принятый UX Fieldwork 5.0 и редактор 2.2 не считаются внедрёнными. Готовность сервера определяется подтверждёнными операциями, а не локальными состояниями.</p>
    </template>
  </section>
</template>
