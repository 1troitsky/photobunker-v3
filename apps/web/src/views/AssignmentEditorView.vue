<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink, useRoute } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import {
  flushAssignmentOutbox, listAssignmentOperations,
  listCachedAssignmentSnapshots, listServerAssignments,
  queueAssignmentInvitation, queueAssignmentPolicyChange,
  queueAssignmentPrivateTextChange,effectiveAssignmentEnvelope,
  queueAssignmentScheduleChange,signedAssignmentSchedule,
  queueAssignmentRetentionChange,signedAssignmentRetention,
  verifySignedAssignmentPolicy,listAssignmentParticipants,
} from '../features/assignments/application/assignment-outbox'
import type { AssignmentListing,AssignmentParticipant } from '../features/assignments/application/assignment-outbox'
import { scheduleDraftFromListing,buildEditorSchedule } from '../features/assignments/application/schedule-editor'
import type { ScheduleEditorDraft } from '../features/assignments/application/schedule-editor'
import {retentionDraftFromListing,buildEditorRetention} from '../features/assignments/application/retention-editor'
import type {RetentionDraft} from '../features/assignments/application/retention-editor'
import { blankEditorDraft,buildEditorPolicy,editorDraftFromListing } from '../features/assignments/application/assignment-editor-model'
import type { EditorDraft } from '../features/assignments/application/assignment-editor-model'
import { openOwnerAssignment, upgradePrivateAssignment } from '../features/assignments/infrastructure/assignment-crypto'
import type { PrivateAssignment, PrivateAssignmentV2 } from '../features/assignments/infrastructure/assignment-crypto'
import { confirmPeer, inspectPeer } from '../features/sharing/key-directory'

type Tab='main'|'files'|'people'|'rules'
const tabs:ReadonlyArray<{id:Tab;label:string}>=[
  {id:'main',label:'Основное'},
  {id:'files',label:'Файлы'},
  {id:'people',label:'Участники'},
  {id:'rules',label:'Правила'},
]
const route=useRoute()
const assignmentId=computed(()=>String(route.params.assignmentId??''))
const activeTab=ref<Tab>('main')
const draft=reactive<EditorDraft>(blankEditorDraft())
const scheduleDraft=reactive<ScheduleEditorDraft>({
  startsAt:'',endsAt:'',blockBeforeStart:true,blockAfterEnd:false,
})
const retentionDraft=reactive<RetentionDraft>({
  filesEnabled:false,filesDate:'',assignmentEnabled:false,assignmentDate:'',
})
const listing=ref<AssignmentListing|null>(null)
const title=ref('')
const instructions=ref('')
const photoInstructions=ref('')
const videoInstructions=ref('')
const audioInstructions=ref('')
const loadState=ref<'loading'|'offline'|'fresh'|'missing'>('loading')
const busy=ref(false)
const pending=ref(false)
const error=ref('')
const notice=ref('')
const baseline=ref('')
const baselineRevision=ref<number|null>(null)
const baselinePrivateRevision=ref<number|null>(null)
const baselineText=ref('')
const baselineSchedule=ref('')
const baselineScheduleRevision=ref<number|null>(null)
const baselineRetention=ref('')
const baselineRetentionRevision=ref<number|null>(null)
const participants=ref<AssignmentParticipant[]>([])
const rosterStatus=ref<'idle'|'loading'|'ready'|'offline'|'error'>('idle')
const rosterError=ref('')
const peerId=ref('')
const peerFingerprint=ref('')
const peerConfirmed=ref(false)
const peerAgreed=ref(false)
let run=0
function privateForm():PrivateAssignmentV2{
  return {
    version:2,title:title.value.trim(),instructions:instructions.value,
    photoInstructions:photoInstructions.value,videoInstructions:videoInstructions.value,
    audioInstructions:audioInstructions.value,
  }
}
function applyPrivate(value:PrivateAssignment):void{
  const next=upgradePrivateAssignment(value)
  title.value=next.title;instructions.value=next.instructions
  photoInstructions.value=next.photoInstructions
  videoInstructions.value=next.videoInstructions
  audioInstructions.value=next.audioInstructions
  baselineText.value=JSON.stringify(privateForm())
}
function clearPrivate():void{
  title.value='';instructions.value='';photoInstructions.value=''
  videoInstructions.value='';audioInstructions.value=''
}
const dirtyPolicy=computed(()=>!!baseline.value&&JSON.stringify(draft)!==baseline.value)
const dirtyText=computed(()=>!!baselineText.value&&JSON.stringify(privateForm())!==baselineText.value)
const dirtySchedule=computed(()=>!!baselineSchedule.value
  &&JSON.stringify(scheduleDraft)!==baselineSchedule.value)
const dirtyRetention=computed(()=>!!baselineRetention.value
  &&JSON.stringify(retentionDraft)!==baselineRetention.value)
const dirty=computed(()=>dirtyPolicy.value||dirtyText.value
  ||dirtySchedule.value||dirtyRetention.value)
const owner=computed(()=>!!activeSession.value&&listing.value?.ownerAccountId===activeSession.value.accountId)
const editable=computed(()=>owner.value&&listing.value?.state==='active'
  &&!pending.value&&!busy.value)
