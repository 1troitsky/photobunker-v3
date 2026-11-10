<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue'
import {activeSession} from '../features/identity/application/session'
import {
  listConfirmedContacts,
} from '../features/people/application/contact-book'
import type {ConfirmedContact} from '../features/people/application/contact-book'
import {
  getMessageDraft,listMessageDrafts,saveMessageDraft,
  MAX_MESSAGE_DRAFT_LENGTH,
} from '../features/messages/application/message-drafts'
import type {MessageDraft} from '../features/messages/application/message-drafts'

type Filter='all'|'unread'|'teams'
const filter=ref<Filter>('all')
const searchOpen=ref(false)
const search=ref('')
const pickerOpen=ref(false)
const contacts=ref<ConfirmedContact[]>([])
const drafts=ref<MessageDraft[]>([])
const loading=ref(false)
const error=ref('')
const status=ref('')
const threadOpen=ref(false)
const selected=ref<ConfirmedContact|null>(null)
const editor=ref('')
const editorRef=ref<HTMLTextAreaElement|null>(null)
const threadRef=ref<HTMLElement|null>(null)
const pickerRef=ref<HTMLElement|null>(null)
const draftSaving=ref(false)
let run=0
let saveTimer:ReturnType<typeof setTimeout>|null=null
let returnFocus:HTMLElement|null=null

function identity():string{
  const s=activeSession.value
  return s?[
    s.accountId,s.deviceId,s.pkg.akek,s.pkg.accountSpki,s.pkg.revision,
  ].join('|'):''
}
function matches(owner:string,token:number):boolean{
  return owner===identity()&&run===token
}
const draftRows=computed(()=>{
  const query=search.value.trim().toLocaleLowerCase()
  if(filter.value!=='all')return []
  return drafts.value.flatMap(d=>{
    const c=contacts.value.find(x=>x.peerAccountId===d.peerAccountId
      &&x.safetyFingerprint===d.peerFingerprint)
    if(!c)return []
    const title=c.alias||c.peerAccountId
    if(query&&!title.toLocaleLowerCase().includes(query)
      &&!d.body.toLocaleLowerCase().includes(query))return []
    return [{draft:d,contact:c,title}]
  })
})
const contactPickerRows=computed(()=>{
  const query=search.value.trim().toLocaleLowerCase()
  return contacts.value.filter(x=>!query
    ||x.alias.toLocaleLowerCase().includes(query)
    ||x.peerAccountId.includes(query))
})
function message(errorValue:unknown):string{
  return errorValue instanceof Error?errorValue.message:'messages.unavailable'
}
async function reload():Promise<void>{
  const owner=identity(),token=++run
  drafts.value=[];contacts.value=[];error.value=''
  if(!owner)return
  loading.value=true
  try{
    const [peers,localDrafts]=await Promise.all([
      listConfirmedContacts(),listMessageDrafts(),
    ])
    if(!matches(owner,token))return
    contacts.value=peers
    drafts.value=localDrafts
  }catch(e){if(matches(owner,token))error.value=message(e)}
  finally{if(matches(owner,token))loading.value=false}
}
async function open(contact:ConfirmedContact):Promise<void>{
  if(!activeSession.value||threadOpen.value)return
  const owner=identity(),token=run
  error.value='';status.value=''
  returnFocus=document.activeElement instanceof HTMLElement
    ?document.activeElement:null
  try{
    const body=await getMessageDraft(contact)
    if(!matches(owner,token))return
    selected.value=contact;editor.value=body
    pickerOpen.value=false;threadOpen.value=true
    await nextTick()
    editorRef.value?.focus()
  }catch(e){if(matches(owner,token))error.value=message(e)}
}
function rememberInput():void{
  if(saveTimer!==null)clearTimeout(saveTimer)
  const peer=selected.value,owner=identity(),token=run
  if(!peer||!owner)return
  const body=editor.value
  saveTimer=setTimeout(()=>{
    saveTimer=null
    void persist(peer,body,owner,token)
  },350)
}
async function persist(
  peer:ConfirmedContact,body:string,owner:string,token:number,
):Promise<void>{
  if(!matches(owner,token))return
  draftSaving.value=true
  try{
    await saveMessageDraft(peer,body)
    if(!matches(owner,token))return
    if(editor.value!==body)return
    if(!body.trim()){
      drafts.value=drafts.value.filter(x=>x.peerAccountId!==peer.peerAccountId)
    }else{
      drafts.value=[
        {version:1,peerAccountId:peer.peerAccountId,
          peerFingerprint:peer.safetyFingerprint,body,updatedAt:Date.now()},
        ...drafts.value.filter(x=>x.peerAccountId!==peer.peerAccountId),
      ]
    }
    status.value='Черновик зашифрован на этом устройстве'
  }catch(e){if(matches(owner,token))error.value=message(e)}
  finally{if(matches(owner,token))draftSaving.value=false}
}
async function close():Promise<void>{
  if(!threadOpen.value)return
  if(saveTimer!==null){clearTimeout(saveTimer);saveTimer=null}
  const owner=identity(),token=run,peer=selected.value
  if(peer)await persist(peer,editor.value,owner,token)
  if(!matches(owner,token))return
  threadOpen.value=false
  selected.value=null;editor.value=''
  await nextTick()
  // Picker rows leave the tree when a draft is opened. Restore focus to
  // the original control if it survives, otherwise use the draft row or
  // New Message action (not the document body or a hidden Dock element).
  const fallback=document.querySelector<HTMLElement>(
    '[data-testid="messages-draft-'+peer?.peerAccountId+'"]',
  )??document.querySelector<HTMLElement>('[data-testid="messages-compose"]')
  if(returnFocus&&document.contains(returnFocus))returnFocus.focus()
  else fallback?.focus()
  returnFocus=null
}
function dismissWithoutSave():void{
  if(saveTimer!==null){clearTimeout(saveTimer);saveTimer=null}
  threadOpen.value=false
  selected.value=null;editor.value=''
  pickerOpen.value=false;returnFocus=null
  status.value='';draftSaving.value=false
}
function keyboard(event:KeyboardEvent):void{
  if(!threadOpen.value)return
  if(event.key==='Escape'){
    event.preventDefault()
    void close()
  }
  if(event.key!=='Tab')return
  const dialog=threadRef.value
  if(!dialog)return
  const items=Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
  )).filter(x=>x.getClientRects().length>0)
  if(items.length===0)return
  const first=items[0]!,last=items[items.length-1]!
  if(event.shiftKey&&(document.activeElement===first
    ||!dialog.contains(document.activeElement))){
    event.preventDefault();last.focus()
  }else if(!event.shiftKey&&(document.activeElement===last
    ||!dialog.contains(document.activeElement))){
    event.preventDefault();first.focus()
  }
}
function newConversation():void{
  if(!activeSession.value)return
  pickerOpen.value=!pickerOpen.value
  if(pickerOpen.value){
    filter.value='all';searchOpen.value=true
    void nextTick(()=>pickerRef.value?.focus())
  }
}
watch(activeSession,(current,old)=>{
  const prev=old?[
    old.accountId,old.deviceId,old.pkg.akek,old.pkg.accountSpki,old.pkg.revision,
  ].join('|'):''
  if(identity()!==prev){
    ++run
    dismissWithoutSave()
    void reload()
  }
})
onMounted(()=>{void reload();window.addEventListener('keydown',keyboard)})
onUnmounted(()=>{
  // An unmounted component never retains decrypted text. The most recent
  // input is committed without network; key/account mismatch fails closed.
  if(saveTimer!==null&&selected.value){
    clearTimeout(saveTimer)
    void saveMessageDraft(selected.value,editor.value).catch(()=>{})
  }
  ++run;dismissWithoutSave();contacts.value=[];drafts.value=[]
  window.removeEventListener('keydown',keyboard)
})
</script>

