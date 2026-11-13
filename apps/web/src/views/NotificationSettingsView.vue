<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import {
  defaultNotificationPreferences, readNotificationPreferences,
  saveNotificationPreferences, type NotificationPreferences,
} from '../features/notifications/application/local-inbox'

const router=useRouter()
const draft=ref<NotificationPreferences>({...defaultNotificationPreferences})
const saved=ref<NotificationPreferences>({...defaultNotificationPreferences})
const loading=ref(true)
const saving=ref(false)
const error=ref('')
const status=ref('')
const dirty=computed(()=>JSON.stringify(draft.value)!==JSON.stringify(saved.value))
let version=0
const choices=[
  {id:'invitations' as const,title:'Приглашения',hint:'Задания и команды'},
  {id:'deadlines' as const,title:'Сроки заданий',hint:'Напоминания о завершении'},
  {id:'expiry' as const,title:'Удаление файлов',hint:'Срок хранения и очистка'},
  {id:'system' as const,title:'Системные события',hint:'Файлы, резервные копии и подписка'},
  {id:'badges' as const,title:'Индикаторы',hint:'Показывать отметки непрочитанных'},
]
function owner():string{
  const s=activeSession.value
  return s?[s.accountId,s.deviceId,s.pkg.akek,s.pkg.revision].join('|'):''
}
async function initialize():Promise<void>{
  const token=++version,scope=owner()
  error.value='';status.value='';loading.value=true
  draft.value={...defaultNotificationPreferences}
  saved.value={...defaultNotificationPreferences}
  if(!scope){loading.value=false;return}
  try{
    const value=await readNotificationPreferences()
    if(version===token&&owner()===scope){
      saved.value=value
      draft.value={...value}
    }
  }catch{
    if(version===token&&owner()===scope)
      error.value='Не удалось прочитать зашифрованные настройки уведомлений.'
  }finally{if(version===token)loading.value=false}
}
type CategoryFlag='invitations'|'deadlines'|'expiry'|'system'|'badges'|'quietEnabled'
function update(key:CategoryFlag,value:boolean):void{
  draft.value={...draft.value,[key]:value}
  error.value='';status.value=''
}
function clockValue(minute:number):string{
  return String(Math.floor(minute/60)).padStart(2,'0')+':'+
    String(minute%60).padStart(2,'0')
}
function changeQuietClock(key:'quietStart'|'quietEnd',value:string):void{
  if(!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value))return
  const [hour,minute]=value.split(':').map(Number)
  draft.value={...draft.value,[key]:hour!*60+minute!}
  error.value='';status.value=''
}
async function save():Promise<void>{
  if(saving.value||loading.value||!dirty.value)return
  if(draft.value.quietStart===draft.value.quietEnd){
    error.value='Начало и окончание тихих часов не должны совпадать.'
    return
  }
  const token=version,scope=owner(),next={...draft.value}
  if(!scope)return
  saving.value=true;error.value=''
  try{
    await saveNotificationPreferences(next)
    if(version===token&&owner()===scope){
      saved.value=next
      status.value='Сохранено в зашифрованном хранилище этого устройства.'
    }
  }catch{
    if(version===token&&owner()===scope)
      error.value='Не удалось сохранить настройки. Изменения не применены.'
  }finally{saving.value=false}
}
function cancel():void{
  draft.value={...saved.value}
  void router.push('/notifications')
}
// Revalidate on identity/key change, but keep unsaved changes when the
// same device simply finishes an online proof or loses connectivity.
watch(owner,()=>{void initialize()})
onMounted(()=>{void initialize()})
</script>