function sameIdentity(a:typeof activeSession.value,b:typeof activeSession.value):boolean{
  return !!a&&!!b&&a.accountId===b.accountId&&a.deviceId===b.deviceId
    &&a.pkg.accountSpki===b.pkg.accountSpki&&a.pkg.revision===b.pkg.revision
}
function fail(e:unknown):string{return e instanceof Error?e.message:'assignment.editor_error'}
function apply(row:AssignmentListing):void{
  const values=editorDraftFromListing(row)
  Object.assign(draft,values)
  baseline.value=JSON.stringify(values)
  baselineRevision.value=row.policyRevision
  listing.value=row
}
function applySchedule(row:AssignmentListing):void{
  const form=scheduleDraftFromListing(row)
  Object.assign(scheduleDraft,form)
  baselineSchedule.value=JSON.stringify(form)
  baselineScheduleRevision.value=row.scheduleRevision??1
}
function applyRetention(row:AssignmentListing):void{
  const values=retentionDraftFromListing(row)
  Object.assign(retentionDraft,values)
  baselineRetention.value=JSON.stringify(values)
  baselineRetentionRevision.value=row.retentionRevision??1
}
async function fromRow(row:AssignmentListing,session:NonNullable<typeof activeSession.value>,
  generation:number):Promise<void>{
  await verifySignedAssignmentPolicy(row,loadState.value==='offline')
  if(!sameIdentity(activeSession.value,session)||run!==generation)return
  if(row.ownerAccountId!==session.accountId)throw Error('assignment.owner_required')
  const decrypted=await openOwnerAssignment(session.pkg,row.assignmentId,
    row.privateEnvelope,effectiveAssignmentEnvelope(row))
  if(!sameIdentity(activeSession.value,session)||run!==generation)return
  if(dirty.value&&(baselineRevision.value!==row.policyRevision
    ||baselinePrivateRevision.value!==(row.privateRevision??1)
    ||baselineScheduleRevision.value!==(row.scheduleRevision??1)
    ||baselineRetentionRevision.value!==(row.retentionRevision??1))){
    notice.value='Подписанная версия изменилась. Отмените локальные правки и обновите перед сохранением.'
    return
  }
  if(!dirtyPolicy.value)apply(row)
  if(!dirtySchedule.value)applySchedule(row)
  if(!dirtyRetention.value)applyRetention(row)
  if(!dirtyText.value){
    applyPrivate(decrypted)
    baselinePrivateRevision.value=row.privateRevision??1
  }
  pending.value=(await listAssignmentOperations()).some(op=>{
    if(!['policy','private','schedule','retention'].includes(op.kind)
      ||!['queued','retry'].includes(op.state))return false
    try{return (JSON.parse(op.contract) as {assignmentId?:string}).assignmentId===row.assignmentId}
    catch{return false}
  })
}
async function refreshRoster(
  id=assignmentId.value,session=activeSession.value,generation=run,
):Promise<void>{
  participants.value=[]
  rosterError.value=''
  if(!session||!session.online||!navigator.onLine){
    rosterStatus.value='offline'
    return
  }
  rosterStatus.value='loading'
  try{
    const fresh=await listAssignmentParticipants(id)
    if(!sameIdentity(session,activeSession.value)||generation!==run
      ||assignmentId.value!==id)return
    participants.value=fresh;rosterStatus.value='ready'
  }catch(e){
    if(!sameIdentity(session,activeSession.value)||generation!==run)return
    rosterStatus.value='error';rosterError.value=fail(e)
  }
}
async function refresh():Promise<void>{
  const generation=++run
  const session=activeSession.value
  participants.value=[];rosterStatus.value='idle';rosterError.value=''
  error.value=''
  if(!session){listing.value=null;loadState.value='missing';return}
  const id=assignmentId.value
  const cached=(await listCachedAssignmentSnapshots()).find(x=>x.assignmentId===id)
  if(!sameIdentity(session,activeSession.value)||run!==generation)return
  if(cached){
    loadState.value='offline'
    try{await fromRow(cached,session,generation)}
    catch(e){error.value=fail(e)}
  }
  if(!session.online||!navigator.onLine){
    // Restored warm-offline accounts cannot authenticate live roster states.
    rosterStatus.value='offline'
    if(!cached)loadState.value='missing'
    return
  }
  try{
    let cursor:string|undefined
    let latest:AssignmentListing|undefined
    do{
      const page=await listServerAssignments(cursor)
      latest=page.items.find(x=>x.assignmentId===id)
      cursor=page.nextCursor??undefined
    }while(!latest&&cursor)
    if(!sameIdentity(session,activeSession.value)||run!==generation)return
    if(!latest){if(!cached)loadState.value='missing';return}
    await fromRow(latest,session,generation)
    if(run===generation){
      loadState.value='fresh'
      void refreshRoster(id,session,generation)
    }
  }catch(e){
    if(run===generation){
      if(!cached)loadState.value='missing'
      error.value=fail(e)
    }
  }
}
async function undo():Promise<void>{
  const row=listing.value,session=activeSession.value
  if(!row||!session)return
  try{
    const data=await openOwnerAssignment(session.pkg,row.assignmentId,
      row.privateEnvelope,effectiveAssignmentEnvelope(row))
    if(!sameIdentity(session,activeSession.value))throw Error('identity.changed')
    apply(row)
    applySchedule(row)
    applyRetention(row)
    applyPrivate(data)
    baselinePrivateRevision.value=row.privateRevision??1
    error.value='';notice.value=''
  }catch(e){error.value=fail(e)}
}
async function save():Promise<void>{
  if(!editable.value||!dirty.value||!listing.value)return
  const session=activeSession.value
  if(!session)return
  busy.value=true;error.value='';notice.value=''
  try{
    // Online freshness: prevent a stale editor from silently overwriting
    // a newer, independently owner-signed policy revision.
    if(session.online&&navigator.onLine){
      let fresh:AssignmentListing|undefined
      let cursor:string|undefined
      do{
        const page=await listServerAssignments(cursor)
        fresh=page.items.find(x=>x.assignmentId===assignmentId.value)
        cursor=page.nextCursor??undefined
      }while(!fresh&&cursor)
      if(!fresh||fresh.policyRevision!==baselineRevision.value
        ||(fresh.privateRevision??1)!==baselinePrivateRevision.value
        ||(fresh.scheduleRevision??1)!==baselineScheduleRevision.value
        ||(fresh.retentionRevision??1)!==baselineRetentionRevision.value)
        throw Error('assignment.editor_revision_changed')
    }else if(listing.value.policyRevision!==baselineRevision.value
      ||(listing.value.privateRevision??1)!==baselinePrivateRevision.value
      ||(listing.value.scheduleRevision??1)!==baselineScheduleRevision.value
      ||(listing.value.retentionRevision??1)!==baselineRetentionRevision.value)
      throw Error('assignment.editor_revision_changed')
    if(!sameIdentity(session,activeSession.value))throw Error('identity.changed')
    const policy=dirtyPolicy.value?buildEditorPolicy(draft):null
    const text=dirtyText.value?privateForm():null
    // Validate all changed representations before persisting signed operations.
    const previousSchedule=signedAssignmentSchedule(listing.value)
    const schedule=dirtySchedule.value
      ?buildEditorSchedule(scheduleDraft,previousSchedule)
      :null
    const previousRetention=signedAssignmentRetention(listing.value)
    const retention=dirtyRetention.value
      ?buildEditorRetention(retentionDraft,previousRetention,
        (schedule??previousSchedule).endsAt)
      :null
    const effectiveRetention=retention??previousRetention
    const desiredEnd=(schedule??previousSchedule).endsAt
    if(desiredEnd!==null
      &&[effectiveRetention.filesAccessUntil,
        effectiveRetention.assignmentAccessUntil].some(d=>d!==null&&d<desiredEnd))
      throw Error('assignment.retention_before_schedule_end')
    // The two independent contracts are not atomic. Select the only safe
    // order if an old deadline would invalidate the new schedule. If the
    // combined change requires an unavailable atomic swap, fail closed.
    const retentionFirst=!!schedule&&!!retention
      &&[previousRetention.filesAccessUntil,
        previousRetention.assignmentAccessUntil].some(d=>
          d!==null&&schedule.endsAt!==null&&d<schedule.endsAt)
    if(retentionFirst&&previousSchedule.endsAt!==null
      &&[retention!.filesAccessUntil,retention!.assignmentAccessUntil]
        .some(d=>d!==null&&d<previousSchedule.endsAt!))
      throw Error('assignment.schedule_retention_change_needs_two_steps')
    if(text&&(!text.title||text.title.length>120||text.instructions.length>4000
      ||[text.photoInstructions,text.videoInstructions,text.audioInstructions]
        .some(v=>v.length>2000)))
      throw Error('assignment.invalid_text')
    const ids:string[]=[]
    try{
      if(policy)ids.push(await queueAssignmentPolicyChange(assignmentId.value,policy))
      if(text)ids.push(await queueAssignmentPrivateTextChange(assignmentId.value,text))
      if(retentionFirst&&retention)
        ids.push(await queueAssignmentRetentionChange(assignmentId.value,retention))
      if(schedule)ids.push(await queueAssignmentScheduleChange(assignmentId.value,schedule))
      if(!retentionFirst&&retention)
        ids.push(await queueAssignmentRetentionChange(assignmentId.value,retention))
    }catch(e){
      // Partial dual-event signing never becomes an invisible failure.
      if(ids.length)pending.value=true
      throw e
    }
    pending.value=ids.length>0
    notice.value='Подписанное изменение сохранено локально в зашифрованной очереди.'
    if(session.online&&navigator.onLine){
      await flushAssignmentOutbox()
      if(!sameIdentity(session,activeSession.value))throw Error('identity.changed')
      const ops=await listAssignmentOperations()
      const results=ids.map(id=>ops.find(x=>x.id===id))
      const rejected=results.filter(op=>op?.state==='conflict')
      if(rejected.length){
        // A terminal 403/409/410/422 is NOT an upload in progress. Keep
        // local user edits for explicit reconciliation; never fake success.
        pending.value=false
        error.value='Сервер отклонил подписанное изменение: '
          +rejected.map(op=>op?.lastError??'assignment.conflict').join(', ')
          +'. Обновите подписанную версию и проверьте изменения.'
        notice.value=results.some(op=>op?.state==='sent')
          ?'Часть независимых изменений принята, остальные требуют сверки.'
          :'Ни одно отклонённое изменение не принято сервером.'
      }else if(results.every(op=>op?.state==='sent')){
        notice.value='Изменение подписано и принято сервером.'
        pending.value=false
        baseline.value='';baselineText.value='';baselineSchedule.value=''
        baselineRetention.value=''
        await refresh()
      }else{
        notice.value='Подписанное изменение ожидает подтверждения сервера.'
      }
    }
  }catch(e){error.value=fail(e)}
  finally{busy.value=false}
}
function peerReset():void{peerFingerprint.value='';peerConfirmed.value=false;peerAgreed.value=false}
async function peerInspect():Promise<void>{
  if(!owner.value)return
  busy.value=true;error.value='';notice.value=''
  try{
    const id=peerId.value.trim().toLowerCase()
    if(id===activeSession.value?.accountId)throw Error('assignment.cannot_invite_self')
    const {directory,confirmed}=await inspectPeer(id)
    peerId.value=id
    peerFingerprint.value=directory.safetyFingerprint
    peerConfirmed.value=confirmed
    peerAgreed.value=false
  }catch(e){peerReset();error.value=fail(e)}
  finally{busy.value=false}
}
async function peerApprove():Promise<void>{
  if(!peerFingerprint.value||!peerAgreed.value)return
  busy.value=true;error.value=''
  try{
    await confirmPeer(peerId.value,peerFingerprint.value)
    peerConfirmed.value=true
    notice.value='Отпечаток независимо подтверждён на этом устройстве.'
  }catch(e){error.value=fail(e)}
  finally{busy.value=false}
}
async function invite():Promise<void>{
  if(!owner.value||!peerConfirmed.value||!listing.value)return
  busy.value=true;error.value=''
  try{
    const id=await queueAssignmentInvitation(assignmentId.value,peerId.value)
    notice.value='Подписанное приглашение в очереди: '+id.slice(0,8)
    if(activeSession.value?.online&&navigator.onLine){
      await flushAssignmentOutbox()
      void refreshRoster()
    }
    peerReset()
  }catch(e){error.value=fail(e)}
  finally{busy.value=false}
}
function keyTab(e:KeyboardEvent):void{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
  e.preventDefault()
  const index=tabs.findIndex(t=>t.id===activeTab.value)
  const next=e.key==='Home'?0:e.key==='End'?tabs.length-1
    :(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length
  activeTab.value=tabs[next]!.id
  const buttons=document.querySelectorAll<HTMLButtonElement>('.fieldwork-editor-tabs [role="tab"]')
  buttons[next]?.focus()
}
onBeforeRouteLeave(()=>{
  if(dirty.value&&!pending.value)
    return window.confirm('Отменить несохранённые изменения задания?')
})
watch(activeSession,(next,previous)=>{
  if(!sameIdentity(next,previous)){
    ++run
    listing.value=null;clearPrivate()
    baseline.value='';baselineRevision.value=null
    baselineText.value='';baselinePrivateRevision.value=null
  baselineSchedule.value='';baselineScheduleRevision.value=null
  baselineRetention.value='';baselineRetentionRevision.value=null
    Object.assign(draft,blankEditorDraft())
    Object.assign(scheduleDraft,{
      startsAt:'',endsAt:'',blockBeforeStart:true,blockAfterEnd:false,
    })
    Object.assign(retentionDraft,{
      filesEnabled:false,filesDate:'',assignmentEnabled:false,assignmentDate:'',
    })
    peerReset()
    loadState.value='loading'
    void refresh()
  }else if(next?.online&&!previous?.online){
    // Session proof may complete AFTER editor's first offline render.
    // A same-identity offline→online transition must refresh live roster.
    // Never discard local edits merely because network auth recovered.
    void refresh()
  }
})
watch(assignmentId,()=>{
  clearPrivate();listing.value=null
  baseline.value='';baselineRevision.value=null
  baselineText.value='';baselinePrivateRevision.value=null
  baselineSchedule.value='';baselineScheduleRevision.value=null
  baselineRetention.value='';baselineRetentionRevision.value=null
  Object.assign(draft,blankEditorDraft())
  Object.assign(scheduleDraft,{
    startsAt:'',endsAt:'',blockBeforeStart:true,blockAfterEnd:false,
  })
  Object.assign(retentionDraft,{
    filesEnabled:false,filesDate:'',assignmentEnabled:false,assignmentDate:'',
  })
  peerReset()
  activeTab.value='main';loadState.value='loading'
  void refresh()
})
onMounted(()=>{void refresh()})
watch(()=>scheduleDraft.endsAt,(value)=>{
  if(!value)scheduleDraft.blockAfterEnd=false
})
onUnmounted(()=>{++run;clearPrivate();baseline.value='';baselineText.value='';baselineSchedule.value='';baselineRetention.value=''})
</script>

<template>
  <section class="fieldwork-editor foundation-content" data-testid="fieldwork-assignment-editor">
    <div class="fieldwork-editor-top">
      <RouterLink to="/assignments" class="fieldwork-editor-back">‹ Назад к заданиям</RouterLink>
      <div class="fieldwork-editor-heading">
        <div>
          <h1>Редактор задания</h1>
          <p class="muted">{{ title||'Зашифрованное задание' }}</p>
        </div>
        <span class="fieldwork-editor-state">{{ loadState==='fresh'?'Проверено сервером':
          loadState==='offline'?'Подписанная офлайн-копия':
          loadState==='missing'?'Нет доступного задания':'Загрузка локального состояния' }}</span>
      </div>
    </div>
    <template v-if="!activeSession">
      <div class="foundation-card">Для редактирования нужен восстановленный аккаунт.
        <RouterLink to="/settings">Настройки</RouterLink>
      </div>
    </template>
    <template v-else-if="!owner">
      <div class="foundation-card" role="status">
        Задание недоступно для редактирования либо его подпись ещё не проверена.
        <button type="button" :disabled="busy" @click="refresh">Повторить проверку</button>
      </div>
    </template>
    <template v-else>
      <div class="fieldwork-editor-tabs" role="tablist" aria-label="Вкладки редактора задания" @keydown="keyTab">
        <button v-for="item in tabs" :key="item.id" type="button" role="tab"
          :id="'editor-tab-'+item.id" :aria-selected="activeTab===item.id"
          :aria-controls="'editor-panel-'+item.id"
          :class="{active:activeTab===item.id}"
          :tabindex="activeTab===item.id?0:-1"
          @click="activeTab=item.id">{{ item.label }}</button>
      </div>

      <div v-if="activeTab==='main'" id="editor-panel-main"
        role="tabpanel" aria-labelledby="editor-tab-main" class="fieldwork-editor-panel">
        <h2>Основное</h2>
        <p class="muted">Название и инструкции шифруются до отправки. Новый подписанный E2EE-конверт сохраняет действующие ключи приглашённых участников; изменений не происходит до явного сохранения.</p>
        <label for="editor-private-title">Название</label>
        <input id="editor-private-title" v-model="title" data-testid="editor-private-title"
          maxlength="120" autocomplete="off" :disabled="!editable" required>
        <label for="editor-private-instructions">Инструкции</label>
        <textarea id="editor-private-instructions" v-model="instructions"
          rows="5" maxlength="4000" :disabled="!editable" placeholder="Инструкции для исполнителя"/>
        <div class="fieldwork-editor-grid">
          <div>
            <label for="editor-schedule-start">Начало задания</label>
            <input id="editor-schedule-start" type="datetime-local"
              v-model="scheduleDraft.startsAt" :disabled="!editable" required>
            <label class="checkline">
              <input id="editor-block-before" v-model="scheduleDraft.blockBeforeStart"
                type="checkbox" :disabled="!editable">
              Запретить добавление до начала
            </label>
          </div>
          <div>
            <label for="editor-schedule-end">Окончание (необязательно)</label>
            <input id="editor-schedule-end" type="datetime-local"
              v-model="scheduleDraft.endsAt" :disabled="!editable">
            <label class="checkline">
              <input id="editor-block-after" v-model="scheduleDraft.blockAfterEnd"
                type="checkbox" :disabled="!editable||!scheduleDraft.endsAt">
              Запретить добавление после окончания
            </label>
          </div>
          <div><span class="muted">Состояние</span><strong>{{ listing?.state==='active'?'Активно':'Завершено' }}</strong></div>
          <div><span class="muted">Ревизии</span>
            <strong>Правила {{ listing?.policyRevision }} · Время {{ listing?.scheduleRevision??1 }}</strong>
          </div>
        </div>
        <p class="muted">Время и запреты подписываются владельцем и проверяются сервером. У исторических заданий первоначальные ограничения сохраняются до явного изменения расписания.</p>
        <h3>Сроки хранения и доступ</h3>
        <p class="muted">Эти даты отдельно подписываются владельцем. Когда срок наступит, сервер прекращает выдавать материалы через задание или скрывает само задание. Это не меняет исходный TTL и не удаляет личные файлы исполнителей из S3.</p>
        <label class="checkline">
          <input id="editor-retention-files-enabled" type="checkbox"
            v-model="retentionDraft.filesEnabled" :disabled="!editable">
          Прекратить доступ к материалам задания по дате
        </label>
        <label v-if="retentionDraft.filesEnabled" for="editor-retention-files-date">Дата прекращения доступа к материалам</label>
        <input v-if="retentionDraft.filesEnabled" id="editor-retention-files-date"
          type="datetime-local" v-model="retentionDraft.filesDate" :disabled="!editable" required>
        <label class="checkline">
          <input id="editor-retention-assignment-enabled" type="checkbox"
            v-model="retentionDraft.assignmentEnabled" :disabled="!editable">
          Автоматически скрыть задание по дате
        </label>
        <label v-if="retentionDraft.assignmentEnabled" for="editor-retention-assignment-date">Дата скрытия задания</label>
        <input v-if="retentionDraft.assignmentEnabled" id="editor-retention-assignment-date"
          type="datetime-local" v-model="retentionDraft.assignmentDate" :disabled="!editable" required>
        <label class="checkline">
          <input type="checkbox" disabled aria-describedby="editor-delete-originals-explanation">
          Удалить также исходные файлы исполнителей
        </label>
        <p id="editor-delete-originals-explanation" class="muted">Недоступно до отдельного подписанного согласия владельцев файлов и безопасного GC всех S3-локаций. Скрытие задания не подтверждает физическое удаление.</p>
      </div>

      <div v-if="activeTab==='files'" id="editor-panel-files"
        role="tabpanel" aria-labelledby="editor-tab-files" class="fieldwork-editor-panel">
        <h2>Файлы</h2>
        <h3>Камера</h3>
        <p class="muted">Задание разрешает типы независимо от пресетов камеры.
          <RouterLink :to="{path:'/camera',query:{assignmentId}}">Открыть камеру задания</RouterLink>
        </p>
        <h3>Разрешённые типы файлов</h3>
        <div class="fieldwork-editor-media">
          <div>
            <label class="checkline"><input type="checkbox" checked disabled> Фото</label>
            <small class="muted">В текущей подписанной политике фото — обязательный базовый тип.</small>
            <label for="editor-photo-goal">Нужно фотографий <small>Только для прогресса</small></label>
            <input id="editor-photo-goal" v-model="draft.photoGoal" type="number" min="1" max="9999" step="1" placeholder="Без цели" :disabled="!editable">
            <label for="editor-photo-instructions">Инструкции для фотографий</label>
            <textarea id="editor-photo-instructions" v-model="photoInstructions"
              data-testid="editor-photo-instructions" rows="3" maxlength="2000"
              :disabled="!editable" placeholder="Необязательно"/>
          </div>
          <div>
            <label class="checkline"><input id="editor-allow-video" v-model="draft.video" type="checkbox" :disabled="!editable"> Видео</label>
            <template v-if="draft.video">
              <label for="editor-video-goal">Нужно видео <small>Только для прогресса</small></label>
              <input id="editor-video-goal" v-model="draft.videoGoal" type="number" min="1" max="999" step="1" placeholder="Без цели" :disabled="!editable">
              <label for="editor-video-instructions">Инструкции для видео</label>
              <textarea id="editor-video-instructions" v-model="videoInstructions"
                data-testid="editor-video-instructions" rows="3" maxlength="2000"
                :disabled="!editable" placeholder="Необязательно"/>
            </template>
          </div>
          <div>
            <label class="checkline"><input id="editor-allow-audio" v-model="draft.audio" type="checkbox" :disabled="!editable"> Аудио</label>
            <template v-if="draft.audio">
              <label for="editor-audio-goal">Нужно аудио <small>Только для прогресса</small></label>
              <input id="editor-audio-goal" v-model="draft.audioGoal" type="number" min="1" max="999" step="1" placeholder="Без цели" :disabled="!editable">
              <label for="editor-audio-instructions">Инструкции для аудио</label>
              <textarea id="editor-audio-instructions" v-model="audioInstructions"
                data-testid="editor-audio-instructions" rows="3" maxlength="2000"
                :disabled="!editable" placeholder="Необязательно"/>
            </template>
          </div>
        </div>
        <p class="muted">Цель не ограничивает отправку файлов и учитывает только подтверждённые сервером E2EE-материалы. Отдельные инструкции для типов файлов шифруются вместе с описанием задания и доступны принятым исполнителям. Пресеты камеры пока не связаны с политикой задания.</p>
      </div>

      <div v-if="activeTab==='people'" id="editor-panel-people"
        role="tabpanel" aria-labelledby="editor-tab-people" class="fieldwork-editor-panel">
        <h2>Участники</h2>
        <h3>Участники задания</h3>
        <p class="muted">Показан только свежий список сервера. Идентичность приглашённого и роль проверены по подписи владельца. Статус принятия подтверждён сервером; это не выдаёт E2EE-доступ к файлам.</p>
        <div class="fieldwork-editor-roster" data-testid="editor-participant-roster">
          <p v-if="rosterStatus==='loading'" role="status">Получаем список участников…</p>
          <p v-else-if="rosterStatus==='offline'" role="status">Список участников недоступен офлайн. Ожидающие приглашения в очереди не считаются принятыми.</p>
          <p v-else-if="rosterStatus==='error'" role="alert">Не удалось проверить список: {{ rosterError }}</p>
          <p v-else-if="rosterStatus==='ready'&&!participants.length">Приглашённых участников пока нет.</p>
          <ul v-if="rosterStatus==='ready'&&participants.length">
            <li v-for="person in participants" :key="person.inviteId"
              :data-testid="'editor-participant-'+person.recipientAccountId">
              <code>{{ person.recipientAccountId }}</code>
              <span> · Исполнитель · {{
                person.state==='accepted'?'Принято сервером':
                person.expired?'Приглашение истекло':'Ожидает принятия'
              }}</span>
            </li>
          </ul>
          <button type="button" :disabled="busy||rosterStatus==='loading'||!activeSession?.online"
            @click="refreshRoster()">Обновить список</button>
        </div>
        <h3>Пригласить исполнителя</h3>
        <p class="muted">Приглашение подписывается владельцем. Доступ к расшифровке файлов выдаётся отдельно, не самим фактом участия. Сейчас доступна проверенная роль «Исполнитель»; куратор и наблюдатель требуют серверной модели полномочий.</p>
        <label for="editor-recipient-id">ID аккаунта исполнителя</label>
        <input id="editor-recipient-id" v-model="peerId" spellcheck="false" autocomplete="off"
          placeholder="UUID аккаунта" @input="peerReset">
        <button type="button" :disabled="busy||!peerId.trim()" @click="peerInspect">Проверить ключ исполнителя</button>
        <div v-if="peerFingerprint" class="fieldwork-editor-fingerprint">
          <p>Отпечаток ключа</p>
          <code>{{ peerFingerprint }}</code>
          <label v-if="!peerConfirmed" class="checkline">
            <input v-model="peerAgreed" type="checkbox"> Я независимо сверил отпечаток
          </label>
          <button v-if="!peerConfirmed" type="button" :disabled="busy||!peerAgreed" @click="peerApprove">Подтвердить ключ</button>
          <p v-else class="status-text">Ключ подтверждён</p>
          <button v-if="peerConfirmed" type="button" :disabled="busy||listing?.state!=='active'" @click="invite">Отправить подписанное приглашение</button>
        </div>
        <p class="muted">Контакты, команды, роли и file scopes из принятого Editor 2.2 пока не подменяются демонстрационными участниками.</p>
      </div>

      <div v-if="activeTab==='rules'" id="editor-panel-rules"
        role="tabpanel" aria-labelledby="editor-tab-rules" class="fieldwork-editor-panel">
        <h2>Правила</h2>
        <p class="muted">Категории и названия обязательных тегов видны в подписанной политике. Фактически выбранные значения, описание и GPS шифруются с файлом на устройстве.</p>
        <fieldset class="fieldwork-editor-rules" :disabled="!editable">
          <legend>Фото</legend>
          <label class="checkline"><input v-model="draft.photoRequiredCategory" type="checkbox"> Категория обязательна</label>
          <label for="editor-photo-categories">Допустимые категории (через запятую)</label>
          <textarea id="editor-photo-categories" v-model="draft.photoCategories" rows="2" placeholder="Любые"/>
          <label for="editor-photo-tags">Обязательные теги (через запятую)</label>
          <textarea id="editor-photo-tags" v-model="draft.photoTags" rows="2" placeholder="Не требуются"/>
          <label for="editor-photo-description-min">Минимум символов описания (0 — не требуется)</label>
          <input id="editor-photo-description-min" v-model.number="draft.photoDescriptionMin" type="number" min="0" max="4000" step="1">
          <label class="checkline"><input v-model="draft.photoGps" type="checkbox"> GPS обязателен</label>
        </fieldset>
        <fieldset class="fieldwork-editor-rules" :disabled="!editable||!draft.video">
          <legend>Видео <small v-if="!draft.video">— выключено на вкладке «Файлы»</small></legend>
          <label class="checkline"><input v-model="draft.videoRequiredCategory" type="checkbox"> Категория обязательна</label>
          <label for="editor-video-categories">Допустимые категории</label>
          <textarea id="editor-video-categories" v-model="draft.videoCategories" rows="2" placeholder="Любые"/>
          <label for="editor-video-tags">Обязательные теги</label>
          <textarea id="editor-video-tags" v-model="draft.videoTags" rows="2" placeholder="Не требуются"/>
          <label for="editor-video-description-min">Минимум символов описания</label>
          <input id="editor-video-description-min" v-model.number="draft.videoDescriptionMin" type="number" min="0" max="4000" step="1">
          <label class="checkline"><input v-model="draft.videoGps" type="checkbox"> GPS обязателен</label>
        </fieldset>
        <fieldset class="fieldwork-editor-rules" :disabled="!editable||!draft.audio">
          <legend>Аудио <small v-if="!draft.audio">— выключено на вкладке «Файлы»</small></legend>
          <label class="checkline"><input v-model="draft.audioRequiredCategory" type="checkbox"> Категория обязательна</label>
          <label for="editor-audio-categories">Допустимые категории</label>
          <textarea id="editor-audio-categories" v-model="draft.audioCategories" rows="2" placeholder="Любые"/>
          <label for="editor-audio-tags">Обязательные теги</label>
          <textarea id="editor-audio-tags" v-model="draft.audioTags" rows="2" placeholder="Не требуются"/>
          <label for="editor-audio-description-min">Минимум символов описания</label>
          <input id="editor-audio-description-min" v-model.number="draft.audioDescriptionMin" type="number" min="0" max="4000" step="1">
          <label class="checkline"><input v-model="draft.audioGps" type="checkbox"> GPS обязателен</label>
        </fieldset>
        <p class="muted">Public Card, редактирование оригинала и права на передачу пока не имеют подтверждённой модели E2EE scopes. Их здесь нельзя включить простым UI-переключателем.</p>
      </div>

      <p v-if="pending" role="status" class="muted">Подписанное изменение правил, расписания, хранения или приватного текста ожидает подтверждения сервера. Следующее изменение пока заблокировано.</p>
      <p v-if="notice" role="status" class="status-text">{{ notice }}</p>
      <p v-if="error" role="alert" class="error-text">{{ error }}</p>
      <div class="fieldwork-editor-actions">
        <button type="button" :disabled="busy" @click="refresh">Обновить</button>
        <button type="button" :disabled="busy||!dirty||pending" @click="undo">Отменить правки</button>
        <button type="button" class="fieldwork-editor-save" :disabled="!editable||!dirty" @click="save">
          {{ busy?'Сохранение…':'Подписать и сохранить' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.fieldwork-editor {
  max-width: 900px;
  padding: 24px clamp(14px, 3vw, 30px) 22px;
  color: #f1f1f1;
}
.fieldwork-editor-top { margin-bottom: 22px; }
.fieldwork-editor-back {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  color: #bcbcbc;
  text-decoration: none;
  font-size: 12px;
}
.fieldwork-editor-back:hover { color: #f4f4f4; }
.fieldwork-editor-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
}
.fieldwork-editor-heading h1 { margin: 6px 0; font-size: clamp(23px, 3vw, 28px); }
.fieldwork-editor-heading p { margin: 0; overflow-wrap: anywhere; }
.fieldwork-editor-state {
  display: inline-block;
  max-width: 200px;
  flex-shrink: 0;
  color: #b4b4b4;
  font-size: 11px;
  text-align: right;
}
.fieldwork-editor-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0,1fr));
  border-bottom: 1px solid #383838;
  background: #161616;
  position: sticky;
  top: 0;
  z-index: 2;
  gap: 3px;
}
.fieldwork-editor-tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: #969696;
  padding: 15px 4px 13px;
  min-width: 0;
  white-space: nowrap;
  font-weight: 600;
}
.fieldwork-editor-tabs button.active {
  color: #f4f4f4;
  border-bottom-color: var(--accent, #1ed760);
}
.fieldwork-editor-tabs button:focus-visible {
  outline: 2px solid var(--accent, #1ed760);
  outline-offset: -2px;
}
.fieldwork-editor-panel {
  background: #1c1c1c;
  border-radius: 0 0 12px 12px;
  padding: clamp(16px, 3vw, 25px);
  min-height: 315px;
  border: 1px solid #292929;
  border-top: none;
}
.fieldwork-editor-panel h2 {
  font-size: 17px;
  margin: 0 0 17px;
}
.fieldwork-editor-panel h3 {
  font-size: 13px;
  margin: 22px 0 12px;
}
.fieldwork-editor-panel p {
  line-height: 1.5;
}
.fieldwork-editor-panel label {
  display: block;
  color: #ddd;
  font-size: 12px;
  margin: 17px 0 8px;
}
.fieldwork-editor-panel input:not([type=checkbox]),
.fieldwork-editor-panel textarea {
  display: block;
  width: 100%;
  background: #131313;
  border: 1px solid #444;
  border-radius: 7px;
  color: #f1f1f1;
  padding: 11px 12px;
  font: inherit;
  font-size: 13px;
  margin: 0 0 13px;
}
.fieldwork-editor-panel textarea {
  min-height: 58px;
  resize: vertical;
}
.fieldwork-editor-panel input:focus-visible,
.fieldwork-editor-panel textarea:focus-visible {
  outline: 2px solid var(--accent, #1ed760);
  outline-offset: 1px;
}
.fieldwork-editor-panel input:disabled,
.fieldwork-editor-panel textarea:disabled { opacity: .58; }
.fieldwork-editor-panel .checkline {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 13px 0;
}
.fieldwork-editor-panel input[type=checkbox] {
  width: 17px; height: 17px;
  margin: 0;
  accent-color: var(--accent, #1ed760);
}
.fieldwork-editor-readonly {
  padding: 13px 15px;
  border: 1px solid #333;
  border-radius: 7px;
  background: #171717;
  overflow-wrap: anywhere;
}
.fieldwork-editor-instructions { min-height: 70px; white-space: pre-wrap; }
.fieldwork-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 22px 0;
}
.fieldwork-editor-grid > div {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid #303030;
  padding: 13px;
  border-radius: 8px;
}
.fieldwork-editor-grid strong { font-size: 12px; overflow-wrap: anywhere; }
.fieldwork-editor-media { display: grid; gap: 12px; }
.fieldwork-editor-media > div {
  border: 1px solid #303030;
  background: #202020;
  border-radius: 9px;
  padding: 10px 15px 14px;
}
.fieldwork-editor-media small { font-weight: 400; }
.fieldwork-editor-media label small { display: block; margin-top: 5px; }
.fieldwork-editor-rules {
  border: 1px solid #383838;
  border-radius: 9px;
  margin: 18px 0;
  padding: 12px 16px;
  min-width: 0;
}
.fieldwork-editor-rules:disabled { opacity: .63; }
.fieldwork-editor-rules legend {
  padding: 0 8px;
  color: #f0f0f0;
  font-weight: 700;
}
.fieldwork-editor-fingerprint {
  background: #141414;
  padding: 12px 16px;
  border-radius: 9px;
  margin: 15px 0;
  border: 1px solid #3d3d3d;
}
.fieldwork-editor-fingerprint code { display: block; overflow-wrap: anywhere; }
.fieldwork-editor-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  border-top: 1px solid #393939;
  background: #191919;
  padding: 14px 12px calc(14px + env(safe-area-inset-bottom, 0px));
  position: sticky;
  bottom: 0;
  z-index: 3;
  margin-top: 18px;
  border-radius: 9px;
}
.fieldwork-editor-actions .fieldwork-editor-save {
  background: #216d3d;
  border-color: #358e52;
  font-weight: 700;
}
.fieldwork-editor-actions .fieldwork-editor-save:not(:disabled):hover {
  background: #28864a;
}
@media (max-width: 500px) {
  .fieldwork-editor { padding: 12px 10px 16px; }
  .fieldwork-editor-heading { display: block; }
  .fieldwork-editor-state { display: block; text-align: left; margin-top: 8px; }
  .fieldwork-editor-panel { padding: 14px; }
  .fieldwork-editor-tabs button { font-size: 11px; padding: 14px 1px 12px; }
  .fieldwork-editor-grid { grid-template-columns: 1fr; gap: 8px; }
  .fieldwork-editor-actions { justify-content: stretch; }
  .fieldwork-editor-actions button { flex: 1 1 auto; }
  .fieldwork-editor-actions .fieldwork-editor-save { flex-basis: 100%; }
}
@media (prefers-reduced-motion: no-preference) {
  .fieldwork-editor-tabs button { transition: color .14s ease, border-color .14s ease; }
}
</style>
