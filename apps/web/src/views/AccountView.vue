<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import {brand} from '../config/brand'
import {saveRecoveryKeyWithSystemDialog} from '../ui/fieldwork/recovery-key-save'
import {getPending} from '../features/identity/infrastructure/storage'
import { markInvalidRecoveryKey } from '../features/identity/application/authorization-failure'
import SettingsHub from '../ui/fieldwork/SettingsHub.vue'
import GraceStatusPanel from '../features/billing/ui/GraceStatusPanel.vue'
import {
  activeSession, beginRegistration, finishRegistration, logout,
  restoreAccount, reauthenticate,
} from '../features/identity/application/session'

const router=useRouter()
const generatedKey=ref('')
const inputKey=ref('')
const acknowledged=ref(false)
const busy=ref(false)
const keyExportBusy=ref(false)
const pendingRegistration=ref(false)
const pendingChecking=ref(true)
const savedPendingKey=ref('')
let pendingCheckToken=0
const status=ref('')
const error=ref('')

// An interrupted key-only registration has a durable, NON-secret pending
// reservation in IndexedDB. Do not generate another key or pretend this is
// an existing registered account: resume with the user's SAVED Recovery Key.
async function checkPendingRegistration():Promise<void>{
  const token=++pendingCheckToken
  pendingChecking.value=true
  try{
    const pending=await getPending()
    if(token!==pendingCheckToken)return
    pendingRegistration.value=!!pending
  }catch{
    if(token===pendingCheckToken)
      error.value='Не удалось проверить незавершённую регистрацию на устройстве.'
  }finally{
    if(token===pendingCheckToken)pendingChecking.value=false
  }
}
function hasUnfinishedVisibleKey():boolean{
  return !!generatedKey.value&&!activeSession.value
}
function beforeHardExit(event:BeforeUnloadEvent):void{
  if(!hasUnfinishedVisibleKey())return
  event.preventDefault()
  event.returnValue=''
}
onMounted(()=>{
  void checkPendingRegistration()
  window.addEventListener('beforeunload',beforeHardExit)
})
onUnmounted(()=>{
  ++pendingCheckToken
  window.removeEventListener('beforeunload',beforeHardExit)
  generatedKey.value=''
  savedPendingKey.value=''
  inputKey.value=''
})
onBeforeRouteLeave(()=>{
  if(!hasUnfinishedVisibleKey())return true
  return window.confirm(
    'Регистрация ещё не завершена. Recovery Key исчезнет с этого экрана. '+
    'Если ключ сохранён отдельно, вы сможете продолжить регистрацию позже. Выйти?'
  )
})
async function perform(action:()=>Promise<unknown>):Promise<void> {
  busy.value=true;error.value=''
  try{await action()}catch(e){error.value=e instanceof Error?e.message:'identity.unavailable'}
  finally{busy.value=false}
}
function begin():void {
  void perform(async()=>{
    generatedKey.value=await beginRegistration()
    pendingRegistration.value=true
    acknowledged.value=false
    status.value='Сохраните ключ в надёжном месте перед завершением регистрации.'
  })
}
function finish():void {
  void perform(async()=>{
    if(!acknowledged.value)throw new Error('Сначала подтвердите сохранение ключа')
    await finishRegistration(generatedKey.value)
    generatedKey.value=''
    pendingRegistration.value=false
    savedPendingKey.value=''
    status.value='Аккаунт создан; доступ подтверждён.'
  })
}
function resumeRegistration():void{
  if(busy.value||pendingChecking.value||!pendingRegistration.value
    ||!savedPendingKey.value.trim())return
  void perform(async()=>{
    await finishRegistration(savedPendingKey.value.trim())
    savedPendingKey.value=''
    pendingRegistration.value=false
    status.value='Незавершённая регистрация успешно завершена.'
  })
}
function restore():void {
  void perform(async()=>{
    try{await restoreAccount(inputKey.value.trim())}
    catch(e){
      if(markInvalidRecoveryKey(e)){
        inputKey.value=''
        await router.replace('/authorization-error')
        return
      }
      throw e
    }
    inputKey.value=''
    status.value='Доступ восстановлен на этом устройстве.'
  })
}
function reconnect():void {
  void perform(async()=>{await reauthenticate();status.value='Сессия подтверждена.'})
}
function signOut():void {
  void perform(async()=>{await logout();status.value='Доступ закрыт на этом устройстве.'})
}
async function copyKey():Promise<void> {
  if(!generatedKey.value)return
  try{
    await navigator.clipboard.writeText(generatedKey.value)
    status.value='Recovery Key скопирован. Сохраните его отдельно от устройства.'
    error.value=''
  }catch{
    error.value='Буфер обмена недоступен. Используйте системное сохранение.'
  }
}
async function saveGeneratedKey():Promise<void>{
  if(!generatedKey.value||keyExportBusy.value||busy.value)return
  keyExportBusy.value=true
  const key=generatedKey.value
  status.value='';error.value=''
  try{
    const result=await saveRecoveryKeyWithSystemDialog(key,brand.slug)
    if(key!==generatedKey.value)return
    if(result==='saved')
      status.value='Файл Recovery Key сохранён в выбранном месте. Проверьте его.'
    else if(result==='shared')
      status.value='Системное меню закрыто. Проверьте сохранение в «Файлы»; не передавайте ключ другим людям.'
    else if(result==='unsupported')
      error.value='Этот браузер не поддерживает выбор места. Скопируйте Recovery Key и сохраните отдельно.'
    else if(result==='failed')
      error.value='Не удалось сохранить Recovery Key. Ключ остаётся на экране.'
  }catch{
    if(key===generatedKey.value)error.value='Не удалось открыть системное сохранение Recovery Key.'
  }finally{keyExportBusy.value=false}
}
</script>

