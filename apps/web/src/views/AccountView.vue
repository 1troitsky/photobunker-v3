<script setup lang="ts">
import { ref,watch } from 'vue'
import {
  listPB3Devices,revokePB3Device,
} from '../features/identity/application/device-revocation'
import {
  activeSession, beginRegistration, finishRegistration, logout,
  restoreAccount, reauthenticate,
} from '../features/identity/application/session'

const generatedKey=ref('')
const inputKey=ref('')
const acknowledged=ref(false)
const busy=ref(false)
const status=ref('')
const error=ref('')
const devices=ref<Awaited<ReturnType<typeof listPB3Devices>>>([])
const devicesError=ref('')
const deviceBusy=ref(false)

async function refreshDevices():Promise<void>{
  if(!activeSession.value?.online){devices.value=[];return}
  devicesError.value=''
  try{devices.value=await listPB3Devices()}
  catch(e){devicesError.value=e instanceof Error?e.message:'identity.devices_unavailable'}
}
async function disconnectDevice(id:string):Promise<void>{
  if(deviceBusy.value)return
  const self=id===activeSession.value?.deviceId
  const message=self
    ? 'Отключить это устройство от PB3? После отзыва PB3 приложение попробует отозвать Matrix-токен ЭТОГО устройства на homeserver. При ошибке сети отзыв Matrix не гарантирован.'
    : 'Отключить выбранное устройство от PB3? Его отдельный Matrix-токен на сервере этим НЕ отзывается.'
  if(!window.confirm(message))return
  deviceBusy.value=true;error.value='';status.value=''
  try{
    const result=await revokePB3Device(id)
    if(!self){
      status.value='PB3-доступ отозван. Отзыв Matrix-токена другого устройства на homeserver не выполнен.'
    }else{
      const remote=result.matrixOwnTokenLogout==='confirmed'
        ? 'Matrix-токен этого устройства отозван на homeserver и проверен повторным запросом.'
        : 'Удалённый отзыв Matrix-токена этого устройства НЕ подтверждён.'
      const local=!result.localMatrixShutdownComplete
        ||!result.localMatrixCredentialsCleared
        ? ' Локальная очистка Matrix не подтверждена.'
        : ''
      status.value='PB3-доступ отозван. '+remote+local
    }
    if(!self)await refreshDevices()
    else devices.value=[]
  }catch(e){error.value=e instanceof Error?e.message:'identity.revoke_unconfirmed'}
  finally{deviceBusy.value=false}
}
watch(activeSession,()=>{void refreshDevices()},{immediate:true})

async function perform(action:()=>Promise<unknown>):Promise<void> {
  busy.value=true;error.value=''
  try{await action()}catch(e){error.value=e instanceof Error?e.message:'identity.unavailable'}
  finally{busy.value=false}
}
function begin():void {
  void perform(async()=>{
    generatedKey.value=await beginRegistration()
    acknowledged.value=false
    status.value='Сохраните ключ в надёжном месте перед завершением регистрации.'
  })
}
function finish():void {
  void perform(async()=>{
    if(!acknowledged.value)throw new Error('Сначала подтвердите сохранение ключа')
    await finishRegistration(generatedKey.value)
    generatedKey.value=''
    status.value='Аккаунт создан; доступ подтверждён.'
  })
}
function restore():void {
  void perform(async()=>{
    await restoreAccount(inputKey.value.trim())
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
  if(generatedKey.value)await navigator.clipboard.writeText(generatedKey.value)
}
</script>

<template>
  <section class="foundation-content">
    <h1>Настройки / Доступ</h1>
    <p class="subtitle">Key-Only Identity · P1</p>
    <div class="foundation-card">
      <h2>Оформление</h2>
      <p class="muted">Настройте состав и порядок Dock. Локальные настройки шифруются ключом аккаунта.</p>
      <RouterLink to="/settings/appearance" data-testid="appearance-open">
        Настроить панель навигации
      </RouterLink>
    </div>
    <div v-if="activeSession" class="foundation-card">
      <p><strong>Аккаунт:</strong> <code>{{ activeSession.accountId }}</code></p>
      <p><strong>Устройство:</strong> <code>{{ activeSession.deviceId }}</code></p>
      <p><strong>Состояние:</strong> {{ activeSession.online ? 'Подтверждённая сессия' : 'Локальный режим; сервер недоступен' }}</p>
      <div class="action-row">
        <button type="button" :disabled="busy" @click="reconnect">Проверить сессию</button>
        <button type="button" :disabled="busy" @click="signOut">Выйти</button>
      </div>
    </div>
    <div v-if="activeSession?.online" class="foundation-card" data-testid="device-revocation">
      <h2>Устройства PB3</h2>
      <p class="muted">
        «Отключить» прекращает авторизацию устройства в PB3.
        Для этого устройства приложение дополнительно пытается отозвать
        его собственный Matrix-токен и проверяет результат на homeserver.
        Matrix-токены других устройств это НЕ отзывает. Ранее
        расшифрованные сообщения не удаляются.
      </p>
      <div v-if="devicesError" role="alert">{{ devicesError }}</div>
      <div v-for="item in devices" :key="item.id" class="action-row">
        <span>
          <code>{{ item.id }}</code>
          {{ item.id===activeSession?.deviceId ? '— это устройство' : '' }}
          {{ item.revoked_at ? '— отключено' : '' }}
        </span>
        <button v-if="!item.revoked_at" type="button"
          :disabled="deviceBusy||busy"
          :aria-label="'Отключить от PB3 устройство '+item.id"
          @click="disconnectDevice(item.id)">Отключить</button>
      </div>
      <button type="button" :disabled="deviceBusy||busy" @click="refreshDevices">
        Обновить список
      </button>
    </div>
    <template v-else>
      <div class="foundation-card">
        <h2>Создать анонимный аккаунт</h2>
        <p class="muted">Без email, телефона и пароля. Ключ восстановления не хранится на сервере.</p>
        <button type="button" :disabled="busy||!!generatedKey" @click="begin">Создать ключ</button>
        <div v-if="generatedKey" class="key-area">
          <label for="generated-key">Account Recovery Key — сохраните вне устройства</label>
          <textarea id="generated-key" :value="generatedKey" readonly spellcheck="false" rows="3"/>
          <button type="button" @click="copyKey">Скопировать</button>
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
    <p v-if="status" role="status" class="status-text">{{ status }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
    <p class="muted">PIN Shell, защищённый режим экрана и финальная страница профиля появятся на следующих этапах.</p>
  </section>
</template>
