<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { activeSession, logout, reauthenticate } from '../features/identity/application/session'
import { jsonApi } from '../features/identity/infrastructure/api'

const route = useRoute()
type TrustedDevice={id:string;created_at:string;revoked_at:string|null}
const busy=ref(false),status=ref(''),error=ref('')
const devices=ref<TrustedDevice[]>([])
const deviceLoading=ref(false),deviceError=ref('')
let request=0
const fields=['pin','relock','emergency','devices','key','inactivity'] as const
async function focusRequested():Promise<void>{
  const field=route.query.field
  if(typeof field!=='string'||!(fields as readonly string[]).includes(field))return
  await nextTick()
  const target=document.getElementById('setting-'+field)??document.getElementById('section-'+field)
  target?.scrollIntoView({block:'start'})
  if(target instanceof HTMLElement)target.focus({preventScroll:true})
}
watch(()=>route.query.field,()=>{void focusRequested()})
onMounted(()=>{void focusRequested()})
watch(activeSession,()=>{devices.value=[];error.value='';status.value='';void loadDevices()},{immediate:true})
async function loadDevices():Promise<void>{
  const session=activeSession.value,token=++request
  devices.value=[];deviceError.value=''
  // A superseded online request must not leave a permanent spinner when
  // switching accounts, signing out or going offline during its response.
  deviceLoading.value=false
  if(!session?.online)return
  deviceLoading.value=true
  try{
    const payload=await jsonApi<unknown>('/identity/v2/devices')
    if(!payload||typeof payload!=='object'||!Array.isArray((payload as {devices?:unknown}).devices))
      throw Error('identity.devices_invalid')
    const rows=(payload as {devices:unknown[]}).devices.map(item=>{
      if(!item||typeof item!=='object')throw Error('identity.devices_invalid')
      const v=item as TrustedDevice
      if(typeof v.id!=='string'||typeof v.created_at!=='string'
        ||(v.revoked_at!==null&&typeof v.revoked_at!=='string'))
        throw Error('identity.devices_invalid')
      return v
    })
    if(request===token&&activeSession.value?.accountId===session.accountId
      &&activeSession.value?.deviceId===session.deviceId)devices.value=rows
  }catch(e){if(request===token)deviceError.value=e instanceof Error?e.message:'Ошибка списка устройств'}
  finally{if(request===token)deviceLoading.value=false}
}
async function verifySession():Promise<void>{
  if(busy.value||!activeSession.value)return
  busy.value=true;status.value='';error.value=''
  try{await reauthenticate();status.value='Сессия подтверждена сервером';await loadDevices()}
  catch(e){error.value=e instanceof Error?e.message:'Ошибка проверки сессии'}
  finally{busy.value=false}
}
async function signOut():Promise<void>{
  if(busy.value||!activeSession.value)return
  busy.value=true;status.value='';error.value=''
  try{await logout();status.value='Доступ на этом устройстве закрыт'}
  catch(e){error.value=e instanceof Error?e.message:'Ошибка выхода'}
  finally{busy.value=false}
}
async function copyDeviceId(id:string):Promise<void>{
  try{await navigator.clipboard.writeText(id);status.value='ID устройства скопирован'}
  catch{error.value='Буфер обмена недоступен'}
}
</script>

