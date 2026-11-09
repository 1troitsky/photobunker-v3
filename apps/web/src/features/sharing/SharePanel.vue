<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { activeSession, reauthenticate } from '../identity/application/session'
import {
  confirmPeer, ensureOwnExchangeKey, inspectPeer,
} from './key-directory'
import {
  queueRecipientGrant, flushRecipientGrants, listOutgoingGrants,
  listReceivedGrants, readReceivedPhoto, revokeOutgoingGrant,
} from './grant-flow'
import type { OutgoingGrant, RecipientPhoto } from './grant-flow'
import type { StoredPhoto } from '../photo-sync/application/p1-photo'

defineProps<{ localPhotos: StoredPhoto[] }>()
const emit=defineEmits<{ openPhoto:[blob:Blob] }>()

const recipientId=ref('')
const pendingPeer=ref<{id:string;fingerprint:string;confirmed:boolean}|null>(null)
const incomingPeer=ref<{id:string;fingerprint:string;confirmed:boolean}|null>(null)
const acknowledgedPeer=ref(false)
const acknowledgedOwner=ref(false)
const received=ref<RecipientPhoto[]>([])
const outgoing=ref<OutgoingGrant[]>([])
const keyStatus=ref('')
const status=ref('')
const error=ref('')
const busy=ref(false)

async function action(task:()=>Promise<void>):Promise<void> {
  if(busy.value)return
  busy.value=true
  error.value=''
  try { await task() }
  catch(e){error.value=e instanceof Error?e.message:'share.operation_failed'}
  finally{busy.value=false}
}

async function initialize():Promise<void> {
  if(!activeSession.value?.online)return
  try{
    await ensureOwnExchangeKey()
    keyStatus.value='Ключ обмена подготовлен'
    outgoing.value=await listOutgoingGrants()
    received.value=await listReceivedGrants()
  }catch(e){
    keyStatus.value=e instanceof Error?e.message:'share.key_unavailable'
  }
}

function inspectRecipient():void {
  void action(async()=>{
    const id=recipientId.value.trim().toLowerCase()
    if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('share.invalid_recipient')
    if(!activeSession.value?.online)await reauthenticate()
    const {directory,confirmed}=await inspectPeer(id)
    pendingPeer.value={id,fingerprint:directory.safetyFingerprint,confirmed}
    acknowledgedPeer.value=false
  })
}
function approveRecipient():void {
  void action(async()=>{
    const candidate=pendingPeer.value
    if(!candidate||!acknowledgedPeer.value)throw new Error('share.fingerprint_not_confirmed')
    await confirmPeer(candidate.id,candidate.fingerprint)
    pendingPeer.value={...candidate,confirmed:true}
    status.value='Получатель подтверждён на этом устройстве'
  })
}
function send(photoId:string):void {
  void action(async()=>{
    if(!pendingPeer.value?.confirmed)throw new Error('share.peer_not_confirmed')
    const grantId=await queueRecipientGrant(photoId,pendingPeer.value.id)
    outgoing.value=await listOutgoingGrants()
    status.value='Конверт сохранён в локальной очереди: '+grantId.slice(0,8)
    await flushRecipientGrants()
    outgoing.value=await listOutgoingGrants()
  })
}
function refreshGrants():void {
  void action(async()=>{
    if(!activeSession.value?.online)await reauthenticate()
    await ensureOwnExchangeKey()
    await flushRecipientGrants()
    outgoing.value=await listOutgoingGrants()
    received.value=await listReceivedGrants()
    status.value='Список полученных разрешений обновлён'
  })
}
function checkOwner(ownerId:string):void {
  void action(async()=>{
    if(!activeSession.value?.online)await reauthenticate()
    const {directory,confirmed}=await inspectPeer(ownerId)
    incomingPeer.value={id:ownerId,fingerprint:directory.safetyFingerprint,confirmed}
    acknowledgedOwner.value=false
  })
}
function approveOwner():void {
  void action(async()=>{
    const candidate=incomingPeer.value
    if(!candidate||!acknowledgedOwner.value)throw new Error('share.fingerprint_not_confirmed')
    await confirmPeer(candidate.id,candidate.fingerprint)
    incomingPeer.value={...candidate,confirmed:true}
    status.value='Отправитель подтверждён'
  })
}
function openReceived(grantId:string,ownerId:string):void {
  void action(async()=>{
    if(incomingPeer.value?.id!==ownerId||!incomingPeer.value.confirmed){
      throw new Error('share.verify_owner_before_read')
    }
    emit('openPhoto',await readReceivedPhoto(grantId))
    status.value='Полученная фотография расшифрована на устройстве'
  })
}
function revoke(grantId:string):void {
  void action(async()=>{
    await revokeOutgoingGrant(grantId)
    outgoing.value=await listOutgoingGrants()
    status.value='Дальнейшее серверное чтение отозвано'
  })
}
watch(activeSession,()=>{pendingPeer.value=null;incomingPeer.value=null;void initialize()})
onMounted(()=>{void initialize()})
</script>