<template>
  <section class="messages-page" data-testid="messages-page">
    <div class="messages-heading">
      <div class="messages-title">
        <h1>Сообщения</h1>
        <span class="messages-count" aria-label="Непрочитанные">0</span>
      </div>
      <div class="messages-tools">
        <button type="button" aria-label="Поиск" title="Поиск"
          @click="searchOpen=!searchOpen;pickerOpen=false">Поиск</button>
        <button type="button" aria-label="Новое сообщение"
          data-testid="messages-compose"
          :disabled="!activeSession" @click="newConversation">Написать</button>
      </div>
    </div>
    <nav class="messages-tabs" aria-label="Фильтр диалогов">
      <button v-for="item in (['all','unread','teams'] as const)" :key="item"
        type="button" :class="{selected:filter===item}"
        :aria-pressed="filter===item" @click="filter=item;pickerOpen=false">
        {{ item==='all'?'Все':item==='unread'?'Непрочитанные':'Команды' }}
      </button>
    </nav>
    <label v-if="searchOpen" class="messages-search">
      <span class="messages-sr-only">Поиск диалога или контакта</span>
      <input v-model="search" type="search" autocomplete="off"
        placeholder="Контакт или черновик" data-testid="messages-search">
    </label>
    <p class="messages-notice" role="status">
      Matrix пока не подключён. Здесь сохраняются только зашифрованные черновики.
      Отправка сообщений и статусы доставки недоступны.
    </p>
    <p v-if="error" class="messages-error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="messages-muted" role="status">Чтение защищённых данных…</p>
    <p v-if="!activeSession" class="messages-empty">
      Для доступа к личным черновикам откройте аккаунт в настройках.
    </p>

    <div v-else-if="pickerOpen" class="messages-picker"
      ref="pickerRef" tabindex="-1" data-testid="messages-contact-picker">
      <div class="messages-section-title">
        <strong>Выберите подтверждённый контакт</strong>
        <button type="button" aria-label="Закрыть выбор"
          @click="pickerOpen=false">Закрыть</button>
      </div>
      <p v-if="contactPickerRows.length===0" class="messages-empty">
        Подтверждённых контактов нет. Сначала добавьте контакт
        в разделе «Контакты и Команды».
      </p>
      <button v-for="c in contactPickerRows" :key="c.peerAccountId"
        type="button" class="messages-row"
        :data-testid="'messages-picker-'+c.peerAccountId" @click="open(c)">
        <span class="messages-avatar" aria-hidden="true">{{ (c.alias||c.peerAccountId).slice(0,1).toUpperCase() }}</span>
        <span class="messages-row-text">
          <strong>{{ c.alias||c.peerAccountId }}</strong>
          <small>Подтверждённый локальный контакт</small>
        </span>
      </button>
    </div>
    <div v-else class="messages-list" data-testid="messages-draft-list">
      <button v-for="row in draftRows" :key="row.contact.peerAccountId"
        type="button" class="messages-row"
        :data-testid="'messages-draft-'+row.contact.peerAccountId"
        @click="open(row.contact)">
        <span class="messages-avatar" aria-hidden="true">{{ row.title.slice(0,1).toUpperCase() }}</span>
        <span class="messages-row-text">
          <strong>{{ row.title }}</strong>
          <small class="messages-preview">Черновик: {{ row.draft.body }}</small>
        </span>
        <span class="messages-draft-marker">Черновик</span>
      </button>
      <p v-if="draftRows.length===0" class="messages-empty">
        {{ filter==='unread'?'Непрочитанные появятся после подключения Matrix.'
          :filter==='teams'?'Командные комнаты появятся после подключения Matrix.'
          :'Пока нет диалогов. Создайте черновик для подтверждённого контакта.' }}
      </p>
    </div>

    <Teleport to="body">
      <Transition name="messages-overlay">
        <section v-if="threadOpen&&selected" ref="threadRef"
          class="messages-thread" role="dialog" aria-modal="true"
          :aria-label="'Переписка с '+(selected.alias||selected.peerAccountId)"
          data-testid="messages-thread">
          <header class="messages-thread-top">
            <button type="button" aria-label="Назад к сообщениям"
              data-testid="messages-close" @click="close">←</button>
            <div class="messages-thread-identity">
              <strong>{{ selected.alias||selected.peerAccountId }}</strong>
              <small>Матрица шифрования ещё не подключена</small>
            </div>
            <button type="button" disabled aria-label="Действия переписки"
              title="Доступно после подтверждённого E2EE-сеанса">⋯</button>
          </header>
          <div class="messages-thread-content" data-testid="messages-thread-body">
            <div class="messages-thread-placeholder">
              <strong>Безопасная переписка</strong>
              <p>История Matrix появится после защищённой привязки устройства
                и проверки ключей собеседника.</p>
              <p>Ваш текст ниже сохраняется только как зашифрованный локальный черновик.
                Он не отправляется собеседнику.</p>
            </div>
          </div>
          <div class="messages-composer">
            <label class="messages-sr-only" for="messages-input">Черновик сообщения</label>
            <div class="messages-compose-line">
              <button type="button" disabled aria-label="Добавить вложение"
                title="Будет доступно после Matrix E2EE">+</button>
              <textarea id="messages-input" ref="editorRef" v-model="editor"
                rows="2" :maxlength="MAX_MESSAGE_DRAFT_LENGTH"
                placeholder="Зашифрованный черновик…"
                autocomplete="off" autocorrect="off" spellcheck="false"
                data-testid="messages-editor" @input="rememberInput"
                @blur="rememberInput"/>
              <button type="button" disabled aria-label="Отправить сообщение"
                title="Matrix E2EE ещё не подключён">Отправить</button>
            </div>
            <small>{{ draftSaving?'Сохранение…':'Текст хранится только на этом устройстве' }}</small>
            <p v-if="error" role="alert" class="messages-error">{{ error }}</p>
            <p v-if="status" role="status" class="messages-saved">{{ status }}</p>
          </div>
        </section>
      </Transition>
    </Teleport>
  </section>
</template>
