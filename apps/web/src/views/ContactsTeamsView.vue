<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { activeSession, reauthenticate } from '../features/identity/application/session'
import { confirmPeer, inspectPeer } from '../features/sharing/key-directory'
import {
  listConfirmedContacts, saveConfirmedContact, removeConfirmedContact,
} from '../features/people/application/contact-book'
import type { ConfirmedContact } from '../features/people/application/contact-book'
import { listLocalTeams, queueTeam, refreshTeams } from '../features/people/application/team-book'
import type { TeamView } from '../features/people/application/team-book'
import TeamMembershipPanel from './TeamMembershipPanel.vue'

const activeTab=ref<'contacts'|'teams'>('contacts')
const contacts=ref<ConfirmedContact[]>([])
const teams=ref<TeamView[]>([])
const teamForm=ref(false)
const teamName=ref('')
const teamDescription=ref('')
const teamBusy=ref(false)
const teamLoading=ref(false)
const teamError=ref('')
const teamNotice=ref('')
let teamRun=0
function sameTeamIdentity(expected:string,token:number):boolean{
  return identity()===expected&&token===teamRun
}
async function reloadTeams():Promise<void>{
  const token=++teamRun,owner=identity()
  teams.value=[];teamError.value=''
  if(!owner)return
  try{
    const local=await listLocalTeams()
    if(!sameTeamIdentity(owner,token))return
    teams.value=local // Offline-first: never wait for HTTP to show cached teams.
  }catch(e){
    if(sameTeamIdentity(owner,token))
      teamError.value=e instanceof Error?e.message:'teams.local_unavailable'
    return
  }
  if(!activeSession.value?.online
    ||typeof navigator!=='undefined'&&!navigator.onLine)return
  teamLoading.value=true
  try{
    const latest=await refreshTeams()
    if(sameTeamIdentity(owner,token))teams.value=latest
  }catch(e){
    if(sameTeamIdentity(owner,token))
      teamError.value=e instanceof Error?e.message:'teams.sync_unavailable'
  }finally{
    if(sameTeamIdentity(owner,token))teamLoading.value=false
  }
}
async function createTeam():Promise<void>{
  if(teamBusy.value)return
  teamBusy.value=true;teamError.value='';teamNotice.value=''
  const owner=identity()
  try{
    const created=await queueTeam(teamName.value,teamDescription.value)
    if(identity()!==owner)return
    teams.value=[...teams.value.filter(x=>x.teamId!==created.teamId),created]
      .sort((a,b)=>a.name.localeCompare(b.name))
    teamName.value='';teamDescription.value='';teamForm.value=false
    teamNotice.value='Команда зашифрована и сохранена. Синхронизация проверяется отдельно.'
    // The durable queue is already saved; remote ACK is not assumed.
    void reloadTeams()
  }catch(e){
    if(identity()===owner)
      teamError.value=e instanceof Error?e.message:'teams.create_failed'
  }finally{teamBusy.value=false}
}
function handleTeamOnline():void{void reloadTeams()}

const query=ref('')
const candidate=ref<{id:string;fingerprint:string;confirmed:boolean}|null>(null)
const fingerprintAgreed=ref(false)
const alias=ref('')
const selected=ref<string|null>(null)
const editAlias=ref('')
const busy=ref(false)
const loading=ref(false)
const message=ref('')
const error=ref('')
let run=0