<template>
<section class="security-page" data-testid="security-privacy-page">
  <RouterLink class="security-back" to="/settings">‹ Настройки</RouterLink>
  <div class="security-heading">
    <h1>Безопасность и приватность</h1>
    <p>Доступ к приложению, устройства, ключи и жизненный цикл аккаунта.</p>
  </div>
  <p v-if="!activeSession" class="security-hint">
    Для работы с настройками безопасности необходимо открыть аккаунт.
    <RouterLink to="/settings">Создать или восстановить аккаунт</RouterLink>
  </p>
  <template v-else>
    <p v-if="status" role="status" class="security-feedback">{{status}}</p>
    <p v-if="error" role="alert" class="security-feedback warning">{{error}}</p>
    <div class="security-tiles">
      <section id="section-pin" class="security-section" tabindex="-1">
        <h2>PIN входа</h2>
        <div class="security-panel">
          <div id="setting-pin" class="security-item" tabindex="-1">
            <span class="security-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>
            <div class="security-copy">
              <strong>PIN входа</strong>
              <small>Код из 4–8 цифр для разблокировки приложения.</small>
              <span class="status">Не установлен</span>
            </div>
            <button type="button" class="small-button emphasis" disabled title="Подключение PIN Shell и проверки криптографического контракта ещё не завершено">Создать</button>
          </div>
          <div id="setting-relock" class="pin-relock" tabindex="-1">
            <div class="pin-relock-top"><strong>Через какое время запрашивать PIN</strong><output>Сразу</output></div>
            <p class="pin-relock-note">Настройка станет доступна после создания PIN входа.</p>
            <input class="pin-slider" type="range" min="0" max="5" value="0" step="1" disabled aria-label="Через какое время запрашивать PIN">
            <div class="pin-slider-labels"><span>Сразу</span><span>5 мин</span></div>
          </div>
        </div>
      </section>

      <section id="section-emergency" class="security-section" tabindex="-1">
        <h2>PIN экстренного удаления данных</h2>
        <div class="security-panel">
          <div id="setting-emergency" class="security-item" tabindex="-1">
            <span class="security-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/></svg></span>
            <div class="security-copy">
              <strong>PIN экстренного удаления данных</strong>
              <span class="status">Сначала создайте PIN входа</span>
            </div>
            <button type="button" class="small-button" disabled>Создать</button>
          </div>
          <div class="emergency-detail">
            <p class="emergency-alert">При вводе экстренного PIN доступ должен немедленно блокироваться, а удаление данных из облака подтверждаться сервером.</p>
            <p class="emergency-note">Оба PIN должны иметь одинаковую длину. При смене длины обычного PIN экстренный PIN необходимо создать заново.</p>
            <p class="security-limits">Функция не активна: пока не подтверждены безопасное локальное и облачное удаление. Данные не удаляются.</p>
          </div>
        </div>
      </section>

      <section id="section-devices" class="security-section" tabindex="-1">
        <h2>Устройства и ключ</h2>
        <div id="setting-devices" class="security-panel security-devices" tabindex="-1">
          <div v-for="item in devices" :key="item.id" class="security-item" data-testid="account-device">
            <span class="security-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M10 17h4"/></svg></span>
            <div class="security-copy">
              <strong>{{ item.id===activeSession.deviceId?'Это устройство':'Устройство' }}</strong>
              <small class="device-meta">{{item.id}} · {{item.created_at}}</small>
            </div>
            <span v-if="item.id===activeSession.deviceId" class="security-device-current">Сейчас</span>
            <span v-else-if="item.revoked_at" class="security-device-revoked">Отозвано</span>
            <button v-else type="button" class="small-button" disabled title="Удалённое отключение пока не подтверждено">Отключить</button>
          </div>
          <p v-if="deviceLoading" class="security-subline" role="status">Загружаем устройства с сервера…</p>
          <p v-if="deviceError" class="security-subline warning" role="alert">{{deviceError}}</p>
          <p v-if="!devices.length&&!deviceLoading&&!deviceError" class="security-subline">
            Список устройств не подтверждён. Не показываем вымышленные данные.
          </p>
          <div class="security-actions-row">
            <button type="button" class="small-button" :disabled="deviceLoading||!activeSession.online" @click="loadDevices">Обновить устройства</button>
            <button type="button" class="small-button" :disabled="busy||!activeSession.online" @click="verifySession">Проверить сессию</button>
          </div>
        </div>
        <p class="privacy-footer">Отключение устройства должно закрывать его будущие сеансы; без сети нельзя гарантировать мгновенное удаление данных.</p>
        <div id="setting-key" class="security-panel security-devices security-key-panel" tabindex="-1">
          <div class="security-item">
            <span class="security-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="14" r="5"/><path d="M12 11l9-9M17 6l3 3"/></svg></span>
            <div class="security-copy">
              <strong>Recovery Key</strong>
              <small>Ключ входа в аккаунт и восстановления доступа.</small>
              <div class="row-actions">
                <button type="button" class="small-button" disabled title="Приложение не хранит Recovery Key в открытом виде">Показать / Скачать ключ</button>
                <button type="button" class="small-button" disabled>Сменить ключ</button>
              </div>
            </div>
          </div>
          <div class="security-subline">Храните свой Recovery Key отдельно от устройства. Он не восстанавливается из данных сервера.</div>
        </div>
        <p class="privacy-footer">Восстановление и резервные копии находятся в разделе
          <RouterLink class="security-inline-link" to="/settings/storage">«Данные и хранилище»</RouterLink>.
        </p>
      </section>

      <section id="section-inactivity" class="security-section" tabindex="-1">
        <div class="security-panel inactivity-card" id="setting-inactivity" tabindex="-1">
          <div class="inactivity-card-heading">
            <h2>Dead Man’s Switch</h2>
            <p>Автоматическое удаление аккаунта при длительной неактивности.</p>
          </div>
          <div class="inactivity-select-wrap">
            <label for="inactivity-select">Срок неактивности</label>
            <select id="inactivity-select" aria-label="Срок неактивности" disabled>
              <option value="off">Выключено</option><option value="4">Через 4 месяца</option>
              <option value="6">Через 6 месяцев</option><option value="12">Через 12 месяцев</option>
              <option value="24">Через 24 месяца</option>
            </select>
          </div>
          <p class="inactivity-card-footer">Удаление аккаунта необратимо. Настройка не продлевает срок хранения файлов. Автоматическое удаление ещё не активировано.</p>
        </div>
      </section>
    </div>
    <div class="security-actions-row">
      <button type="button" class="small-button" :disabled="busy" @click="signOut">Выйти на этом устройстве</button>
      <button type="button" class="small-button" @click="copyDeviceId(activeSession.deviceId)">Скопировать ID устройства</button>
    </div>
  </template>
