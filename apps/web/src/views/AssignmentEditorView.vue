<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink, useRoute } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import {
  flushAssignmentOutbox, listAssignmentOperations,
  listCachedAssignmentSnapshots, listServerAssignments,
  queueAssignmentInvitation, queueAssignmentPolicyChange,
  verifySignedAssignmentPolicy,
} from '../features/assignments/application/assignment-outbox'
import type { AssignmentListing } from '../features/assignments/application/assignment-outbox'
import { blankEditorDraft,buildEditorPolicy,editorDraftFromListing } from '../features/assignments/application/assignment-editor-model'
import type { EditorDraft } from '../features/assignments/application/assignment-editor-model'
import { openOwnerAssignment } from '../features/assignments/infrastructure/assignment-crypto'
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
const listing=ref<AssignmentListing|null>(null)
const title=ref('')
const instructions=ref('')
const loadState=ref<'loading'|'offline'|'fresh'|'missing'>('loading')
const busy=ref(false)
const pending=ref(false)
const error=ref('')
const notice=ref('')
const baseline=ref('')
const baselineRevision=ref<number|null>(null)
const peerId=ref('')
const peerFingerprint=ref('')
const peerConfirmed=ref(false)
const peerAgreed=ref(false)
let run=0
const dirty=computed(()=>!!baseline.value&&JSON.stringify(draft)!==baseline.value)
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
async function fromRow(row:AssignmentListing,session:NonNullable<typeof activeSession.value>,
  generation:number):Promise<void>{
  await verifySignedAssignmentPolicy(row,loadState.value==='offline')
  if(!sameIdentity(activeSession.value,session)||run!==generation)return
  if(row.ownerAccountId!==session.accountId)throw Error('assignment.owner_required')
  const decrypted=await openOwnerAssignment(session.pkg,row.assignmentId,row.privateEnvelope)
  if(!sameIdentity(activeSession.value,session)||run!==generation)return
  if(dirty.value&&baselineRevision.value!==row.policyRevision){
    notice.value='Правила изменились на сервере. Отмените локальные правки и обновите перед сохранением.'
    return
  }
  if(!dirty.value)apply(row)
  title.value=decrypted.title
  instructions.value=decrypted.instructions
  pending.value=(await listAssignmentOperations()).some(op=>{
    if(op.kind!=='policy'||!['queued','retry'].includes(op.state))return false
    try{return (JSON.parse(op.contract) as {assignmentId?:string}).assignmentId===row.assignmentId}
    catch{return false}
  })
}
async function refresh():Promise<void>{
  const generation=++run
  const session=activeSession.value
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
    if(run===generation)loadState.value='fresh'
  }catch(e){
    if(run===generation){
      if(!cached)loadState.value='missing'
      error.value=fail(e)
    }
  }
}
function undo():void{
  if(!listing.value)return
  apply(listing.value)
  error.value='';notice.value=''
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
      if(!fresh||fresh.policyRevision!==baselineRevision.value)
        throw Error('assignment.editor_revision_changed')
    }else if(listing.value.policyRevision!==baselineRevision.value)
      throw Error('assignment.editor_revision_changed')
    if(!sameIdentity(session,activeSession.value))throw Error('identity.changed')
    const policy=buildEditorPolicy(draft)
    const operationId=await queueAssignmentPolicyChange(assignmentId.value,policy)
    pending.value=true
    notice.value='Подписанное изменение сохранено локально в зашифрованной очереди.'
    if(session.online&&navigator.onLine){
      await flushAssignmentOutbox()
      if(!sameIdentity(session,activeSession.value))throw Error('identity.changed')
      const op=(await listAssignmentOperations()).find(x=>x.id===operationId)
      if(op?.state==='sent'){
        notice.value='Изменение подписано и принято сервером.'
        pending.value=false
        baseline.value='' // force fresh signed snapshot to replace the draft
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
    if(activeSession.value?.online&&navigator.onLine)await flushAssignmentOutbox()
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
    return window.confirm('Отменить несохранённые изменения правил задания?')
})
watch(activeSession,(next,previous)=>{
  if(!sameIdentity(next,previous)){
    ++run
    listing.value=null;title.value='';instructions.value=''
    baseline.value='';baselineRevision.value=null
    Object.assign(draft,blankEditorDraft());peerReset()
    loadState.value='loading'
    void refresh()
  }
})
watch(assignmentId,()=>{
  title.value='';instructions.value='';listing.value=null
  baseline.value='';baselineRevision.value=null
  Object.assign(draft,blankEditorDraft());peerReset()
  activeTab.value='main';loadState.value='loading'
  void refresh()
})
onMounted(()=>{void refresh()})
onUnmounted(()=>{++run;title.value='';instructions.value='';baseline.value=''})
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
        <p class="muted">Название и инструкции сохранены в исходном E2EE-конверте. Изменение этих полей требует отдельного версионированного контракта: здесь они доступны только для просмотра.</p>
        <label>Название</label>
        <div class="fieldwork-editor-readonly" data-testid="editor-private-title">{{ title }}</div>
        <label>Инструкции</label>
        <div class="fieldwork-editor-readonly fieldwork-editor-instructions">{{ instructions||'Не указаны' }}</div>
        <div class="fieldwork-editor-grid">
          <div><span class="muted">Начало</span><strong>{{ listing?new Date(listing.startsAt).toLocaleString('ru-RU'):'' }}</strong></div>
          <div><span class="muted">Окончание</span><strong>{{ listing?.endsAt?new Date(listing.endsAt).toLocaleString('ru-RU'):'Не задано' }}</strong></div>
          <div><span class="muted">Состояние</span><strong>{{ listing?.state==='active'?'Активно':'Завершено' }}</strong></div>
          <div><span class="muted">Версия правил</span><strong>{{ listing?.policyRevision }}</strong></div>
        </div>
        <p class="muted">Планирование начала, автоматическое удаление и изменение описания пока не подключены к реальному lifecycle — никаких фиктивных переключателей.</p>
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
          </div>
          <div>
            <label class="checkline"><input id="editor-allow-video" v-model="draft.video" type="checkbox" :disabled="!editable"> Видео</label>
            <template v-if="draft.video">
              <label for="editor-video-goal">Нужно видео <small>Только для прогресса</small></label>
              <input id="editor-video-goal" v-model="draft.videoGoal" type="number" min="1" max="999" step="1" placeholder="Без цели" :disabled="!editable">
            </template>
          </div>
          <div>
            <label class="checkline"><input id="editor-allow-audio" v-model="draft.audio" type="checkbox" :disabled="!editable"> Аудио</label>
            <template v-if="draft.audio">
              <label for="editor-audio-goal">Нужно аудио <small>Только для прогресса</small></label>
              <input id="editor-audio-goal" v-model="draft.audioGoal" type="number" min="1" max="999" step="1" placeholder="Без цели" :disabled="!editable">
            </template>
          </div>
        </div>
        <p class="muted">Цель не ограничивает количество файлов и учитывает только подтверждённые сервером E2EE-материалы. Индивидуальные инструкции и пресеты появятся после версионирования приватной политики.</p>
      </div>

      <div v-if="activeTab==='people'" id="editor-panel-people"
        role="tabpanel" aria-labelledby="editor-tab-people" class="fieldwork-editor-panel">
        <h2>Участники</h2>
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

      <p v-if="pending" role="status" class="muted">Подписанная версия правил ожидает серверного подтверждения. Следующее изменение пока заблокировано.</p>
      <p v-if="notice" role="status" class="status-text">{{ notice }}</p>
      <p v-if="error" role="alert" class="error-text">{{ error }}</p>
      <div class="fieldwork-editor-actions">
        <button type="button" :disabled="busy" @click="refresh">Обновить</button>
        <button type="button" :disabled="busy||!dirty||pending" @click="undo">Отменить правки</button>
        <button type="button" class="fieldwork-editor-save" :disabled="!editable||!dirty" @click="save">
          {{ busy?'Сохранение…':'Подписать и сохранить правила' }}
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