<template>
  <section class="foundation-content notification-settings" data-testid="notification-settings-page">
    <header class="settings-heading">
      <h1>Настройки уведомлений</h1>
      <p>Какие уведомления показывать в списке на этом устройстве.</p>
    </header>
    <div v-if="!activeSession" class="foundation-card">
      <p>Войдите в аккаунт, чтобы изменить настройки.</p>
    </div>
    <template v-else>
      <p v-if="loading" role="status">Открываем зашифрованные настройки…</p>
      <div v-else class="settings-options">
        <label v-for="choice in choices" :key="choice.id" class="setting-option">
          <span><strong>{{choice.title}}</strong><small>{{choice.hint}}</small></span>
          <input type="checkbox" :checked="draft[choice.id]"
            :data-testid="'notification-setting-'+choice.id"
            :disabled="saving" @change="update(choice.id,($event.target as HTMLInputElement).checked)">
        </label>
        <label class="setting-option">
          <span><strong>Тихие часы</strong><small>Скрывать обычные индикаторы на этом устройстве, не скрывая уведомления</small></span>
          <input type="checkbox" :checked="draft.quietEnabled"
            data-testid="notification-setting-quiet-enabled" :disabled="saving"
            @change="update('quietEnabled',($event.target as HTMLInputElement).checked)">
        </label>
        <div class="setting-option quiet-hours">
          <label>
            <span>Начало</span>
            <input type="time" data-testid="notification-setting-quiet-start"
              :value="clockValue(draft.quietStart)" :disabled="saving||!draft.quietEnabled"
              @change="changeQuietClock('quietStart',($event.target as HTMLInputElement).value)">
          </label>
          <label>
            <span>Окончание</span>
            <input type="time" data-testid="notification-setting-quiet-end"
              :value="clockValue(draft.quietEnd)" :disabled="saving||!draft.quietEnabled"
              @change="changeQuietClock('quietEnd',($event.target as HTMLInputElement).value)">
          </label>
        </div>
        <div class="setting-option fixed">
          <span><strong>Уведомления безопасности</strong><small>Отзыв устройств и важные изменения доступа всегда видны</small></span>
          <span>Всегда включены</span>
        </div>
        <div class="setting-option fixed">
          <span><strong>Push-уведомления</strong><small>Подключение push появится после отдельной проверки приватности и доставки</small></span>
          <input type="checkbox" disabled data-testid="notification-setting-push">
        </div>
      </div>
      <p class="settings-hint">Настройки категорий скрывают записи только в локальном списке. Тихие часы скрывают лишь обычные индикаторы; события безопасности видны всегда. Это не управление OS push. Серверные события продолжают сохраняться; просмотр и доступ к файлам проверяются отдельно. Настройки не синхронизируются между устройствами.</p>
      <p v-if="status" role="status">{{status}}</p>
      <p v-if="error" role="alert">{{error}}</p>
      <div class="settings-actions">
        <button type="button" @click="cancel">Отмена</button>
        <button type="button" :disabled="saving||loading||!dirty"
          data-testid="notification-settings-save" @click="save">Сохранить</button>
      </div>
    </template>
  </section>
</template>
<style scoped>
.notification-settings{max-width:800px;margin:0 auto}
.settings-heading h1{font-size:26px;margin:0}
.settings-heading p,.settings-hint{color:#aab2aa;font-size:12px;line-height:1.55}
.settings-options{margin-top:24px;background:var(--surface);border-radius:12px;overflow:hidden}
.setting-option{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:15px 18px;border-bottom:1px solid var(--outline)}
.setting-option:last-child{border:0}
.setting-option span:first-child{display:flex;flex-direction:column;gap:5px}
.setting-option strong{font-size:13px}
.setting-option small{color:#aab2aa;font-size:11px}
.setting-option input{width:18px;height:18px;accent-color:var(--accent)}
.setting-option.fixed{color:#aab2aa}
.setting-option.fixed>span:last-child{font-size:11px;white-space:nowrap}
.quiet-hours{justify-content:flex-start;gap:24px}
.quiet-hours label{display:flex;align-items:center;gap:10px;font-size:12px}
.quiet-hours input{width:auto;height:auto;color:inherit;background:transparent;border:1px solid var(--outline);border-radius:5px;padding:5px}
.settings-hint{margin:20px 0}
.settings-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
@media(max-width:480px){.setting-option{padding:12px}.setting-option.fixed>span:last-child{white-space:normal;text-align:right}}
</style>