<template>
  <div class="foundation-card share-panel">
    <h2>E2EE-передача · P1</h2>
    <p class="muted">Только личные фотографии. Передача ключа требует ручного подтверждения отпечатка собеседника.</p>
    <p class="muted">Мой ключ: {{ keyStatus || 'Проверка…' }}</p>

    <label for="recipient-account-id">ID аккаунта получателя</label>
    <input id="recipient-account-id" v-model="recipientId" autocomplete="off"
      spellcheck="false" inputmode="text" placeholder="UUID аккаунта">
    <button type="button" :disabled="busy||!recipientId" @click="inspectRecipient">Проверить ключ</button>
    <div v-if="pendingPeer" class="fingerprint-panel">
      <strong>Отпечаток получателя</strong>
      <code>{{ pendingPeer.fingerprint }}</code>
      <template v-if="!pendingPeer.confirmed">
        <p class="muted">Сверьте этот отпечаток с владельцем аккаунта через независимый канал. Каталогу сервера нельзя доверять при первом контакте.</p>
        <label class="checkline"><input v-model="acknowledgedPeer" type="checkbox"> Я сверил отпечаток получателя</label>
        <button type="button" :disabled="!acknowledgedPeer||busy" @click="approveRecipient">Подтвердить отпечаток</button>
      </template>
      <p v-else class="status-text">Ключ получателя подтверждён</p>
    </div>
    <div v-if="pendingPeer?.confirmed">
      <h3>Локально подтверждённые фотографии</h3>
      <div v-for="photo in localPhotos.filter(p=>p.state==='synced')" :key="photo.key" class="photo-row">
        <code>{{ photo.photoId.slice(0,8) }}</code>
        <button type="button" :disabled="busy" @click="send(photo.photoId)">Передать</button>
      </div>
    </div>

    <h3>Исходящие разрешения</h3>
    <div v-for="grant in outgoing" :key="grant.id" class="photo-row">
      <div>
        <code>{{ grant.id.slice(0,8) }} · {{ grant.state }}</code>
        <small>{{ grant.recipientAccountId.slice(0,8) }}</small>
      </div>
      <button v-if="grant.state==='sent'" type="button" :disabled="busy" @click="revoke(grant.id)">Отозвать</button>
    </div>

    <h3>Полученные фотографии</h3>
    <button type="button" :disabled="busy" @click="refreshGrants">Обновить полученные</button>
    <p v-if="!received.length" class="muted">Нет доступных разрешений</p>
    <div v-for="grant in received" :key="grant.grantId" class="photo-row">
      <div>
        <code>{{ grant.photoId.slice(0,8) }}</code>
        <small>От: {{ grant.ownerAccountId.slice(0,8) }} · до {{ new Date(grant.expiresAt).toLocaleString() }}</small>
      </div>
      <div class="share-actions">
        <button type="button" :disabled="busy" @click="checkOwner(grant.ownerAccountId)">Ключ отправителя</button>
        <button type="button" :disabled="busy||incomingPeer?.id!==grant.ownerAccountId||!incomingPeer.confirmed"
          @click="openReceived(grant.grantId,grant.ownerAccountId)">Открыть полученное</button>
      </div>
    </div>
    <div v-if="incomingPeer" class="fingerprint-panel">
      <strong>Отпечаток отправителя</strong>
      <code>{{ incomingPeer.fingerprint }}</code>
      <template v-if="!incomingPeer.confirmed">
        <p class="muted">Сверьте с отправителем вне приложения; не доверяйте только каталогу сервера.</p>
        <label class="checkline"><input v-model="acknowledgedOwner" type="checkbox"> Я сверил отпечаток отправителя</label>
        <button type="button" :disabled="busy||!acknowledgedOwner" @click="approveOwner">Подтвердить отправителя</button>
      </template>
      <p v-else class="status-text">Подпись отправителя будет проверена перед расшифровкой</p>
    </div>
    <p v-if="status" class="status-text" role="status">{{ status }}</p>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p class="muted">Отзыв прекращает будущие серверные выдачи. Уже сохранённые другим человеком копии отозвать криптографически невозможно.</p>
  </div>
</template>