function identity(){
  const session=activeSession.value
  return session?[
    session.accountId,session.deviceId,session.pkg.accountSpki,
    session.pkg.akek,session.pkg.revision,
  ].join('|'):''
}
function sessionMatches(expected:string,token:number):boolean{
  return token===run&&identity()===expected
}
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
async function reload():Promise<void>{
  const token=++run,owner=identity()
  contacts.value=[];selected.value=null
  error.value='';loading.value=true
  if(!owner){loading.value=false;return}
  try{
    const rows=await listConfirmedContacts()
    if(sessionMatches(owner,token))contacts.value=rows
  }catch(e){
    if(sessionMatches(owner,token))
      error.value=e instanceof Error?e.message:'contacts.unavailable'
  }finally{
    if(sessionMatches(owner,token))loading.value=false
  }
}
async function operate(action:()=>Promise<void>):Promise<void>{
  if(busy.value)return
  busy.value=true;error.value='';message.value=''
  const owner=identity(),token=run
  try{
    await action()
    if(!sessionMatches(owner,token))return
  }catch(e){
    if(sessionMatches(owner,token))
      error.value=e instanceof Error?e.message:'contacts.operation_failed'
  }finally{busy.value=false}
}
function resetSearch():void{
  candidate.value=null;fingerprintAgreed.value=false;alias.value=''
}
function lookup():void{
  void operate(async()=>{
    const id=query.value.trim().toLowerCase()
    if(!uuidPattern.test(id))throw Error('contacts.invalid_account_id')
    if(!activeSession.value?.online)await reauthenticate()
    const {directory,confirmed}=await inspectPeer(id)
    candidate.value={
      id,fingerprint:directory.safetyFingerprint,confirmed,
    }
    fingerprintAgreed.value=false
  })
}
function approve():void{
  void operate(async()=>{
    const person=candidate.value
    if(!person||!fingerprintAgreed.value)throw Error('contacts.fingerprint_required')
    await confirmPeer(person.id,person.fingerprint)
    candidate.value={...person,confirmed:true}
    message.value='Отпечаток подтверждён на этом устройстве.'
  })
}
function add():void{
  void operate(async()=>{
    const person=candidate.value
    if(!person?.confirmed)throw Error('contacts.fingerprint_required')
    await saveConfirmedContact(person.id,person.fingerprint,alias.value)
    const rows=await listConfirmedContacts()
    contacts.value=rows
    resetSearch();query.value=''
    message.value='Контакт сохранён в зашифрованной локальной книге.'
  })
}
function view(person:ConfirmedContact):void{
  selected.value=person.peerAccountId
  editAlias.value=person.alias
}
function saveAlias():void{
  void operate(async()=>{
    const item=contacts.value.find(x=>x.peerAccountId===selected.value)
    if(!item)throw Error('contacts.not_found')
    await saveConfirmedContact(item.peerAccountId,item.safetyFingerprint,editAlias.value)
    contacts.value=await listConfirmedContacts()
    message.value='Локальное имя обновлено.'
  })
}
function remove():void{
  const id=selected.value
  if(!id||!window.confirm(
    'Удалить контакт только из локальной книги? Уже выданные разрешения и приглашения не отзываются.'
  ))return
  void operate(async()=>{
    await removeConfirmedContact(id)
    contacts.value=await listConfirmedContacts()
    selected.value=null
    message.value='Контакт удалён из локальной книги. Старые разрешения не изменены.'
  })
}
function matches(person:ConfirmedContact):boolean{
  const search=query.value.trim().toLocaleLowerCase()
  return !search||person.alias.toLocaleLowerCase().includes(search)
    ||person.peerAccountId.includes(search)
}
watch(activeSession,(_now,previous)=>{
  const prev=previous?[
    previous.accountId,previous.deviceId,previous.pkg.accountSpki,
    previous.pkg.akek,previous.pkg.revision,
  ].join('|'):''
  if(identity()!==prev){
    resetSearch();query.value='';selected.value=null;contacts.value=[]
    teams.value=[];teamForm.value=false;teamName.value='';teamDescription.value=''
    ++teamRun
    void reload();void reloadTeams()
  }
})
onMounted(()=>{
  void reload();void reloadTeams()
  window.addEventListener('online',handleTeamOnline)
})
onUnmounted(()=>{
  ++run;++teamRun;candidate.value=null;contacts.value=[];teams.value=[]
  window.removeEventListener('online',handleTeamOnline)
})
</script>

