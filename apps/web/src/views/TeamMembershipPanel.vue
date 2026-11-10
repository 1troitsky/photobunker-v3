<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { activeSession } from '../features/identity/application/session'
import type { ConfirmedContact } from '../features/people/application/contact-book'
import type { TeamView } from '../features/people/application/team-book'
import {
  listOwnerTeamRoster, listIncomingTeamInvites, listCachedJoinedTeams,
  queueTeamInvitation, queueTeamAcceptance, syncTeamMemberOperations,
  queueTeamMembershipChange, verifiedTeamMembershipHistory,
  dropRevokedJoinedTeam,
} from '../features/people/application/team-invitations'
import type {
  TeamRole, TeamInvitation, TeamRosterMember, JoinedTeam,
} from '../features/people/application/team-invitations'
import {
  openAnyJoinedTeam, ownerEpochStatus, queueTeamKeyRotation,
  syncTeamKeyRotations, openVerifiedCurrentEpochMember,
} from '../features/people/application/team-epochs'
import {
  listEpochInvites, listOwnerEpochRoster,
  queueEpochInvitation, queueEpochAcceptance,
  queueEpochMembershipChange, syncEpochInvitationOperations,
  openJoinedEpochInvite,
} from '../features/people/application/team-epoch-invitations'
import type {
  EpochTeamInvite, EpochRosterMember,
} from '../features/people/application/team-epoch-invitations'
import {pinnedPeer} from '../features/sharing/key-directory'