</section>
</template>
<style scoped>
/* Preserved structural rules from owner-approved docs/ux/security-privacy/style.css,
   Security & Privacy 1.3 section. The app has the one shared Fieldwork Shell. */
.security-page{max-width:700px;margin:0 auto}
.security-heading{margin:1px 0 29px}
.security-heading h1{margin:0 0 8px;font-size:27px;letter-spacing:-.045em;line-height:1.12;font-weight:800}
.security-heading p{margin:0;color:#a5a5a5;font-size:12px;line-height:1.45}
.security-section{margin:0 0 24px;scroll-margin-top:14px;outline:0}
.security-section h2{margin:0 0 10px 3px;font-size:11px;font-weight:760;color:#a7a7a7;letter-spacing:.022em}
.security-panel{border-radius:11px;background:#202020;overflow:hidden}
.security-item{display:flex;align-items:center;gap:11px;min-height:76px;padding:15px;outline:0}
.security-item+.security-item{border-top:1px solid #353535}
.security-item-icon{width:28px;flex:0 0 28px;align-self:flex-start;color:#b9b9b9;padding-top:3px}
.security-item-icon svg{width:20px;height:20px}
.security-copy{min-width:0;flex:1}
.security-copy strong{display:block;font-size:13px;font-weight:670;line-height:1.3}
.security-copy small{display:block;margin-top:6px;color:#a4a4a4;line-height:1.43;font-size:11px}
.security-copy .status{display:inline-flex;color:#b4b4b4;font-size:10.5px;font-weight:650;margin-top:5px}
.security-copy .status.active{color:#90e3a6}
.security-item .small-button{align-self:center;margin-left:auto;flex:none}
.small-button{background:#373737;border:1px solid #515151;border-radius:8px;padding:9px 11px;min-height:35px;white-space:nowrap;color:#f2f2f2;font-size:11px;font-weight:670}
.small-button:hover:not(:disabled){background:#434343}
.small-button.emphasis{color:#c7f8d4;border-color:#40754d;background:#294731}
.small-button.danger{color:#ffd4cd;border-color:#6b4a48;background:#493230}
.security-subline{padding:0 16px 15px;color:#9b9b9b;font-size:11px;line-height:1.5}
.security-hint{padding:13px 15px;background:#292929;border:1px solid #383838;border-radius:9px;color:#aeaeae;font-size:11px;line-height:1.5;margin-top:9px}
.security-hint .lead{font-weight:700;color:#e0e0e0}
.security-choices{padding:12px 13px 14px;display:flex;flex-wrap:wrap;gap:8px}
.security-devices .device-meta{font-size:10px;color:#aaa;margin-top:5px}
.row-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
.section-label-note{margin:0 3px 10px;color:#959595;font-size:11px;line-height:1.5}
.privacy-choice{display:grid;gap:9px;padding:14px 15px 16px}
.privacy-choice label{font-size:11px;color:#aaa}
.privacy-choice select{width:100%;height:43px;border:1px solid #505050;border-radius:8px;padding:0 12px;color:#f0f0f0;background:#303030;appearance:auto}
.privacy-footer{margin:11px 3px 0;color:#999;font-size:11px;line-height:1.5}
.security-menu{margin-top:18px}.security-menu h1{font-size:27px;margin:0 0 22px}
.security-menu .menu-row{cursor:pointer}
.pin-sheet{max-height:80%;padding-bottom:22px}
.pin-fields{display:grid;gap:8px}
.pin-fields label{font-size:11px;color:#c5c5c5}
.pin-fields input{height:48px;padding:0 12px;border:1px solid #555;border-radius:9px;background:#2d2d2d;color:#f4f4f4;letter-spacing:.23em;font-size:21px;width:100%;font-variant-numeric:tabular-nums}
.pin-help{font-size:10.5px;color:#9f9f9f;line-height:1.5}
.pin-error{color:#ffb3ae;font-size:11px;line-height:1.45;min-height:0}
.pin-buttons{display:flex;gap:9px;margin-top:17px}
.pin-buttons .action-button{min-width:0}
.pin-buttons .action-button.negative{background:#6b3330;border-color:#86534f}
.pin-relock{border-top:1px solid #383838;padding:16px 17px 18px}
.pin-relock-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:17px}
.pin-relock-top strong{font-size:12px;font-weight:660;line-height:1.35}
.pin-relock-top output{font-size:11.5px;font-weight:680;color:#9de6b1;white-space:nowrap}
.pin-slider{width:100%;margin:0;display:block;accent-color:#1ed760;cursor:pointer;height:22px}
.pin-slider:disabled{opacity:.35;cursor:not-allowed}
.pin-slider-labels{display:flex;justify-content:space-between;gap:8px;color:#a3a3a3;font-size:10.5px;margin-top:7px}
.pin-relock-note{font-size:11px;line-height:1.45;color:#9b9b9b;margin:10px 0 0}
.emergency-detail{padding:0 16px 16px}
.emergency-alert{margin:0 0 10px;color:#f29c97;font-size:12px;font-weight:620;line-height:1.52}
.emergency-note{margin:0;color:#b0b0b0;font-size:11.5px;line-height:1.55}
.inactivity-list{display:block}
.inactivity-row{width:100%;border:0;border-top:1px solid #373737;background:transparent;color:#ebebeb;min-height:53px;padding:12px 16px;text-align:left;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12.5px;cursor:pointer}
.inactivity-row:first-child{border-top:0}
.inactivity-row:hover{background:#292929}
.inactivity-row.active{color:#f3fff5}
.inactivity-mark{display:flex;align-items:center;justify-content:center;width:21px;height:21px;border:1px solid #4b4b4b;border-radius:6px;color:#2d2d2d;background:#2b2b2b;flex:0 0 21px}
.inactivity-row.active .inactivity-mark{background:#22492e;border-color:#4b9b63;color:#a8ffbd}
.inactivity-mark svg{width:16px;height:16px}
.inactivity-subtitle{font-size:11px;color:#a5a5a5;line-height:1.5;margin:0 0 13px;padding:0 3px}
.pin-relock-top{margin-bottom:12px}
.pin-relock-note{margin:0 0 13px;color:#a2a2a2;font-size:11px;line-height:1.5}
.inactivity-card-heading{padding:17px 17px 13px}
.inactivity-card-heading h2{margin:0 0 7px;font-size:14px;font-weight:700}
.inactivity-card-heading p{font-size:11.5px;line-height:1.5;color:#aaa;margin:0}
.inactivity-list{border-top:1px solid #373737;border-bottom:1px solid #373737}
.inactivity-row.active{background:#27392b}
.inactivity-selected{color:#9fe6b4;font-size:10.5px;font-weight:650;white-space:nowrap}
.inactivity-card-footer{padding:14px 17px 17px;color:#a5a5a5;font-size:11px;line-height:1.55;margin:0}
.recovery-key-display{border:1px solid #4a4a4a;background:#292929;border-radius:9px;padding:16px 12px;font:700 12px/1.8 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.055em;overflow-wrap:anywhere;user-select:text;color:#f0f0f0;text-align:center}
.recovery-key-warning{margin:14px 0!important;color:#f1f1f1!important;font-size:12px!important;font-weight:600}
.recovery-key-actions{display:flex;gap:9px;align-items:stretch}
.recovery-key-actions .action-button{flex:1;min-width:0;padding:10px 9px}
.recovery-reset-warning{color:#efb6b0!important;font-weight:550;font-size:12px!important}
.recovery-ack{padding:5px 0 12px;align-items:center}
.security-item .row-actions{justify-content:flex-start;align-items:center;gap:9px;flex-wrap:wrap}
.security-item .row-actions .small-button{margin-left:0;align-self:auto;flex:0 0 auto}
.recovery-key-display{width:100%;min-height:112px;max-height:210px;display:block;resize:vertical;text-align:left;overflow-wrap:normal;white-space:pre-wrap;user-select:text;line-height:1.65}
.recovery-key-display:focus{outline:1px solid #9dd8af;outline-offset:2px}
.recovery-key-actions .action-button{display:flex;align-items:center;justify-content:center;gap:7px;white-space:normal}
.recovery-key-actions .action-button svg{width:17px;height:17px;flex:0 0 17px}
.security-inline-link{color:#a1e8b6;text-decoration:underline;text-underline-offset:2px;font-weight:620}
.security-inline-link:hover{color:#d3ffe1}
.inactivity-card-heading{padding:18px 17px 8px}
.inactivity-card-heading h2{color:#efefef!important;font-size:15px!important;letter-spacing:0;font-weight:730!important}
.inactivity-select-wrap{padding:11px 17px 7px;display:grid;gap:9px}
.inactivity-select-wrap label{font-size:11px;font-weight:650;color:#c7c7c7}
.inactivity-select-wrap select{display:block;width:100%;height:44px;border:1px solid #535353;border-radius:8px;padding:0 12px;background:#303030;color:#eee;appearance:auto;cursor:pointer}
.inactivity-card-footer{border:0;padding-top:12px}
.security-page{--green:#1ed760;max-width:760px;padding:24px 16px 100px}
.security-back{display:inline-block;color:#c7e9d0;text-decoration:none;font-size:12px;margin-bottom:20px}
.security-heading{margin:0 0 29px}
.security-item-icon{align-self:flex-start;display:block}
.security-item-icon svg{width:20px;height:20px}
.security-tiles{display:grid;grid-template-columns:1fr;gap:5px}
.security-section{min-width:0}
.security-hint{padding:17px;background:#202020;border:1px solid #373737;border-radius:9px;font-size:12px;color:#d4ded6;line-height:1.65}
.security-hint a{color:#a1e8b6}
.security-feedback{background:#233527;color:#c8ead0;padding:11px;border-radius:8px;font-size:12px}
.security-feedback.warning,.warning{color:#efb6a9}
.security-limits{font-size:11px;color:#bdaba5}
.security-item .small-button:disabled{opacity:.5;cursor:not-allowed}
.security-actions-row{display:flex;flex-wrap:wrap;gap:9px;padding:12px 15px}
.security-device-current{color:#a5eab6;white-space:nowrap;font-size:11px}
.security-device-revoked{color:#aaa;white-space:nowrap;font-size:11px}
.security-key-panel{margin-top:13px}
.security-page .security-copy{overflow-wrap:anywhere}
@media(min-width:700px){.security-tiles{grid-template-columns:1fr 1fr;column-gap:18px}.security-tiles #section-pin,.security-tiles #section-emergency{grid-column:span 1}.security-tiles #section-devices,.security-tiles #section-inactivity{grid-column:span 2}}
@media(max-width:430px){.security-item{padding:13px}.security-item-icon{width:22px;flex-basis:22px}.security-page{padding:19px 12px 100px}}
</style>