<template>
  <section class="foundation-content contacts-page" data-testid="contacts-teams">
    <div class="contacts-heading"><h1>Контакты и Команды</h1></div>
    <nav class="contacts-tabs" aria-label="Контакты и команды">
      <button type="button" :class="{selected:activeTab==='teams'}"
        :aria-current="activeTab==='teams'?'page':undefined"
        @click="activeTab='teams';void reloadTeams()">Команды ({{ teams.length }})</button>
      <button type="button" :class="{selected:activeTab==='contacts'}"
        :aria-current="activeTab==='contacts'?'page':undefined"
        @click="activeTab='contacts'">Контакты ({{ contacts.length }})</button>
    </nav>

    <div v-if="!activeSession" class="foundation-card">
      <p>Для работы с контактами нужен анонимный аккаунт.</p>
      <RouterLink to="/settings">Создать или восстановить аккаунт</RouterLink>
    </div>
    <template v-else-if="activeTab==='teams'">
      <button type="button" class="contacts-full-button"
        @click="teamForm=!teamForm">Создать команду</button>
      <form v-if="teamForm" class="foundation-card" data-testid="team-create-form"
        @submit.prevent="createTeam">
        <h2>Новая команда</h2>
        <label for="team-name">Название</label>
        <input id="team-name" v-model="teamName" maxlength="64" required
          placeholder="Название команды" data-testid="team-name">
        <label for="team-description">Описание</label>
        <textarea id="team-description" v-model="teamDescription" maxlength="1024"
          rows="3" placeholder="Описание (необязательно)"/>
        <p class="muted">Название и описание шифруются на устройстве. Создание не даёт участникам доступа к файлам или заданиям.</p>
        <div class="action-row">
          <button type="submit" :disabled="teamBusy||!teamName.trim()"
            data-testid="team-create-submit">Сохранить команду</button>
          <button type="button" @click="teamForm=false">Отмена</button>
        </div>
      </form>
      <div class="foundation-card">
        <div class="contacts-list-heading">
          <h2>Мои команды</h2>
          <button type="button" :disabled="teamLoading||teamBusy"
            @click="reloadTeams">Обновить</button>
        </div>
        <p v-if="!teams.length" class="muted">Команд пока нет.</p>
        <div v-for="team in teams" :key="team.teamId"
          class="contacts-list-row" :data-testid="'team-row-'+team.teamId">
          <span class="contacts-avatar" aria-hidden="true">{{ team.name.slice(0,1).toUpperCase() }}</span>
          <div class="contacts-row-label">
            <strong>{{ team.name }}</strong>
            <p class="muted">{{ team.description }}</p>
            <small>Участники: {{ team.memberCount }} · {{ team.delivery==='synced'?'В облаке':team.delivery==='conflict'?'Конфликт синхронизации':'В очереди' }}</small>
          </div>
        </div>
        <p class="muted">Владелец команды подтверждён сервером после синхронизации. Приглашения и изменение ролей появятся с отдельной подписанной моделью полномочий.</p>
      </div>
      <TeamMembershipPanel :owned-teams="teams" :contacts="contacts"
        @refresh="reloadTeams" />
      <p v-if="teamLoading" role="status">Синхронизация команд…</p>
      <p v-if="teamNotice" role="status" class="status-text">{{ teamNotice }}</p>
      <p v-if="teamError" role="alert" class="error-text">{{ teamError }}</p>
    </template>
    <template v-else>
      <div class="foundation-card">
        <h2>Найти и добавить контакт</h2>
        <p class="muted">Сейчас работает поиск по точному UUID аккаунта. Поиск по @username и #UserID появится вместе с публичными профилями и серверными правилами видимости.</p>
        <label for="contact-id">ID аккаунта</label>
        <input id="contact-id" v-model="query" autocomplete="off" spellcheck="false"
          placeholder="UUID аккаунта" data-testid="contacts-lookup-id"
          @input="resetSearch">
        <button type="button" :disabled="busy||!query.trim()" @click="lookup">
          Проверить ключ
        </button>
        <div v-if="candidate" class="fingerprint-panel"
          data-testid="contacts-fingerprint">
          <strong>Отпечаток ключа</strong>
          <code>{{ candidate.fingerprint }}</code>
          <template v-if="!candidate.confirmed">
            <p class="muted">Сверьте отпечаток с владельцем аккаунта через независимый канал. Каталог сервера сам по себе не подтверждает личность.</p>
            <label class="checkline">
              <input v-model="fingerprintAgreed" type="checkbox"
                data-testid="contacts-fingerprint-ack">
              Я независимо сверил отпечаток
            </label>
            <button type="button" :disabled="busy||!fingerprintAgreed" @click="approve">
              Подтвердить отпечаток
            </button>
          </template>
          <template v-else>
            <p class="status-text">Ключ подтверждён на этом устройстве.</p>
            <label for="contact-alias">Моё локальное имя (необязательно)</label>
            <input id="contact-alias" v-model="alias" maxlength="64"
              data-testid="contacts-alias" placeholder="Название контакта">
            <button type="button" :disabled="busy" @click="add">Добавить в контакты</button>
          </template>
        </div>
      </div>

      <div class="foundation-card">
        <div class="contacts-list-heading">
          <h2>Мои контакты</h2>
          <button type="button" :disabled="loading||busy" @click="reload">Обновить</button>
        </div>
        <p v-if="loading" role="status" class="muted">Читаем зашифрованную книгу…</p>
        <p v-else-if="!contacts.filter(matches).length" class="muted">
          Контактов по текущему фильтру нет.
        </p>
        <div v-for="person in contacts.filter(matches)" :key="person.peerAccountId"
          class="contacts-list-row" :data-testid="'contacts-row-'+person.peerAccountId">
          <span class="contacts-avatar" aria-hidden="true">{{ (person.alias||'#').slice(0,1).toUpperCase() }}</span>
          <div class="contacts-row-label">
            <strong>{{ person.alias||'Без имени' }}</strong>
            <code>{{ person.peerAccountId }}</code>
          </div>
          <button type="button" @click="view(person)">Карточка</button>
        </div>
      </div>
      <div v-if="selected" class="foundation-card" data-testid="contacts-card">
        <h2>Карточка контакта</h2>
        <p><code>{{ selected }}</code></p>
        <p class="muted">Отпечаток проверен ранее. Добавление в контакты не даёт человеку доступа к зашифрованным файлам.</p>
        <p v-if="contacts.find(x=>x.peerAccountId===selected)">
          <code>{{ contacts.find(x=>x.peerAccountId===selected)?.safetyFingerprint }}</code>
        </p>
        <label for="contacts-edit-alias">Локальное имя</label>
        <input id="contacts-edit-alias" v-model="editAlias" maxlength="64">
        <div class="action-row">
          <button type="button" :disabled="busy" @click="saveAlias">Сохранить имя</button>
          <button type="button" :disabled="busy" @click="remove">Удалить контакт</button>
          <button type="button" @click="selected=null">Закрыть</button>
        </div>
      </div>
      <p class="muted">Контакты и локальные имена зашифрованы на устройстве. Удаление контакта не отзывает ранее выданные E2EE-ключи или серверные разрешения. Межустройственная синхронизация списка пока не реализована.</p>
    </template>
    <p v-if="message" role="status" class="status-text">{{ message }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
