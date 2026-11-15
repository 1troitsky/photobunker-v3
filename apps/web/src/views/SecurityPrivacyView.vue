<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeSession, logout, reauthenticate } from '../features/identity/application/session'
import { jsonApi } from '../features/identity/infrastructure/api'
const busy=ref(false),status=ref(''),error=ref('')
const inactive=ref('off')
const device=ref('')
type TrustedDevice={id:string;created_at:string;revoked_at:string|null}
const devices=ref<TrustedDevice[]>([])
const deviceLoading=ref(false),deviceError=ref('')
let deviceRequest=0
async function loadDevices():Promise<void>{
  const session=activeSession.value,request=++deviceRequest
  devices.value=[];deviceError.value=''
  if(!session||!session.online)return
  deviceLoading.value=true
  try{
    const result=await jsonApi<unknown>('/identity/v2/devices')
    if(!result||typeof result!=='object'||!Array.isArray((result as {devices?:unknown}).devices))
      throw Error('identity.devices_invalid')
    const rows=(result as {devices:unknown[]}).devices.map(row=>{
      if(!row||typeof row!=='object')throw Error('identity.devices_invalid')
      const item=row as TrustedDevice
      if(typeof item.id!=='string'||typeof item.created_at!=='string'
        ||(item.revoked_at!==null&&typeof item.revoked_at!=='string'))
        throw Error('identity.devices_invalid')
      return item
    })
    if(request===deviceRequest&&activeSession.value?.accountId===session.accountId
      &&activeSession.value?.deviceId===session.deviceId)devices.value=rows
  }catch(e){if(request===deviceRequest)deviceError.value=e instanceof Error?e.message:'Ошибка чтения устройств'}
  finally{if(request===deviceRequest)deviceLoading.value=false}
}
watch(activeSession, session=>{device.value=session?.deviceId||'';status.value='';error.value='';void loadDevices()}, {immediate:true})
async function verify():Promise<void>{
  if(busy.value||!activeSession.value)return
  busy.value=true;status.value='';error.value=''
  try{await reauthenticate();status.value='Сессия проверена сервером.';await loadDevices()}
  catch(e){error.value=e instanceof Error?e.message:'Не удалось подтвердить сессию'}
  finally{busy.value=false}
}
async function signOut():Promise<void>{
  if(busy.value||!activeSession.value)return
  busy.value=true;status.value='';error.value=''
  try{await logout();status.value='Выполнен выход на этом устройстве.'}
  catch(e){error.value=e instanceof Error?e.message:'Ошибка выхода'}
  finally{busy.value=false}
}
async function copyDevice():Promise<void>{
  try{await navigator.clipboard.writeText(device.value);status.value='ID скопирован'}
  catch{error.value='Буфер обмена недоступен'}
}
</script>
<template>
<section class="security-page" data-testid="security-privacy-page">
  <RouterLink class="back" to="/settings">‹ Настройки</RouterLink>
  <h1>Безопасность и приватность</h1>
  <p v-if="!activeSession">Аккаунт закрыт. <RouterLink to="/settings">Создать или восстановить</RouterLink></p>
  <template v-else>
    <p class="note">В этом разделе выполняются только подтверждённые операции. Неподключённые функции защиты не могут быть включены одной кнопкой.</p>
    <article class="panel">
      <h2>PIN входа</h2>
      <p>PIN: не установлен</p>
      <label>Через какое время запрашивать PIN<input type="range" min="0" max="5" value="0" disabled></label>
      <p class="note">Установка PIN станет доступна после приёмки защищённого PIN Shell. Сейчас устройство открывается через Key-Only Identity.</p>
      <button type="button" disabled>Установить PIN</button>
    </article>
    <article class="panel">
      <h2>PIN экстренного удаления</h2>
      <p class="warning">Экстренное удаление должно отзывать доступ и очищать данные по подтверждённой политике. Нельзя имитировать эту операцию.</p>
      <button type="button" disabled>Настроить экстренный PIN</button>
    </article>
    <article class="panel">
      <h2>Другие устройства</h2>
      <p>Текущее устройство: <code>{{ device }}</code></p>
      <div class="actions"><button type="button" @click="copyDevice">Скопировать ID</button><button type="button" :disabled="busy||!activeSession.online" @click="verify">Проверить сессию</button></div>
      <div class="actions"><button type="button" :disabled="deviceLoading||!activeSession.online" @click="loadDevices">Обновить устройства</button></div>
      <p v-if="deviceLoading" role="status">Загрузка списка с сервера…</p>
      <p v-if="deviceError" role="alert" class="warning">{{ deviceError }}</p>
      <ul v-if="devices.length" class="device-list" data-testid="account-devices">
        <li v-for="entry in devices" :key="entry.id">
          <code>{{ entry.id }}</code>
          <span>{{ entry.id===device?'Это устройство':entry.revoked_at?'Отозвано':'Другое устройство' }}</span>
          <small>Создано: {{ entry.created_at }}</small>
        </li>
      </ul>
      <p class="note">Удалённое отключение других устройств ещё не включено — оно требует подтверждённой серверной процедуры отзыва ключей и сессий.</p>
      <button type="button" disabled>Управление другими устройствами</button>
    </article>
    <article class="panel">
      <h2>Recovery Key</h2>
      <p>Ключ входа в аккаунт и восстановления доступа.</p>
      <p class="note">Recovery Key намеренно не сохраняется в открытом виде на устройстве. Для восстановления понадобится сохранённый тобой ключ.</p>
      <button type="button" disabled>Показать Recovery Key</button>
      <p class="note">Копии и Recovery Vault: <RouterLink to="/settings/storage">Данные и хранилище</RouterLink></p>
      <button type="button" disabled>Сменить Recovery Key</button>
    </article>
    <article class="panel">
      <h2>Автоматическое удаление аккаунта при длительной неактивности</h2>
      <label>Dead Man’s Switch<select v-model="inactive" disabled>
        <option value="off">Выключено</option><option value="4">4 месяца</option>
        <option value="6">6 месяцев</option><option value="12">12 месяцев</option>
        <option value="24">24 месяца</option>
      </select></label>
      <p class="note">Этот параметр не может быть сохранён, пока нет серверного договора удаления и проверенного безопасного исполнения. TTL файлов действует независимо.</p>
    </article>
    <article class="panel">
      <h2>Доступ на этом устройстве</h2>
      <button type="button" :disabled="busy" @click="signOut">Выйти</button>
      <p class="note">Выход закрывает местную сессию. Это не удаляет аккаунт и не отзывает все выданные ключи.</p>
    </article>
  </template>
  <p v-if="status" role="status">{{ status }}</p><p v-if="error" role="alert" class="warning">{{ error }}</p>
