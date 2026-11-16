<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
import {listLocallyBlockedPeers} from '../features/people/application/contact-blocklist'

const props=withDefaults(defineProps<{
  ownedTeams:TeamView[]
  contacts:ConfirmedContact[]
  initialTeamId?:string|null
}>(),{initialTeamId:null})
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
const ownerActionsOpen=ref(false)
const selectedMember=computed(()=>roster.value.find(
  person=>person.inviteId===roleEditId.value)??null)
let memberActionsOpener:HTMLElement|null=null
const memberSheetClose=ref<HTMLButtonElement|null>(null)
function openMemberActions(person:TeamRosterMember|EpochRosterMember):void{
  if(!confirmedOwnTeam(selectedTeam.value))return
  ownerActionsOpen.value=false
  roleEditId.value=person.inviteId
  roleDraft.value=person.role
  memberActionsOpener=document.activeElement instanceof HTMLElement
    ?document.activeElement:null
  void nextTick(()=>memberSheetClose.value?.focus())
}
function openOwnerActions():void{
  if(!confirmedOwnTeam(selectedTeam.value))return
  roleEditId.value=null
  ownerActionsOpen.value=true
  memberActionsOpener=document.activeElement instanceof HTMLElement
    ?document.activeElement:null
  void nextTick(()=>memberSheetClose.value?.focus())
}
function closeMemberActions():void{
  ownerActionsOpen.value=false
  roleEditId.value=null
  const prior=memberActionsOpener
  memberActionsOpener=null
  void nextTick(()=>{if(prior?.isConnected)prior.focus()})
}
function memberSheetKeydown(e:KeyboardEvent):void{
  if(e.key==='Escape'){e.preventDefault();closeMemberActions();return}
  if(e.key!=='Tab')return
  const sheet=document.querySelector<HTMLElement>('[data-testid="team-member-sheet"]')
  const controls=Array.from(sheet?.querySelectorAll<HTMLElement>(
    'button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href]',
  )??[])
  if(!controls.length)return
  const first=controls[0]!,last=controls[controls.length-1]!
  if(e.shiftKey&&document.activeElement===first){
    e.preventDefault();last.focus()
  }else if(!e.shiftKey&&document.activeElement===last){
    e.preventDefault();first.focus()
  }
}
const busy=ref(false)
const loading=ref(false)
const error=ref('')
const notice=ref('')
let generation=0
let rosterEpoch=0
function identity():string{
  const s=activeSession.value
  return s?[s.accountId,s.deviceId,s.pkg.accountSpki,s.pkg.akek,s.pkg.revision].join('|'):''
}
function current(expected:string,token:number):boolean{
  return identity()===expected&&token===generation
}
function confirmedOwnTeam(id:string):boolean{
  return props.ownedTeams.some(team=>team.teamId===id&&team.delivery==='synced')
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
  const scope=identity(),id=selectedTeam.value,epoch=++rosterEpoch
  ownerActionsOpen.value=false
  memberActionsOpener=null
  const stillCurrent=()=>scope!==''&&identity()===scope
    &&epoch===rosterEpoch&&selectedTeam.value===id&&confirmedOwnTeam(id)
  roster.value=[];rotationRequired.value=false;keyEpoch.value=1
  roleEditId.value=null;error.value=''
  if(!id)return
  if(!confirmedOwnTeam(id)){
    // A previously selected owner Team is no longer server-confirmed.
    // Its historical cached roster must not remain actionable.
    selectedTeam.value=''
    return
  }
  if(!hasNetwork()){error.value='teams.roster_requires_online';return}
  try{
    await syncTeamKeyRotations()
    if(!stillCurrent())return
    await syncEpochInvitationOperations()
    if(!stillCurrent())return
    const teamEpoch=await ownerEpochStatus(id)
    if(!stillCurrent())return
    const [oldMembers,history]=await Promise.all([
      listOwnerTeamRoster(id),verifiedTeamMembershipHistory(id),
    ])
    if(!stillCurrent())return
    // Preserve the independently working original Team protocol.
    const epochMembers=teamEpoch.keyEpoch>=2
      ?await listOwnerEpochRoster(id):[]
    if(!stillCurrent())return
    if(teamEpoch.membershipRevision!==history.revision
      ||teamEpoch.rotationRequired!==history.rotationRequired)
      throw Error('teams.membership_epoch_mismatch')
    const activeFirst=new Map<string,TeamRosterMember|EpochRosterMember>()
    for(const person of [...oldMembers,...epochMembers]){
      const prior=activeFirst.get(person.recipientAccountId)
      if(!prior||person.state==='accepted'
        ||(prior.state!=='accepted'&&isEpochMember(person)))
        activeFirst.set(person.recipientAccountId,person)
    }
    if(!stillCurrent())return
    roster.value=[...activeFirst.values()]
    rotationRequired.value=history.rotationRequired
    keyEpoch.value=teamEpoch.keyEpoch
  }catch(e){
    if(stillCurrent())
      error.value=e instanceof Error?e.message:'teams.roster_error'
  }
}
async function rotateTeam():Promise<void>{
  if(busy.value||!selectedTeam.value||!rotationRequired.value)return
  const scope=identity(),teamId=selectedTeam.value,epoch=rosterEpoch
  const stillCurrent=()=>identity()===scope
    &&selectedTeam.value===teamId&&rosterEpoch===epoch
    &&confirmedOwnTeam(teamId)
  if(!confirmedOwnTeam(teamId)||!window.confirm(
    'Выпустить новый ключ команды и заново зашифровать её профиль? '+
    'Новый ключ получат только оставшиеся действующие участники. '+
    'Уже сохранённые бывшими участниками данные невозможно отозвать.',
  ))return
  busy.value=true;error.value='';notice.value=''
  try{
    await queueTeamKeyRotation(teamId)
    if(!stillCurrent())return
    notice.value='Новый ключ подписан и сохранён в зашифрованной очереди.'
    await syncTeamKeyRotations()
    if(!stillCurrent())return
    const pending=reloadRoster(),reloadedEpoch=rosterEpoch
    await pending
    if(identity()===scope&&selectedTeam.value===teamId
      &&rosterEpoch===reloadedEpoch&&confirmedOwnTeam(teamId)){
      notice.value='Новая эпоха подтверждена сервером. Текущий профиль защищён новым ключом.'
      emit('refresh')
    }
  }catch(e){
    if(stillCurrent())
      error.value=e instanceof Error?e.message:'teams.epoch_rotation_failed'
  }finally{if(identity()===scope)busy.value=false}
}
async function memberAction(
  person:TeamRosterMember,action:'change_role'|'remove',nextRole:TeamRole|null,
):Promise<void>{
  if(busy.value||rotationRequired.value||person.state==='revoked'
    ||!confirmedOwnTeam(selectedTeam.value)
    ||action==='change_role'&&(
      person.state!=='accepted'||nextRole===person.role))return
  const label=action==='remove'
    ?'Исключить участника? Его серверный доступ будет отозван. Команда заблокирует выдачу старого ключа до ротации Team DEK.'
    :'Изменить роль участника? Это не выдаёт прав на файлы или задания.'
  if(!window.confirm(label))return
  busy.value=true;error.value='';notice.value=''
  const scope=identity(),teamId=selectedTeam.value,epoch=rosterEpoch
  const stillCurrent=()=>identity()===scope
    &&selectedTeam.value===teamId&&rosterEpoch===epoch
    &&confirmedOwnTeam(teamId)
  try{
    // Capture target BEFORE any async queue/encryption. A rapid Team switch
    // cannot reroute a signed role change to a different Team.
    if(isEpochMember(person))
      await queueEpochMembershipChange(teamId,person,action,nextRole)
    else await queueTeamMembershipChange(teamId,person,action,nextRole)
    if(!stillCurrent())return
    notice.value='Изменение подписано и сохранено в очереди.'
    closeMemberActions()
    try{
      if(isEpochMember(person))
        await syncEpochInvitationOperations()
      else await syncTeamMemberOperations()
      if(!stillCurrent())return
      const pending=reloadRoster(),reloadedEpoch=rosterEpoch
      await pending
      if(identity()!==scope||selectedTeam.value!==teamId
        ||rosterEpoch!==reloadedEpoch||!confirmedOwnTeam(teamId))return
      notice.value=action==='remove'
        ?'Участник исключён сервером. Выдача старого Team DEK заблокирована до ротации.'
        :'Роль изменена и подтверждена сервером.'
      emit('refresh')
    }catch(e){
      if(stillCurrent())
        error.value=e instanceof Error?e.message:'teams.membership_retry_required'
    }
  }catch(e){
    if(stillCurrent())
      error.value=e instanceof Error?e.message:'teams.membership_change_failed'
  }finally{if(identity()===scope)busy.value=false}
}
// A contact hidden by local Blacklist may still be selected in a stale form.
// Never create a new signed invite from an out-of-date visible selection.
watch(()=>props.contacts.map(x=>x.peerAccountId).join('|'),()=>{
  if(selectedContact.value
    &&!props.contacts.some(x=>x.peerAccountId===selectedContact.value))
    selectedContact.value=''
})
async function sendInvite():Promise<void>{
  if(busy.value||rotationRequired.value
    ||!selectedTeam.value||!selectedContact.value
    ||!confirmedOwnTeam(selectedTeam.value))return
  if(!props.contacts.some(x=>x.peerAccountId===selectedContact.value)){
    selectedContact.value=''
    error.value='teams.invite_contact_not_available'
    return
  }
  busy.value=true;notice.value='';error.value=''
  const scope=identity(),teamId=selectedTeam.value,
    contact=selectedContact.value,role=selectedRole.value,
    epoch=rosterEpoch,encryptedEpoch=keyEpoch.value>1
  const stillCurrent=()=>identity()===scope
    &&selectedTeam.value===teamId&&rosterEpoch===epoch
    &&confirmedOwnTeam(teamId)
  try{
    // A blocklist read may wait for disk/crypto while the owner switches
    // Teams. The signed target, role and key epoch belong to the original
    // explicit submit, never the subsequently selected UI Team.
    const blocked=await listLocallyBlockedPeers()
    if(!stillCurrent())return
    if(selectedContact.value!==contact
      ||!props.contacts.some(x=>x.peerAccountId===contact)
      ||blocked.some(x=>x.peerAccountId===contact))
      throw Error('teams.invite_contact_not_available')
    if(encryptedEpoch)
      await queueEpochInvitation(teamId,contact,role)
    else await queueTeamInvitation(teamId,contact,role)
    if(!stillCurrent())return
    notice.value='Приглашение сохранено в зашифрованной очереди.'
    showInvite.value=false
    try{
      if(encryptedEpoch)await syncEpochInvitationOperations()
      else await syncTeamMemberOperations()
      if(!stillCurrent())return
      const pending=reloadRoster(),reloadedEpoch=rosterEpoch
      await pending
      if(identity()!==scope||selectedTeam.value!==teamId
        ||rosterEpoch!==reloadedEpoch||!confirmedOwnTeam(teamId))return
      notice.value='Приглашение отправлено; согласие получателя ещё требуется.'
      emit('refresh')
    }catch(e){
      if(stillCurrent())
        error.value=e instanceof Error?e.message:'teams.invite_retry_required'
    }
  }catch(e){
    if(stillCurrent())
      error.value=e instanceof Error?e.message:'teams.invite_error'
  }finally{if(identity()===scope)busy.value=false}
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
  }finally{if(identity()===scope)busy.value=false}
}
function online():void{void reload();void reloadRoster()}
function applyTeamContext():void{
  const id=props.initialTeamId
  if(!id||selectedTeam.value===id||!confirmedOwnTeam(id))return
  selectedTeam.value=id
  void reloadRoster()
}
function onTeamsChanged():void{
  const id=selectedTeam.value
  if(id&&!confirmedOwnTeam(id)){
    ++rosterEpoch
    selectedTeam.value=''
    roster.value=[]
    rotationRequired.value=false
    keyEpoch.value=1
    roleEditId.value=null
    ownerActionsOpen.value=false
    memberActionsOpener=null
    showInvite.value=false
    selectedContact.value=''
    error.value=''
  }
  applyTeamContext()
}
watch(()=>[props.initialTeamId,
  props.ownedTeams.map(team=>team.teamId+':'+team.delivery).join('|')],
  onTeamsChanged,{immediate:true})
