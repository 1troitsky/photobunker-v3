<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import {
  listLocalNotifications, markNotificationRead, markAllLocalNotificationsRead,
  previewNotification, type LocalNotification,
  readNotificationPreferences, notificationIsVisible,
  defaultNotificationPreferences, type NotificationPreferences,
} from '../features/notifications/application/local-inbox'
import {
  syncServerNotifications, resolveNotificationTarget,
} from '../features/notifications/application/server-event-sync'

const router=useRouter()
const tab=ref<'all'|'unread'>('all')
const rows=ref<LocalNotification[]>([])
const expanded=ref<string|null>(null)
const loading=ref(false)
const syncing=ref(false)
const busy=ref(false)
const error=ref('')
const preferences=ref<NotificationPreferences>({...defaultNotificationPreferences})
let run=0

function scope():string{
  const s=activeSession.value
  return s?[s.accountId,s.deviceId,s.pkg.akek,
    s.pkg.accountSpki,s.pkg.revision].join('|'):''
}
function current(owner:string,token:number):boolean{
  return run===token&&scope()===owner
}
const shown=computed(()=>rows.value.filter(row=>notificationIsVisible(row.kind,preferences.value)))
const visible=computed(()=>shown.value.filter(row=>tab.value==='all'||row.readAt===null))
const unread=computed(()=>shown.value.filter(row=>row.readAt===null).length)
const canSync=computed(()=>activeSession.value?.online===true)
function time(ms:number):string{
  return new Intl.DateTimeFormat('ru-RU',{
    day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',
  }).format(ms)
}
async function readLocal(token:number,owner:string):Promise<void>{
  const items=await listLocalNotifications()
  if(current(owner,token))rows.value=items
}
async function reload():Promise<void>{
  const owner=scope(),token=++run
  rows.value=[];expanded.value=null;error.value=''
  preferences.value={...defaultNotificationPreferences}
  if(!owner)return
  loading.value=true
  // Display preferences are NOT an authorization boundary. Corrupted
  // preferences must not conceal independently decrypted security notices.
  try{
    const items=await listLocalNotifications()
    if(current(owner,token))rows.value=items
  }catch{
    if(current(owner,token))
      error.value='Не удалось открыть зашифрованные уведомления.'
  }
  if(current(owner,token)){
    try{
      const settings=await readNotificationPreferences()
      if(current(owner,token))preferences.value=settings
    }catch{
      if(current(owner,token)){
        preferences.value={...defaultNotificationPreferences}
        error.value='Настройки отображения повреждены. Показаны все сохранённые уведомления.'
      }
    }
  }
  finally{if(current(owner,token))loading.value=false}
  if(!current(owner,token)||!canSync.value)return
  if(typeof navigator!=='undefined'&&!navigator.onLine)return
  await refresh(token,owner)
}
let refreshTask:Promise<void>|null=null
let refreshOwner:string|null=null
async function refresh(token=run,owner=scope()):Promise<void>{
  if(!owner||!canSync.value||!current(owner,token))return
  if(refreshTask){
    // A previous account's in-flight request must not suppress the first
    // refresh of the replacement account. Wait, then re-check identity.
    if(refreshOwner===owner)return refreshTask
    await refreshTask
    if(!current(owner,token)||!canSync.value)return
  }
  syncing.value=true
  refreshOwner=owner
  const task=(async()=>{
    try{
      await syncServerNotifications()
      if(current(owner,token))await readLocal(token,owner)
    }catch{
      // Old encrypted offline records remain visible; a transport error is
      // not evidence that anything was marked read or lost.
      if(current(owner,token))error.value='Сервер недоступен. Показаны сохранённые уведомления.'
    }finally{syncing.value=false}
  })()
  refreshTask=task
  try{await task}
  finally{
    if(refreshTask===task){refreshTask=null;refreshOwner=null}
  }
}
async function expand(row:LocalNotification):Promise<void>{
  if(busy.value)return
  const owner=scope(),token=run
  if(!owner)return
  expanded.value=expanded.value===row.id?null:row.id
  if(expanded.value!==row.id||row.readAt!==null)return
  busy.value=true
  try{
    await markNotificationRead(row.id)
    if(current(owner,token))await readLocal(token,owner)
  }catch{if(current(owner,token))error.value='Не удалось сохранить отметку о прочтении.'}
  finally{busy.value=false}
}
async function markAll():Promise<void>{
  if(busy.value||unread.value===0)return
  const owner=scope(),token=run
  busy.value=true
  try{
    const ids=shown.value.filter(row=>row.readAt===null).map(row=>row.id)
    await markAllLocalNotificationsRead(Date.now(),ids)
    if(current(owner,token))await readLocal(token,owner)
  }catch{if(current(owner,token))error.value='Не удалось сохранить отметки о прочтении.'}
  finally{busy.value=false}
}
async function openTarget(row:LocalNotification):Promise<void>{
  // The encrypted local target is intentionally NOT used for navigation.
  // Validate the event on the server at click time; read authorization is
  // checked once more by the actual destination.
  if(busy.value||!activeSession.value?.online)return
  const owner=scope(),token=run
  busy.value=true;error.value=''
  try{
    const target=await resolveNotificationTarget(row.id)
    if(!current(owner,token))return
    if(target.kind==='new-file'){
      await router.push('/browser/file/media/'+target.targetId)
    }else if(target.kind==='assignment-invite'){
      await router.push('/assignments')
    }else if(target.kind==='team-invite'){
      await router.push('/contacts')
    }
  }catch{
    if(current(owner,token))
      error.value='Доступ к событию больше не подтверждён. Проверьте приглашение или файл.'
  }finally{busy.value=false}
}
function canOpen(row:LocalNotification):boolean{
  return canSync.value&&row.targetId!==null&&
    ['new-file','assignment-invite','team-invite'].includes(row.kind)
}
function wake():void{void reload()}
watch(activeSession,()=>{void reload()})
onMounted(()=>{
  void reload()
  window.addEventListener('online',wake)
})
onUnmounted(()=>{
  ++run;rows.value=[];expanded.value=null
  window.removeEventListener('online',wake)
})
</script>