</section>
</template>
<style scoped>
.security-page{max-width:770px;padding:28px 16px 100px;margin:auto;color:#f3f3f3}
.back{font-size:13px;color:#b5e4c1;text-decoration:none}.security-page h1{font-size:25px;margin:25px 0}
.panel{padding:19px;margin:12px 0;border:1px solid #343b35;border-radius:11px;background:#202320}
.panel h2{font-size:17px;margin:0 0 13px}.panel p{font-size:13px;line-height:1.7}
.note{color:#a6b2a9;font-size:12px!important;line-height:1.7}
.warning{color:#f0b6a7;font-size:12px}
.panel code{overflow-wrap:anywhere;font-size:11px;color:#c4d4c9}
.panel button{padding:10px 13px;border-radius:8px;border:1px solid #506a56;background:#283c2e;color:#e1f0e3;cursor:pointer}
.panel button:disabled{opacity:.48;cursor:not-allowed}
.panel label{display:grid;gap:10px;font-size:13px}
.panel select,.panel input{accent-color:#6fca83;max-width:100%;padding:8px;background:#262b27;color:#e4ede7;border:1px solid #48544a;border-radius:8px}
.actions{display:flex;gap:10px;flex-wrap:wrap}.device-list{list-style:none;padding:0}.device-list li{display:grid;gap:5px;padding:12px 0;border-bottom:1px solid #414941;font-size:12px}.device-list small{color:#adb5ad}.panel a{color:#aad9b9}
</style>
