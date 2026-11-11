<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue'
import {activeSession,reauthenticate} from '../../identity/application/session'
import {
  confirmPeer,ensureOwnExchangeKey,inspectPeer,
} from '../../sharing/key-directory'
import {
  attachMediaGrantLifecycle,flushMediaGrants,
  listOutgoingMediaGrants,listReceivedMediaGrants,
  queueMediaRecipientGrant,queueMediaSafeRecipientGrant,
  readReceivedMediaGrant,revokeMediaGrant,parseMediaGrantContract,
} from '../application/media-grants'
import type {
  ReceivedMediaGrant,OutgoingMediaGrant,
} from '../application/media-grants'
import type {StoredMedia} from '../application/media-outbox'
import {listSafeDerivativeCandidates} from '../application/safe-derivatives'
import type {SafeDerivativeCandidate} from '../application/safe-derivatives'
import {
  emptyPreviewFields,loadFilePreviewDraft,queueFilePreviewDraft,
  flushFilePreviewDrafts,filePreviewDraftStatus,PREVIEW_FIELD_KEYS,
} from '../application/media-file-preview-policy'
import type {PreviewFields,PreviewField} from '../application/media-file-preview-policy'
import {
  queueEditorialLink,queueEditorialDetach,readEditorialLink,
  flushEditorialLinks,editorialLinkState,
} from '../application/safe-assignment-editorial'
import type {EditorialBinding} from '../application/safe-assignment-editorial'
import {
  listServerAssignments,verifySignedAssignmentPolicy,
} from '../../assignments/application/assignment-outbox'
import type {AssignmentListing} from '../../assignments/application/assignment-outbox'
import type {MediaMetadata} from '../domain/media-crypto'