watch(activeSession,(next,previous)=>{
  ++generation;++rosterEpoch
  const scope=(s:typeof activeSession.value)=>s
    ?[s.accountId,s.deviceId,s.pkg.accountSpki,s.pkg.akek,s.pkg.revision].join('|'):''
  if(scope(next)!==scope(previous)){
    selectedTeam.value='';selectedContact.value='';showInvite.value=false
    roster.value=[];incoming.value=[];joined.value=[]
    revokedTeamIds.value=[];suspendedTeamIds.value=[]
    rotationRequired.value=false;keyEpoch.value=1
    roleEditId.value=null
    ownerActionsOpen.value=false
    memberActionsOpener=null
    busy.value=false;loading.value=false
    notice.value='';error.value=''
  }
  void reload()
  applyTeamContext()
  if(selectedTeam.value)void reloadRoster()
})
onMounted(()=>{void reload();window.addEventListener('online',online)})
onUnmounted(()=>{
  ++generation;++rosterEpoch
  window.removeEventListener('online',online)
})
</script>

<template>
  <div class="foundation-card" data-testid="team-membership-panel">
    <div class="contacts-list-heading">
      <h2>Участники и приглашения</h2>
      <button type="button" :disabled="loading||busy" @click="reload">Обновить</button>
    </div>
    <template v-if="ownedTeams.length">
      <label v-if="!props.initialTeamId" for="team-member-selector">Моя команда</label>
      <select v-if="!props.initialTeamId" id="team-member-selector" v-model="selectedTeam"
        data-testid="team-member-selector" @change="reloadRoster">
        <option value="">Выберите команду</option>
        <option v-for="team in ownedTeams" :key="team.teamId"
          :value="team.teamId" :disabled="team.delivery!=='synced'">
          {{ team.name }}{{ team.delivery!=='synced'?' · в очереди':'' }}
        </option>
      </select>
      <template v-if="selectedTeam">
        <div class="contacts-list-row" data-testid="team-owner-member">
          <div class="contacts-row-label">
            <strong>Владелец</strong><code>{{ activeSession?.accountId }}</code>
          </div>
          <button type="button" class="contacts-member-more"
            data-testid="team-owner-actions"
            aria-label="Действия участника: владелец"
            @click="openOwnerActions">•••</button>
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
          </div>
          <button type="button" class="contacts-member-more"
            data-testid="team-member-actions"
            :aria-label="'Действия участника '+person.recipientAccountId"
            @click="openMemberActions(person)">•••</button>
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
          <button type="submit" :disabled="busy||!selectedContact||!contacts.some(x=>x.peerAccountId===selectedContact)"
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
    <template v-if="(ownerActionsOpen||selectedMember)&&selectedTeam">
      <div class="contacts-member-backdrop" data-testid="team-member-backdrop"
        @click="closeMemberActions"></div>
      <section class="contacts-member-sheet" role="dialog" aria-modal="true"
        aria-label="Действия участника"
        data-testid="team-member-sheet" @keydown="memberSheetKeydown">
        <header class="contacts-member-sheet-header">
          <strong>Участник команды</strong>
          <button ref="memberSheetClose" type="button"
            data-testid="team-member-sheet-close" aria-label="Закрыть действия участника"
            @click="closeMemberActions">✕</button>
        </header>
        <p v-if="ownerActionsOpen" data-testid="team-member-sheet-identity">
          {{ activeSession?.accountId }}
        </p>
        <p v-else-if="selectedMember" data-testid="team-member-sheet-identity">
          {{ selectedMember.recipientAccountId }}
        </p>
        <label class="contacts-member-sheet-field">
          Роль
          <select v-if="ownerActionsOpen" disabled data-testid="team-member-sheet-role">
            <option>Владелец</option>
          </select>
          <select v-else v-model="roleDraft" data-testid="team-member-sheet-role"
            :disabled="busy||rotationRequired||selectedMember?.state!=='accepted'">
            <option value="curator">Куратор</option>
            <option value="contributor">Исполнитель</option>
            <option value="viewer">Наблюдатель</option>
          </select>
        </label>
        <p v-if="ownerActionsOpen" class="muted">
          Роль владельца и его участие в собственной команде изменить нельзя.
        </p>
        <p v-else-if="rotationRequired" role="alert" class="muted">
          Изменение состава заблокировано до ротации ключа команды.
        </p>
        <p class="muted">
          Доступ к файлам определяется настоящими правилами заданий и E2EE-ключами.
          Эта панель не выдаёт самостоятельного разрешения на файлы.
        </p>
        <button v-if="selectedMember" type="button"
          class="contacts-member-sheet-primary" data-testid="team-member-sheet-apply"
          :disabled="busy||rotationRequired||selectedMember.state!=='accepted'
            ||roleDraft===selectedMember.role"
          @click="memberAction(selectedMember,'change_role',roleDraft)">
          Сохранить роль
        </button>
        <button v-if="selectedMember" type="button"
          data-testid="team-member-sheet-remove"
          :disabled="busy||rotationRequired||selectedMember.state==='revoked'"
          @click="memberAction(selectedMember,'remove',null)">
          Исключить из команды
        </button>
      </section>
    </template>
    <p v-if="loading" role="status" class="muted">Проверяем доступ и согласия…</p>
    <p v-if="notice" role="status" class="status-text">{{ notice }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </div>
</template>
