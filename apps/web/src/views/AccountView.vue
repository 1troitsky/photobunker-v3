<script setup lang="ts">
import { ref } from 'vue'
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