defineProps<{localMedia:StoredMedia[]}>()
const emit=defineEmits<{
  openMedia:[blob:Blob,metadata:MediaMetadata]
}>()
const recipientId=ref('')
const recipientPeer=ref<{
  id:string;fingerprint:string;confirmed:boolean
}|null>(null)
const ownerPeer=ref<{
  id:string;fingerprint:string;confirmed:boolean
}|null>(null)
const acknowledgedRecipient=ref(false)
const acknowledgedOwner=ref(false)
const outgoing=ref<OutgoingMediaGrant[]>([])
const incoming=ref<ReceivedMediaGrant[]>([])
const safeCandidates=ref<SafeDerivativeCandidate[]>([])
const previewCandidate=ref<SafeDerivativeCandidate|null>(null)
const previewFields=ref<PreviewFields>(emptyPreviewFields())
const previewRevision=ref(0)
const previewStatus=ref('none')
const editorialCandidate=ref<SafeDerivativeCandidate|null>(null)
const editorialAssignments=ref<AssignmentListing[]>([])
const editorialSelection=ref('')
const editorialBinding=ref<EditorialBinding|null>(null)
const editorialState=ref('none')
const previewLabels:Record<PreviewField,string>={
  description:'Описание',capturedAt:'Дата съёмки',
  updatedAt:'Дата изменения',tags:'Теги',
  authorTeam:'Автор / команда',gps:'Геолокация',
  metadata:'Технические метаданные',
}
const busy=ref(false)
const error=ref('')
const status=ref('')
let detach:()=>void=()=>{}
async function action(callback:()=>Promise<void>):Promise<void>{
  if(busy.value)return
  busy.value=true;error.value='';status.value=''
  try{await callback()}
  catch(e){error.value=e instanceof Error?e.message:'media_grant.failed'}
  finally{busy.value=false}
}
async function hydrate():Promise<void>{
  const session=activeSession.value
  if(!session){outgoing.value=[];incoming.value=[];safeCandidates.value=[];return}
  try{
    if(session.online){
      await ensureOwnExchangeKey()
      await flushMediaGrants()
      await flushFilePreviewDrafts()
      await flushEditorialLinks()
    }
    const [next,localSafe]=await Promise.all([
      listOutgoingMediaGrants(),listSafeDerivativeCandidates(),
    ])
    if(activeSession.value!==session)return
    outgoing.value=next
    safeCandidates.value=localSafe
    if(session.online){
      const result=await listReceivedMediaGrants()
      if(activeSession.value===session)incoming.value=result
    }else incoming.value=[]
  }catch(e){
    if(activeSession.value===session)
      error.value=e instanceof Error?e.message:'media_grant.load_failed'
  }
}
function checkRecipient():void{
  void action(async()=>{
    const id=recipientId.value.trim().toLowerCase()
    if(!/^[0-9a-f-]{36}$/.test(id))
      throw Error('media_grant.invalid_recipient')
    if(!activeSession.value?.online)await reauthenticate()
    const {directory,confirmed}=await inspectPeer(id)
    recipientPeer.value={
      id,fingerprint:directory.safetyFingerprint,confirmed,
    }
    acknowledgedRecipient.value=false
  })
}
function acceptRecipient():void{
  void action(async()=>{
    const candidate=recipientPeer.value
    if(!candidate||!acknowledgedRecipient.value)
      throw Error('media_grant.fingerprint_not_confirmed')
    await confirmPeer(candidate.id,candidate.fingerprint)
    recipientPeer.value={...candidate,confirmed:true}
    status.value='Получатель подтверждён по независимому отпечатку'
  })
}
function send(mediaId:string):void{
  void action(async()=>{
    const peer=recipientPeer.value
    if(!peer?.confirmed)throw Error('media_grant.peer_not_confirmed')
    if(safeCandidates.value.some(row=>row.sourceMediaId===mediaId)
      &&!window.confirm('Выбран ПОЛНЫЙ исходный файл, а не закрытая копия. Получатель сможет расшифровать его без масок. Для адресной Safe-передачи используйте специальную кнопку ниже. Всё равно передать оригинал?'))
      return
    const grantId=await queueMediaRecipientGrant(mediaId,peer.id)
    outgoing.value=await listOutgoingMediaGrants()
    await flushMediaGrants()
    outgoing.value=await listOutgoingMediaGrants()
    status.value='Разрешение сохранено: '+grantId.slice(0,8)
  })
}
function sendSafe(candidate:SafeDerivativeCandidate):void{
  void action(async()=>{
    const peer=recipientPeer.value
    if(!peer?.confirmed)throw Error('media_grant.peer_not_confirmed')
    if(!window.confirm('Разрешить адресату читать ТОЛЬКО отдельную закрытую JPEG-копию? Оригинал останется под собственными независимыми разрешениями. Убедитесь, что чувствительные области закрыты. Это не публичная ссылка.'))
      return
    const grantId=await queueMediaSafeRecipientGrant(
      candidate.sourceMediaId,candidate.safeMediaId,peer.id)
    outgoing.value=await listOutgoingMediaGrants()
    await flushMediaGrants()
    outgoing.value=await listOutgoingMediaGrants()
    status.value='Адресный Safe-грант записан: '+grantId.slice(0,8)
  })
}
function openPreviewDraft(candidate:SafeDerivativeCandidate):void{
  void action(async()=>{
    const data=await loadFilePreviewDraft(candidate.safeMediaId)
    previewCandidate.value=candidate
    previewFields.value=data.contract
      ?{...data.contract.fields}:emptyPreviewFields()
    previewRevision.value=data.contract?.toRevision??0
    previewStatus.value=data.state
    status.value='Это только закрытые настройки будущей карточки: публичный доступ и скачивание запрещены.'
  })
}
function savePreviewDraft():void{
  void action(async()=>{
    const candidate=previewCandidate.value
    if(!candidate)throw Error('file_preview.no_candidate')
    const rev=await queueFilePreviewDraft(
      candidate.sourceMediaId,candidate.safeMediaId,previewFields.value)
    await flushFilePreviewDrafts()
    previewRevision.value=rev
    previewStatus.value=await filePreviewDraftStatus(candidate.safeMediaId)
    status.value=previewStatus.value==='sent'
      ?'Подписанный черновик сохранён. Публикация выключена.'
      :'Подписанный черновик в локальной очереди. Публикация выключена.'
  })
}
function togglePreviewField(field:PreviewField,event:Event):void{
  previewFields.value={
    ...previewFields.value,
    [field]:(event.target as HTMLInputElement).checked,
  }
}
function openEditorial(candidate:SafeDerivativeCandidate):void{
  void action(async()=>{
    if(!activeSession.value?.online)await reauthenticate()
    editorialCandidate.value=candidate
    editorialBinding.value=null
    editorialAssignments.value=[]
    editorialSelection.value=''
    let cursor:string|undefined
    do{
      const page=await listServerAssignments(cursor)
      for(const row of page.items){
        if(row.ownerAccountId!==activeSession.value?.accountId)continue
        await verifySignedAssignmentPolicy(row,false)
        editorialAssignments.value.push(row)
      }
      cursor=page.nextCursor??undefined
    }while(cursor&&editorialAssignments.value.length<60)
    editorialState.value=await editorialLinkState(candidate.safeMediaId)
    editorialBinding.value=await readEditorialLink(candidate.safeMediaId)
    if(editorialBinding.value)
      editorialSelection.value=editorialBinding.value.assignmentId
    status.value=editorialBinding.value
      ?'Редакционная привязка подписана и подтверждена сервером. Публичный доступ выключен.'
      :'Выберите своё задание для явной редакционной привязки. Это не отчёт исполнителя и не публикация.'
  })
}
function bindEditorial():void{
  void action(async()=>{
    const candidate=editorialCandidate.value
    const assignment=editorialAssignments.value.find(
      a=>a.assignmentId===editorialSelection.value)
    if(!candidate||!assignment)
      throw Error('safe_editorial.choose_owned_assignment')
    if(!window.confirm('Связать вашу собственную закрытую копию с ВАШИМ заданием? Это только редакционная привязка, не доказательство выполнения другим участником и не публичная ссылка.'))
      return
    await queueEditorialLink(candidate,assignment)
    await flushEditorialLinks()
    editorialState.value=await editorialLinkState(candidate.safeMediaId)
    if(editorialState.value!=='sent')
      throw Error('safe_editorial.awaiting_server_or_conflict')
    editorialBinding.value=await readEditorialLink(candidate.safeMediaId)
    if(!editorialBinding.value)
      throw Error('safe_editorial.missing_server_receipt')
    status.value='Подписанная редакционная привязка подтверждена. Публичные поля все закрыты.'
  })
}
function detachEditorial():void{
  void action(async()=>{
    const prior=editorialBinding.value
    if(!prior)return
    if(!window.confirm('Отвязать закрытую копию от задания? Подписанная история сохраняется; повторная привязка этой копии пока запрещена. Сам файл и E2EE-разрешения не удаляются.'))
      return
    await queueEditorialDetach(prior)
    await flushEditorialLinks()
    editorialState.value=await editorialLinkState(prior.safeMediaId)
    if(editorialState.value!=='sent')
      throw Error('safe_editorial.detach_awaiting_server')
    editorialBinding.value=null
    status.value='Редакционная привязка отозвана. Файлы и ключи не затронуты.'
  })
}
function grantScopeLabel(row:OutgoingMediaGrant):string{
  try{
    return parseMediaGrantContract(JSON.parse(row.contract)).scope==='safe_read'
      ?'Только Safe-копия':'Полный файл (read)'
  }catch{return 'Неизвестное разрешение'}
}
function checkOwner(id:string):void{
  void action(async()=>{
    if(!activeSession.value?.online)await reauthenticate()
    const {directory,confirmed}=await inspectPeer(id)
    ownerPeer.value={
      id,fingerprint:directory.safetyFingerprint,confirmed,
    }
    acknowledgedOwner.value=false
  })
}
function acceptOwner():void{
  void action(async()=>{
    const candidate=ownerPeer.value
    if(!candidate||!acknowledgedOwner.value)
      throw Error('media_grant.fingerprint_not_confirmed')
    await confirmPeer(candidate.id,candidate.fingerprint)
    ownerPeer.value={...candidate,confirmed:true}
    status.value='Подпись отправителя будет проверена перед чтением'
  })
}
function openReceived(grant:ReceivedMediaGrant):void{
  void action(async()=>{
    if(ownerPeer.value?.id!==grant.ownerAccountId
      ||!ownerPeer.value?.confirmed)
      throw Error('media_grant.verify_owner_first')
    const result=await readReceivedMediaGrant(grant.grantId)
    emit('openMedia',result.blob,result.metadata)
    status.value='Медиа расшифровано на устройстве'
  })
}
function revoke(grantId:string):void{
  void action(async()=>{
    await revokeMediaGrant(grantId)
    outgoing.value=await listOutgoingMediaGrants()
    status.value='Серверный доступ отозван'
  })
}
function refresh():void{
  void action(async()=>{
    if(!activeSession.value?.online)await reauthenticate()
    await hydrate()
  })
}
function sameIdentity(
  a:typeof activeSession.value,b:typeof activeSession.value,
):boolean{
  return !!a&&!!b&&a.accountId===b.accountId
    &&a.deviceId===b.deviceId
    &&a.pkg.accountSpki===b.pkg.accountSpki
    &&a.pkg.revision===b.pkg.revision
}
watch(activeSession,(next,previous)=>{
  // Background proof/online refresh may replace the Session object while
  // a user is editing a private preview or signing an editorial link.
  // Never destroy that work unless the cryptographic identity changed.
  if(sameIdentity(next,previous)){
    if(next?.online&&!previous?.online)void hydrate()
    return
  }
  recipientPeer.value=null;ownerPeer.value=null
  outgoing.value=[];incoming.value=[];safeCandidates.value=[]
  previewCandidate.value=null
  previewFields.value=emptyPreviewFields()
  previewRevision.value=0
  previewStatus.value='none'
  editorialCandidate.value=null
  editorialBinding.value=null
  editorialAssignments.value=[]
  editorialSelection.value=''
  editorialState.value='none'
  void hydrate()
})
const refreshPreviewOutbox=()=>{
  void flushFilePreviewDrafts()
  void flushEditorialLinks()
}
onMounted(()=>{
  detach=attachMediaGrantLifecycle()
  window.addEventListener('online',refreshPreviewOutbox)
  document.addEventListener('visibilitychange',refreshPreviewOutbox)
  void hydrate()
})
onUnmounted(()=>{
  detach()
  window.removeEventListener('online',refreshPreviewOutbox)
  document.removeEventListener('visibilitychange',refreshPreviewOutbox)
})
</script>