<template>
  <section class="foundation-content">
    <SettingsHub v-if="activeSession" :online="activeSession.online" />
    <h1 v-if="!activeSession">Настройки / Доступ</h1>
    <RouterLink v-if="!activeSession" to="/welcome" class="account-welcome-link">← Welcome {{brand.name}}</RouterLink>
    <h2 v-else id="identity-access" class="identity-access-title">Доступ и устройство</h2>
    <p class="subtitle">Доступ к устройству через ключ восстановления</p>
    <div v-if="activeSession" class="foundation-card">
      <p><strong>Аккаунт:</strong> <code>{{ activeSession.accountId }}</code></p>
      <p><strong>Устройство:</strong> <code>{{ activeSession.deviceId }}</code></p>
      <p><strong>Состояние:</strong> {{ activeSession.online ? 'Подтверждённая сессия' : 'Локальный режим; сервер недоступен' }}</p>
      <div class="action-row">
        <button type="button" :disabled="busy" @click="reconnect">Проверить сессию</button>
        <button type="button" :disabled="busy" @click="signOut">Выйти</button>
      </div>
    </div>
    <template v-else>
      <div class="foundation-card">
        <h2>Создать анонимный аккаунт</h2>
        <p class="muted">Без email, телефона и пароля. Ключ восстановления не хранится на сервере.</p>
        <button type="button" :disabled="busy||pendingChecking||pendingRegistration||!!generatedKey"
          @click="begin">Создать ключ</button>
        <p v-if="pendingChecking" role="status" class="muted">Проверяем незавершённую регистрацию на устройстве…</p>
        <div v-if="pendingRegistration&&!generatedKey" class="key-area"
          data-testid="account-pending-registration">
          <p>Регистрация на этом устройстве не завершена. Введите ранее сохранённый Recovery Key, чтобы продолжить. Новый ключ создавать нельзя, пока есть незавершённая регистрация.</p>
          <label for="pending-registration-key">Сохранённый Recovery Key</label>
          <textarea id="pending-registration-key" v-model="savedPendingKey" rows="3"
            autocomplete="off" autocorrect="off" spellcheck="false"/>
          <button type="button" data-testid="account-resume-registration"
            :disabled="busy||!savedPendingKey.trim()" @click="resumeRegistration">
            Завершить незавершённую регистрацию
          </button>
        </div>
        <div v-if="generatedKey" class="key-area">
          <label for="generated-key">Account Recovery Key — сохраните вне устройства</label>
          <textarea id="generated-key" :value="generatedKey" readonly spellcheck="false" rows="3"/>
          <button type="button" @click="copyKey">Скопировать</button>
          <button type="button" data-testid="account-save-key"
            :disabled="keyExportBusy||busy"
            @click="saveGeneratedKey">Сохранить на устройство</button>
          <label class="checkline"><input v-model="acknowledged" type="checkbox"> Я сохранил ключ восстановления</label>
          <button type="button" :disabled="busy||!acknowledged" @click="finish">Завершить регистрацию</button>
        </div>
      </div>
      <div class="foundation-card">
        <h2>Восстановить аккаунт</h2>
        <label for="recovery-key">Account Recovery Key</label>
        <textarea id="recovery-key" v-model="inputKey" rows="3" spellcheck="false"
          autocomplete="off" autocorrect="off" placeholder="Введите сохранённый ключ"/>
        <button type="button" :disabled="busy||!inputKey" @click="restore">Восстановить</button>
      </div>
    </template>
    <GraceStatusPanel v-if="activeSession" :session="activeSession" />
    <p v-if="status" role="status" class="status-text">{{ status }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
    <p class="muted">Профиль хранится локально в зашифрованном виде. PIN настраивается в разделе «Безопасность и приватность». Экстренное удаление пока недоступно.</p>
  </section>
</template>

<style scoped>
.account-welcome-link{display:inline-block;margin:12px 0;color:#b6e8c4;font-size:12px;text-decoration:none}
.identity-access-title {
  margin: 28px 0 0;
  font-size: 18px;
  font-weight: 750;
  letter-spacing: -.02em;
  scroll-margin-top: 15px;
}
</style>