<template>
  <section class="foundation-content notifications-page" data-testid="notifications-page">
    <header class="notifications-heading">
      <h1>Уведомления</h1>
      <div class="notifications-actions">
        <button type="button" aria-label="Прочитать все" title="Прочитать все"
          :disabled="busy||unread===0" data-testid="notifications-mark-all"
          @click="markAll">✓ <span>Прочитать все</span></button>
        <button type="button" aria-label="Настройки уведомлений"
          title="Настройки уведомлений"
          data-testid="notifications-settings" @click="router.push('/notifications/settings')">⚙</button>
      </div>
    </header>
    <nav class="notifications-tabs" aria-label="Фильтр уведомлений">
      <button type="button" :class="{selected:tab==='all'}"
        :aria-current="tab==='all'?'page':undefined"
        data-testid="notifications-all" @click="tab='all'">Все</button>
      <button type="button" :class="{selected:tab==='unread'}"
        :aria-current="tab==='unread'?'page':undefined"
        data-testid="notifications-unread" @click="tab='unread'">
        Непрочитанные <span v-if="unread">({{ unread }})</span>
      </button>
    </nav>
    <div v-if="!activeSession" class="foundation-card" data-testid="notifications-signed-out">
      <p>Для уведомлений нужен анонимный аккаунт.</p>
      <RouterLink to="/settings">Создать или восстановить аккаунт</RouterLink>
    </div>
    <template v-else>
      <p v-if="!activeSession.online" class="notifications-hint">
        Локальный режим. Показаны сохранённые зашифрованные уведомления.
      </p>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <p v-if="loading" role="status">Открываем зашифрованную историю…</p>
      <p v-else-if="!visible.length" class="notifications-empty" data-testid="notifications-empty">
        {{ tab==='unread'?'Непрочитанных уведомлений нет.':'Уведомлений пока нет.' }}
      </p>
      <ul v-else class="notifications-list" data-testid="notifications-list">
        <li v-for="row in visible" :key="row.id"
          :class="{read:row.readAt!==null,expanded:expanded===row.id}"
          :data-testid="'notification-'+row.id">
          <button type="button" class="notification-summary"
            :aria-expanded="expanded===row.id" :disabled="busy"
            @click="expand(row)">
            <span class="notification-dot" :class="{isread:row.readAt!==null||!preferences.badges}"
              aria-hidden="true"></span>
            <span class="notification-copy">
              <strong>{{ previewNotification(row).title }}</strong>
              <small>{{ previewNotification(row).description }}</small>
            </span>
            <time :datetime="new Date(row.occurredAt).toISOString()">{{ time(row.occurredAt) }}</time>
            <span aria-hidden="true" class="notification-chevron">{{ expanded===row.id?'⌃':'⌄' }}</span>
          </button>
          <div v-if="expanded===row.id" class="notification-details">
            <p>{{ previewNotification(row).description }}</p>
            <button v-if="canOpen(row)" type="button" :disabled="busy"
              data-testid="notification-open" @click="openTarget(row)">
              Проверить и открыть
            </button>
            <p v-else-if="row.targetId!==null" class="notifications-hint">
              Для открытия требуется актуальная проверка доступа на сервере.
            </p>
          </div>
        </li>
      </ul>
      <div class="notifications-footer">
        <button type="button" :disabled="!canSync||syncing||loading"
          data-testid="notifications-refresh" @click="refresh()">
          {{ syncing?'Обновление…':'Обновить' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.notifications-page{max-width:860px}
.notifications-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}
.notifications-actions{display:flex;gap:7px;align-items:center}
.notifications-actions button{min-height:36px;white-space:nowrap;background:transparent}
.notifications-tabs{display:flex;margin:20px 0 14px;border-bottom:1px solid var(--outline)}
.notifications-tabs button{border:0;border-radius:0;background:transparent;color:#aaa;padding:12px 16px;border-bottom:2px solid transparent}
.notifications-tabs button.selected{color:#fff;border-bottom-color:var(--accent)}
.notifications-list{list-style:none;margin:0;padding:0;border-radius:10px;overflow:hidden;background:var(--surface)}
.notifications-list li{border-bottom:1px solid var(--outline)}
.notifications-list li:last-child{border-bottom:0}
.notifications-list li.read .notification-summary{opacity:.65}
.notification-summary{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:transparent!important;border:0!important;border-radius:0!important;min-height:75px!important;padding:13px!important}
.notification-summary:hover{background:#272e29!important}
.notification-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:0 0 7px}
.notification-dot.isread{background:transparent}
.notification-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px}
.notification-copy strong{font-size:13px}
.notification-copy small,.notification-summary time{font-size:11px;color:#aaa}
.notification-summary time{white-space:nowrap;align-self:flex-start;margin-top:2px}
.notification-chevron{color:#999}
.notification-details{padding:0 16px 16px 32px}
.notification-details p{margin:0 0 13px;color:#aaa;line-height:1.5}
.notifications-hint{font-size:11px;color:#aaa}
.notifications-empty{padding:35px 15px;text-align:center;color:#aaa}
.notifications-footer{display:flex;justify-content:flex-end;margin-top:15px}
@media(max-width:550px){
  .notifications-heading h1{font-size:24px}
  .notifications-actions button span{display:none}
  .notification-summary{gap:8px}
  .notification-summary time{font-size:10px}
}
@media(prefers-reduced-motion:reduce){.notifications-page *{transition:none!important}}
</style>