<template>
  <section class="media-share-panel" data-testid="media-share-panel">
    <h3>E2EE-передача файлов · P1</h3>
    <p class="muted">
      Только подтверждённый получатель. Сверьте отпечаток вне приложения.
      Разрешение «Чтение» передаёт ключ всего файла и его метаданных;
      оно не создаёт публичную ссылку, не передаёт доступ к другому аккаунту
      и не включает автоматический экспорт в галерею.
    </p>
    <label for="media-share-peer-id">ID аккаунта получателя</label>
    <input id="media-share-peer-id" v-model="recipientId" type="text"
      autocomplete="off" spellcheck="false" placeholder="UUID аккаунта">
    <button type="button" :disabled="busy||!recipientId"
      @click="checkRecipient">Проверить получателя медиа</button>
    <div v-if="recipientPeer" class="fingerprint-panel">
      <strong>Отпечаток получателя медиа</strong>
      <code data-testid="media-recipient-fingerprint">{{ recipientPeer.fingerprint }}</code>
      <template v-if="!recipientPeer.confirmed">
        <p class="muted">Сверьте с человеком по независимому каналу. Доверие к серверному каталогу недостаточно.</p>
        <label><input v-model="acknowledgedRecipient" type="checkbox">
          Я сверил отпечаток получателя медиа</label>
        <button type="button" :disabled="busy||!acknowledgedRecipient"
          @click="acceptRecipient">Подтвердить получателя медиа</button>
      </template>
      <span v-else class="status-text">Ключ получателя подтверждён</span>
    </div>
    <template v-if="recipientPeer?.confirmed">
      <h4>Локально подтверждённые файлы</h4>
      <p class="muted">Кнопка «Передать медиа» выдаёт полный DEK выбранного
        файла. Если это оригинал, получатель увидит его БЕЗ масок.
        Для закрытой копии используйте отдельное действие Safe ниже.</p>
      <div v-for="media in localMedia.filter(x=>x.state==='synced')"
        :key="media.key" class="photo-row">
        <code>{{ media.mediaType }} · {{ media.mediaId.slice(0,8) }}</code>
        <button type="button" :disabled="busy"
          @click="send(media.mediaId)">Передать медиа</button>
      </div>
    </template>
    <template v-if="safeCandidates.length||recipientPeer?.confirmed">
      <h4>Кандидаты Safe — только отдельные JPEG-копии</h4>
      <p class="muted">Этот раздел доступен только для лично подготовленных
        закрытых копий после подтверждения синхронизации обоих файлов.
        Safe-грант связан с оригиналом, но никогда не выдаёт его DEK.
        Проверьте содержание копии самостоятельно перед отправкой.
        Существующие разрешения на оригинал не отзываются.</p>
      <p v-if="!safeCandidates.length" class="muted"
        data-testid="media-safe-empty">Подтверждённых Safe-кандидатов пока нет.</p>
      <div v-for="candidate in safeCandidates" :key="candidate.key"
        class="photo-row" data-testid="media-safe-candidate">
        <div>
          <small>Личная обработанная копия {{ candidate.safeMediaId.slice(0,8) }}</small>
          <small>Источник {{ candidate.sourceMediaId.slice(0,8) }}</small>
        </div>
        <button type="button" :disabled="busy||!recipientPeer?.confirmed"
          data-testid="media-send-safe-derivative"
          @click="sendSafe(candidate)">Передать только Safe-копию</button>
        <button type="button" :disabled="busy"
          data-testid="media-open-preview-draft"
          @click="openPreviewDraft(candidate)">Настроить будущую карточку</button>
        <button type="button" :disabled="busy"
          data-testid="media-open-editorial-binding"
          @click="openEditorial(candidate)">Связать с моим заданием</button>
      </div>
    </template>
    <section v-if="previewCandidate" class="file-preview-settings"
      data-testid="media-file-preview-settings">
      <strong>Черновик Public Card · публикация выключена</strong>
      <p class="muted">Настройки видимости — только верхний предел
        для возможной будущей публикации, не права доступа.
        Привязаны к зашифрованной Safe-копии
        {{ previewCandidate.safeMediaId.slice(0,8) }},
        а не к оригиналу. Никакого публичного URL, DEK или скачивания
        этот раздел не создаёт. Настройки задания и получателя
        должны дополнительно ограничивать видимость.</p>
      <p class="muted">Подписанная ревизия: {{ previewRevision }} ·
        {{ previewStatus }}</p>
      <div class="file-preview-field-list">
        <label v-for="field in PREVIEW_FIELD_KEYS" :key="field">
          <input type="checkbox" :checked="previewFields[field]"
            :disabled="busy" :data-testid="'media-preview-field-'+field"
            @change="togglePreviewField(field,$event)">
          {{ previewLabels[field] }}
        </label>
      </div>
      <p class="muted">Просмотр, копирование, скачивание и публикация:
        <strong>запрещены</strong>. Включение полей не делает их доступными
        другим аккаунтам и не отправляет приватные метаданные.</p>
      <button type="button" :disabled="busy||previewStatus==='queued'
        ||previewStatus==='retry'||previewStatus==='conflict'"
        data-testid="media-save-preview-draft"
        @click="savePreviewDraft">Сохранить подписанный черновик</button>
      <button type="button" :disabled="busy"
        @click="previewCandidate=null">Закрыть настройки</button>
    </section>
    <section v-if="editorialCandidate" class="file-preview-settings"
      data-testid="media-editorial-assignment">
      <strong>Редакционная привязка к вашему заданию</strong>
      <p class="muted">Это только ваше собственное фото и его отдельная Safe-копия.
        Привязка подписывается ключом вашего аккаунта и проверяется сервером.
        Она НЕ подтверждает выполнение задания другим участником,
        НЕ создаёт Public Card и НЕ передаёт оригинал или ключи.</p>
      <label for="safe-editorial-assignment">Моё задание</label>
      <select id="safe-editorial-assignment" v-model="editorialSelection"
        data-testid="media-editorial-select"
        :disabled="busy||!!editorialBinding||editorialState==='queued'
          ||editorialState==='retry'||editorialState==='conflict'">
        <option value="">Выберите своё задание</option>
        <option v-for="item in editorialAssignments"
          :key="item.assignmentId" :value="item.assignmentId">
          {{ item.assignmentId.slice(0,8) }}
        </option>
      </select>
      <p class="muted">Состояние: {{ editorialState }} ·
        публичный просмотр/копирование/скачивание/передача выключены</p>
      <template v-if="editorialBinding">
        <p data-testid="media-editorial-linked">Сервер подтвердил подпись:
          {{ editorialBinding.linkId.slice(0,8) }} ·
          задание {{ editorialBinding.assignmentId.slice(0,8) }}</p>
        <p class="muted">Математическое пересечение закрытых черновиков:
          {{ Object.entries(editorialBinding.candidateFields)
            .filter(([,enabled])=>enabled).map(([name])=>name).join(', ')||'нет полей' }}.
          Все эффективные публичные права по-прежнему выключены.</p>
        <button type="button" :disabled="busy" data-testid="media-editorial-detach"
          @click="detachEditorial">Отвязать (подписанный отзыв)</button>
      </template>
      <button v-else type="button" :disabled="busy||!editorialSelection
        ||editorialState==='queued'||editorialState==='retry'
        ||editorialState==='conflict'"
        data-testid="media-editorial-bind" @click="bindEditorial">
        Подписать редакционную привязку</button>
      <button type="button" :disabled="busy"
        @click="editorialCandidate=null">Закрыть</button>
    </section>
    <h4>Исходящие разрешения медиа</h4>
    <div v-for="grant in outgoing" :key="grant.id" class="photo-row">
      <div>
        <code>{{ grant.id.slice(0,8) }} · {{ grant.state }}</code>
        <small>{{ grantScopeLabel(grant) }}</small>
        <small>{{ grant.recipientAccountId.slice(0,8) }}</small>
      </div>
      <button v-if="grant.state==='sent'" type="button"
        :disabled="busy" @click="revoke(grant.id)">Отозвать медиа</button>
    </div>
    <h4>Полученные файлы</h4>
    <button type="button" :disabled="busy"
      @click="refresh">Обновить медиа-разрешения</button>
    <p v-if="!incoming.length" class="muted">Нет доступных файлов.</p>
    <div v-for="grant in incoming" :key="grant.grantId" class="photo-row">
      <div>
        <code>{{ grant.mediaType }} · {{ grant.mediaId.slice(0,8) }}</code>
        <small v-if="grant.scope==='safe_read'">
          Адресная закрытая JPEG-копия; оригинал не передан
        </small>
        <small>От: {{ grant.ownerAccountId.slice(0,8) }} · до
          {{ new Date(grant.expiresAt).toLocaleString('ru-RU') }}</small>
      </div>
      <button type="button" :disabled="busy"
        @click="checkOwner(grant.ownerAccountId)">Проверить отправителя медиа</button>
      <button type="button" :disabled="busy||ownerPeer?.id!==grant.ownerAccountId||!ownerPeer.confirmed"
        @click="openReceived(grant)">Открыть полученное медиа</button>
    </div>
    <div v-if="ownerPeer" class="fingerprint-panel">
      <strong>Отпечаток отправителя медиа</strong>
      <code data-testid="media-owner-fingerprint">{{ ownerPeer.fingerprint }}</code>
      <template v-if="!ownerPeer.confirmed">
        <p class="muted">Сверьте отпечаток отправителя через независимый канал.</p>
        <label><input v-model="acknowledgedOwner" type="checkbox">
          Я сверил отпечаток отправителя медиа</label>
        <button type="button" :disabled="busy||!acknowledgedOwner"
          @click="acceptOwner">Подтвердить отправителя медиа</button>
      </template>
    </div>
    <p v-if="status" role="status" class="status-text">{{ status }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
    <p class="muted">После отзыва сервер блокирует новые выдачи блоков. Уже скачанную получателем копию отозвать невозможно.</p>
  </section>
</template>

<style scoped>
.media-share-panel{margin-top:16px}
.media-share-panel input[type='text']{display:block;max-width:100%;margin:6px 0}
.file-preview-settings{padding:12px;border:1px solid var(--line,#555);
  border-radius:10px;margin:12px 0}
.file-preview-field-list{display:grid;grid-template-columns:
  repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:12px 0}
.file-preview-field-list label{display:flex;gap:8px;align-items:center}
.file-preview-field-list input{width:18px;height:18px}
.file-preview-settings select{max-width:100%;min-height:36px}
.file-preview-settings button{margin:4px}
</style>
