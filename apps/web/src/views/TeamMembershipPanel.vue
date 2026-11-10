<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { activeSession } from '../features/identity/application/session'
import type { ConfirmedContact } from '../features/people/application/contact-book'
import type { TeamView } from '../features/people/application/team-book'
import {
  listOwnerTeamRoster, listIncomingTeamInvites, listCachedJoinedTeams,
  queueTeamInvitation, queueTeamAcceptance, syncTeamMemberOperations,
  openJoinedTeam,
} from '../features/people/application/team-invitations'
import type {
  TeamRole, TeamInvitation, TeamRosterMember, JoinedTeam,
} from '../features/people/application/team-invitations'

defineProps<{ ownedTeams:TeamView[]; contacts:ConfirmedContact[] }>()
const emit=defineEmits<{ refresh:[] }>()
const selectedTeam=ref('')
const selectedContact=ref('')
const selectedRole=ref<TeamRole>('contributor')
const roster=ref<TeamRosterMember[]>([])
const incoming=ref<TeamInvitation[]>([])
const joined=ref<JoinedTeam[]>([])
const showInvite=ref(false)
const busy=ref(false)
const loading=ref(false)
const error=ref('')
const notice=ref('')
let generation=0
function identity():string{
  const s=activeSession.value
  return s?[s.accountId,s.deviceId,s.pkg.accountSpki,s.pkg.akek,s.pkg.revision].join('|'):''
}
function current(expected:string,token:number):boolean{
  return identity()===expected&&token===generation
}
function roleText(role:TeamRole):string{
  return role==='curator'?'Куратор':role==='viewer'?'Наблюдатель':'Исполнитель'
}
function hasNetwork():boolean{
  return !!activeSession.value?.online
    &&(typeof navigator==='undefined'||navigator.onLine)
}
async function reload():Promise<void>{
  const scope=identity(),token=++generation
  incoming.value=[];joined.value=[];error.value=''
  if(!scope)return
  try{
    const cached=await listCachedJoinedTeams()
    if(current(scope,token))joined.value=cached
  }catch(e){
    if(current(scope,token))error.value=e instanceof Error?e.message:'teams.cache_error'
    return
  }
  if(!hasNetwork())return
  loading.value=true
  try{
    await syncTeamMemberOperations()
    const results=await listIncomingTeamInvites()
    if(!current(scope,token))return
    incoming.value=results
    const verified=await Promise.all(results.filter(x=>
      x.state==='accepted'&&x.trustedOwner).map(async x=>{
        try{return await openJoinedTeam(x)}catch{return null}
      }))
    if(current(scope,token)){
      const known=verified.filter((x):x is JoinedTeam=>x!==null)
      joined.value=[...known,...joined.value.filter(x=>
        !known.some(y=>y.teamId===x.teamId))]
    }
  }catch(e){
    if(current(scope,token))
      error.value=e instanceof Error?e.message:'teams.membership_error'
  }finally{if(current(scope,token))loading.value=false}
}
async function reloadRoster():Promise<void>{
  const scope=identity(),id=selectedTeam.value
  roster.value=[];error.value=''
  if(!id)return
  if(!hasNetwork()){error.value='teams.roster_requires_online';return}
  try{
    const members=await listOwnerTeamRoster(id)
    if(identity()===scope&&selectedTeam.value===id)roster.value=members
  }catch(e){
    if(identity()===scope&&selectedTeam.value===id)
      error.value=e instanceof Error?e.message:'teams.roster_error'
  }
}
async function sendInvite():Promise<void>{
  if(busy.value||!selectedTeam.value||!selectedContact.value)return
  busy.value=true;notice.value='';error.value=''
  const scope=identity()
  try{
    await queueTeamInvitation(selectedTeam.value,selectedContact.value,selectedRole.value)
    if(identity()!==scope)return
    notice.value='Приглашение сохранено в зашифрованной очереди.'
    showInvite.value=false
    try{
      await syncTeamMemberOperations()
      if(identity()===scope){
        notice.value='Приглашение отправлено; согласие получателя ещё требуется.'
        await reloadRoster()
        emit('refresh')
      }
    }catch(e){
      if(identity()===scope)
        error.value=e instanceof Error?e.message:'teams.invite_retry_required'
    }
  }catch(e){
    if(identity()===scope)
      error.value=e instanceof Error?e.message:'teams.invite_error'
  }finally{busy.value=false}
}
async function acceptInvite(item:TeamInvitation):Promise<void>{
  if(busy.value||!item.trustedOwner||item.expired)return
  busy.value=true;notice.value='';error.value=''
  const scope=identity()
  try{
    await queueTeamAcceptance(item)
    if(identity()!==scope)return
    notice.value='Согласие подписано и сохранено в очереди.'
    try{
      await syncTeamMemberOperations()
      if(identity()===scope){
        await reload()
        notice.value='Участие подтверждено сервером.'
      }
    }catch(e){
      if(identity()===scope)
        error.value=e instanceof Error?e.message:'teams.accept_retry_required'
    }
  }catch(e){
    if(identity()===scope)
      error.value=e instanceof Error?e.message:'teams.accept_error'
  }finally{busy.value=false}
}
function online():void{void reload();void reloadRoster()}
watch(activeSession,()=>{++generation;selectedTeam.value='';roster.value=[];void reload()})
onMounted(()=>{void reload();window.addEventListener('online',online)})
onUnmounted(()=>{++generation;window.removeEventListener('online',online)})
</script>