defineProps<{ ownedTeams:TeamView[]; contacts:ConfirmedContact[] }>()
const emit=defineEmits<{ refresh:[] }>()
const selectedTeam=ref('')
const selectedContact=ref('')
const selectedRole=ref<TeamRole>('contributor')
const roster=ref<Array<TeamRosterMember|EpochRosterMember>>([])
const incoming=ref<Array<TeamInvitation|EpochTeamInvite>>([])
const joined=ref<JoinedTeam[]>([])
const revokedTeamIds=ref<string[]>([])
const suspendedTeamIds=ref<string[]>([])
const showInvite=ref(false)
const rotationRequired=ref(false)
const keyEpoch=ref(1)
const roleEditId=ref<string|null>(null)
const roleDraft=ref<TeamRole>('viewer')
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
function isEpochInvite(item:TeamInvitation|EpochTeamInvite):item is EpochTeamInvite{
  return 'version' in item&&item.version===2
}
function isEpochMember(
  item:TeamRosterMember|EpochRosterMember,
):item is EpochRosterMember{
  return 'protocolVersion' in item&&item.protocolVersion===2
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
  incoming.value=[];joined.value=[];revokedTeamIds.value=[]
  suspendedTeamIds.value=[];error.value=''
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
    await syncEpochInvitationOperations()
    const [legacy,epoch]=await Promise.all([
      listIncomingTeamInvites(),listEpochInvites(),
    ])
    if(!current(scope,token))return
    const entries=[...legacy.invites,...epoch.invites]
    incoming.value=entries
    const signedVerified=await Promise.all(entries.filter(x=>
      x.state==='accepted'&&x.trustedOwner).map(async item=>{
        try{
          return isEpochInvite(item)
            ?await openJoinedEpochInvite(item)
            :await openAnyJoinedTeam(item)
        }catch{return null}
      }))
    // Once a member has moved to a newer epoch, inboxes never re-send the
    // historical ECDH key. A signed active Team epoch grant is mandatory.
    const superseded=[...legacy.superseded,...epoch.superseded]
    const newVerified=await Promise.all(superseded.map(async item=>{
      try{
        const pin=await pinnedPeer(item.ownerAccountId)
        if(pin.accountSpki!==item.ownerAccountSpki)return null
        return await openVerifiedCurrentEpochMember(
          item.teamId,item.ownerAccountId)
      }catch{return null}
    }))
    if(!current(scope,token))return
    const known=new Map<string,JoinedTeam>()
    for(const item of [...signedVerified,...newVerified]){
      if(item)known.set(item.teamId,item)
    }
    const suspended=new Set([
      ...legacy.suspendedTeamIds,...epoch.suspendedTeamIds,
    ])
    const revoked=new Set([
      ...legacy.revokedTeamIds,...epoch.revokedTeamIds,
    ].filter(id=>!known.has(id)))
    revokedTeamIds.value=[...revoked]
    suspendedTeamIds.value=[...suspended].filter(id=>!known.has(id))
    for(const id of revoked)await dropRevokedJoinedTeam(id)
    if(!current(scope,token))return
    joined.value=[
      ...known.values(),
      ...joined.value.filter(x=>!known.has(x.teamId)&&!revoked.has(x.teamId))
        .map(x=>({...x,verifiedOnline:false})),
    ]
  }catch(e){
    if(current(scope,token))
      error.value=e instanceof Error?e.message:'teams.membership_error'
  }finally{if(current(scope,token))loading.value=false}
}
async function reloadRoster():Promise<void>{
  const scope=identity(),id=selectedTeam.value
  roster.value=[];rotationRequired.value=false;keyEpoch.value=1
  roleEditId.value=null;error.value=''
  if(!id)return
  if(!hasNetwork()){error.value='teams.roster_requires_online';return}
  try{
    await syncTeamKeyRotations()
    await syncEpochInvitationOperations()
    const [oldMembers,epochMembers,history,epoch]=await Promise.all([
      listOwnerTeamRoster(id),listOwnerEpochRoster(id),
      verifiedTeamMembershipHistory(id),ownerEpochStatus(id),
    ])
    if(epoch.membershipRevision!==history.revision
      ||epoch.rotationRequired!==history.rotationRequired)
      throw Error('teams.membership_epoch_mismatch')
    if(identity()===scope&&selectedTeam.value===id){
      const activeFirst=new Map<string,TeamRosterMember|EpochRosterMember>()
      for(const person of [...oldMembers,...epochMembers]){
        const prior=activeFirst.get(person.recipientAccountId)
        if(!prior||person.state==='accepted'
          ||(prior.state!=='accepted'
            &&isEpochMember(person)))
          activeFirst.set(person.recipientAccountId,person)
      }
      roster.value=[...activeFirst.values()]
      rotationRequired.value=history.rotationRequired
      keyEpoch.value=epoch.keyEpoch
    }
  }catch(e){
    if(identity()===scope&&selectedTeam.value===id)
      error.value=e instanceof Error?e.message:'teams.roster_error'
  }
}
async function rotateTeam():Promise<void>{
  if(busy.value||!selectedTeam.value||!rotationRequired.value)return
  const scope=identity(),teamId=selectedTeam.value
  if(!window.confirm(
    'Выпустить новый ключ команды и заново зашифровать её профиль? '+
    'Новый ключ получат только оставшиеся действующие участники. '+
    'Уже сохранённые бывшими участниками данные невозможно отозвать.',
  ))return
  busy.value=true;error.value='';notice.value=''
  try{
    await queueTeamKeyRotation(teamId)
    if(identity()!==scope)return
    notice.value='Новый ключ подписан и сохранён в зашифрованной очереди.'
    await syncTeamKeyRotations()
    if(identity()!==scope)return
    await reloadRoster()
    if(identity()===scope){
      notice.value='Новая эпоха подтверждена сервером. Текущий профиль защищён новым ключом.'
      emit('refresh')
    }
  }catch(e){
    if(identity()===scope)
      error.value=e instanceof Error?e.message:'teams.epoch_rotation_failed'
  }finally{busy.value=false}
}
async function memberAction(
  person:TeamRosterMember,action:'change_role'|'remove',nextRole:TeamRole|null,
):Promise<void>{
  if(busy.value||rotationRequired.value||person.state==='revoked'
    ||action==='change_role'&&(
      person.state!=='accepted'||nextRole===person.role))return
  const label=action==='remove'
    ?'Исключить участника? Его серверный доступ будет отозван. Команда заблокирует выдачу старого ключа до ротации Team DEK.'
    :'Изменить роль участника? Это не выдаёт прав на файлы или задания.'
  if(!window.confirm(label))return
  busy.value=true;error.value='';notice.value=''
  const scope=identity()
  try{
    const id=selectedTeam.value
    if(isEpochMember(person))
      await queueEpochMembershipChange(id,person,action,nextRole)
    else await queueTeamMembershipChange(id,person,action,nextRole)
    if(identity()!==scope)return
    notice.value='Изменение подписано и сохранено в очереди.'
    roleEditId.value=null
    try{
      if(isEpochMember(person))
        await syncEpochInvitationOperations()
      else await syncTeamMemberOperations()
      if(identity()!==scope)return
      await reloadRoster()
      notice.value=action==='remove'
        ?'Участник исключён сервером. Выдача старого Team DEK заблокирована до ротации.'
        :'Роль изменена и подтверждена сервером.'
      emit('refresh')
    }catch(e){
      if(identity()===scope)
        error.value=e instanceof Error?e.message:'teams.membership_retry_required'
    }
  }catch(e){
    if(identity()===scope)
      error.value=e instanceof Error?e.message:'teams.membership_change_failed'
  }finally{busy.value=false}
}
async function sendInvite():Promise<void>{
  if(busy.value||rotationRequired.value
    ||!selectedTeam.value||!selectedContact.value)return
  busy.value=true;notice.value='';error.value=''
  const scope=identity()
  try{
    if(keyEpoch.value>1)
      await queueEpochInvitation(selectedTeam.value,selectedContact.value,selectedRole.value)
    else await queueTeamInvitation(selectedTeam.value,selectedContact.value,selectedRole.value)
    if(identity()!==scope)return
    notice.value='Приглашение сохранено в зашифрованной очереди.'
    showInvite.value=false
    try{
      if(keyEpoch.value>1)await syncEpochInvitationOperations()
      else await syncTeamMemberOperations()
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
async function acceptInvite(item:TeamInvitation|EpochTeamInvite):Promise<void>{
  if(busy.value||!item.trustedOwner||item.expired)return
  busy.value=true;notice.value='';error.value=''
  const scope=identity()
  try{
    if(isEpochInvite(item))
      await queueEpochAcceptance(item)
    else await queueTeamAcceptance(item)
    if(identity()!==scope)return
    notice.value='Согласие подписано и сохранено в очереди.'
    try{
      if(isEpochInvite(item))
        await syncEpochInvitationOperations()
      else await syncTeamMemberOperations()
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
        <p v-if="rotationRequired" role="alert" class="error-text"
          data-testid="team-rotation-required">
          Выдача старого Team DEK заблокирована после исключения участника.
          Нужно выпустить новый ключ для оставшихся участников.
        </p>
        <button v-if="rotationRequired" type="button" class="contacts-full-button"
          :disabled="busy||!hasNetwork()" data-testid="team-rotate-key"
          @click="rotateTeam">Обновить ключ команды</button>
        <p v-if="keyEpoch>1&&!rotationRequired" class="muted"
          data-testid="team-key-epoch">
          Ключ команды обновлён (эпоха {{ keyEpoch }}).
          Новые приглашения защищены ключом этой эпохи.
        </p>
        <div v-for="person in roster" :key="person.inviteId"
          class="contacts-list-row"
          :data-testid="'team-member-'+person.recipientAccountId">
          <div class="contacts-row-label">
            <code>{{ person.recipientAccountId }}</code>
            <small>{{ roleText(person.role) }} · {{ person.state==='accepted'?'Принято':person.state==='revoked'?'Исключён':'Ожидает согласия' }}</small>
            <div v-if="roleEditId===person.inviteId" class="action-row">
              <select v-model="roleDraft" :aria-label="'Роль '+person.recipientAccountId">
                <option value="curator">Куратор</option>
                <option value="contributor">Исполнитель</option>
                <option value="viewer">Наблюдатель</option>
              </select>
              <button type="button" :disabled="busy||roleDraft===person.role"
                @click="memberAction(person,'change_role',roleDraft)">Применить</button>
              <button type="button" @click="roleEditId=null">Отмена</button>
            </div>
          </div>
          <div v-if="!rotationRequired&&person.state!=='revoked'" class="action-row">
            <button v-if="person.state==='accepted'" type="button"
              :disabled="busy" @click="roleEditId=person.inviteId;roleDraft=person.role">
              Роль
            </button>
            <button type="button" :disabled="busy"
              @click="memberAction(person,'remove',null)">Исключить</button>
          </div>
        </div>
        <button type="button" class="contacts-full-button"
          :disabled="!hasNetwork()||rotationRequired" @click="showInvite=!showInvite">
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
    <p v-if="suspendedTeamIds.length" role="status"
      data-testid="team-suspended-notice">
      Команда ожидает ротацию ключа после изменения состава.
      Старые ключевые конверты временно не выдаются.
    </p>
    <p v-if="revokedTeamIds.length" role="status"
      data-testid="team-revoked-notice">
      Доступ к команде отозван. Зашифрованный локальный снимок удалён.
    </p>
    <div v-if="incoming.length" data-testid="team-incoming-invites">
      <h3>Полученные приглашения</h3>
      <div v-for="item in incoming" :key="item.inviteId"
        :data-testid="'team-invite-'+item.inviteId" class="contacts-list-row">
        <div class="contacts-row-label">
          <strong>{{ roleText(item.role) }}</strong>
          <code>От {{ item.ownerAccountId }}</code>
          <small>{{ item.state==='revoked'?'Отозвано':item.state==='accepted'?'Принято':item.expired?'Истекло':'Ожидает ответа' }}</small>
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