<template>
  <div class="foundation-card" data-testid="team-membership-panel">
    <div class="contacts-list-heading">
      <h2>Участники и приглашения</h2>
      <button type="button" :disabled="loading||busy" @click="reload">Обновить</button>
    </div>
    <template v-if="ownedTeams.length">
      <label for="team-member-selector">Моя команда</label>
      <select id="team-member-selector" v-model="selectedTeam"
        data-testid="team-member-selector" @change="reloadRoster">
        <option value="">Выберите команду</option>
        <option v-for="team in ownedTeams" :key="team.teamId"
          :value="team.teamId" :disabled="team.delivery!=='synced'">
          {{ team.name }}{{ team.delivery!=='synced'?' · в очереди':'' }}
        </option>
      </select>
      <template v-if="selectedTeam">
        <div class="contacts-list-row">
          <div class="contacts-row-label">
            <strong>Владелец</strong><code>{{ activeSession?.accountId }}</code>
          </div>
        </div>
        <div v-for="person in roster" :key="person.inviteId"
          class="contacts-list-row"
          :data-testid="'team-member-'+person.recipientAccountId">
          <div class="contacts-row-label">
            <code>{{ person.recipientAccountId }}</code>
            <small>{{ roleText(person.role) }} · {{ person.state==='accepted'?'Принято':'Ожидает согласия' }}</small>
          </div>
        </div>
        <button type="button" class="contacts-full-button"
          :disabled="!hasNetwork()" @click="showInvite=!showInvite">
          Добавить участника
        </button>
        <form v-if="showInvite" data-testid="team-invite-form"
          @submit.prevent="sendInvite">
          <label for="team-invite-contact">Контакт</label>
          <select id="team-invite-contact" v-model="selectedContact" required
            data-testid="team-invite-contact">
            <option value="" disabled>Подтверждённый контакт</option>
            <option v-for="contact in contacts" :key="contact.peerAccountId"
              :value="contact.peerAccountId">
              {{ contact.alias||contact.peerAccountId }}
            </option>
          </select>
          <label for="team-invite-role">Роль</label>
          <select id="team-invite-role" v-model="selectedRole"
            data-testid="team-invite-role">
            <option value="curator">Куратор</option>
            <option value="contributor">Исполнитель</option>
            <option value="viewer">Наблюдатель</option>
          </select>
          <p class="muted">Участие в команде не выдаёт права на задания или файлы.</p>
          <button type="submit" :disabled="busy||!selectedContact"
            data-testid="team-invite-submit">Подписать и пригласить</button>
        </form>
      </template>
    </template>
    <div v-if="incoming.length" data-testid="team-incoming-invites">
      <h3>Полученные приглашения</h3>
      <div v-for="item in incoming" :key="item.inviteId"
        :data-testid="'team-invite-'+item.inviteId" class="contacts-list-row">
        <div class="contacts-row-label">
          <strong>{{ roleText(item.role) }}</strong>
          <code>От {{ item.ownerAccountId }}</code>
          <small>{{ item.state==='accepted'?'Принято':item.expired?'Истекло':'Ожидает ответа' }}</small>
          <small v-if="!item.trustedOwner">
            Не подтверждён ключ владельца — проверьте его отпечаток в Контактах.
          </small>
        </div>
        <button v-if="item.state==='pending'" type="button"
          :disabled="busy||!item.trustedOwner||item.expired"
          @click="acceptInvite(item)">Принять</button>
      </div>
    </div>
    <div v-if="joined.length" data-testid="team-joined-list">
      <h3>Участие в командах</h3>
      <div v-for="team in joined" :key="team.teamId"
        class="contacts-list-row" :data-testid="'joined-team-'+team.teamId">
        <span class="contacts-avatar" aria-hidden="true">
          {{ team.name.slice(0,1).toUpperCase() }}
        </span>
        <div class="contacts-row-label">
          <strong>{{ team.name }}</strong>
          <p class="muted">{{ team.description }}</p>
          <small>{{ roleText(team.role) }} · {{ team.verifiedOnline?'Подтверждено сервером':'Локальная копия; права требуют сети' }}</small>
        </div>
      </div>
    </div>
    <p v-if="loading" role="status" class="muted">Проверяем доступ и согласия…</p>
    <p v-if="notice" role="status" class="status-text">{{ notice }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </div>
</template>
