<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { activeSession, type Session } from '../../identity/application/session'
import { readVerifiedGraceStatus, type GraceStatus } from '../application/grace-client'

const props=defineProps<{session:Session}>()
const status=ref<'unverified'|'loading'|'ready'|'error'>('unverified')
const snapshot=shallowRef<GraceStatus|null>(null)
let requestId=0

function sameSession(session:Session,id:number):boolean {
  return id===requestId && activeSession.value===session && props.session===session
}
async function refresh():Promise<void> {
  const id=++requestId,session=props.session
  snapshot.value=null // Never show yesterday's paid rights after offline/account change.
  status.value='unverified'
  if(!session.online||activeSession.value!==session)return
  status.value='loading'
  try{
    const latest=await readVerifiedGraceStatus(session)
    if(!sameSession(session,id))return
    snapshot.value=latest
    status.value='ready'
  }catch{
    if(sameSession(session,id))status.value='error'
  }
}
watch(()=>props.session,()=>{void refresh()},{immediate:true})
onUnmounted(()=>{++requestId;snapshot.value=null})

const statusLabel=computed(()=>{
  const value=snapshot.value
  if(!value)return ''
  if(value.planId==='free')return 'Бесплатный план'
  if(value.status==='active')return 'Оплаченный план активен'
  if(value.status==='grace')return 'Льготный срок после окончания оплаты'
  if(value.status==='expired')return 'Льготный срок завершён'
  return 'Оплата ещё не действует'
})
</script>

<template>
  <section class="foundation-card grace-status-panel" data-testid="billing-grace-panel"
    aria-labelledby="billing-grace-title">
    <div class="grace-status-heading">
      <div>
        <h2 id="billing-grace-title">Тариф и сроки</h2>
        <p class="muted">Проверенные сведения с сервера, только для просмотра.</p>
      </div>
      <button type="button" class="grace-refresh"
        :disabled="status==='loading'||!session.online"
        data-testid="billing-grace-refresh" @click="refresh">
        Обновить
      </button>
    </div>
    <p v-if="status==='unverified'" role="status" data-testid="billing-grace-unverified">
      Нет подтверждённой серверной сессии. Текущий тариф и сроки не проверены;
      локальные данные не подтверждают оплату.
    </p>
    <p v-else-if="status==='loading'" role="status" data-testid="billing-grace-loading">
      Проверяем тариф и права на сервере…
    </p>
    <p v-else-if="status==='error'" role="alert" data-testid="billing-grace-error">
      Не удалось подтвердить тариф. Данные о платном плане скрыты до успешной
      проверки сервера. Попробуйте обновить после восстановления соединения.
    </p>
    <div v-else-if="snapshot" data-testid="billing-grace-verified"
      aria-live="polite" class="grace-verified">
      <p><strong>План:</strong> {{ snapshot.planId }}</p>
      <p><strong>Статус:</strong> {{ statusLabel }}</p>
      <p v-if="snapshot.paidRightsDowngraded" class="grace-limited"
        data-testid="billing-grace-free-policy">
        Для новых операций действуют права и лимиты Free. Сохранённые файлы
        продолжают подчиняться первоначальному подписанному TTL и текущим разрешениям.
      </p>
      <p v-else-if="snapshot.planId==='free'">
        Бесплатный тариф без срока окончания оплаты.
      </p>
      <p v-if="snapshot.nextDeadlineAt">
        <strong>{{ snapshot.graceActive ? 'Окончание льготного срока' : 'Окончание оплаты' }}:</strong>
        <time :datetime="snapshot.nextDeadlineAt">{{ snapshot.nextDeadlineAt }} (UTC)</time>
      </p>
      <p v-if="snapshot.graceActive">
        Срок льготы: {{ snapshot.graceDays }} дней после окончания оплаты.
        Льгота не продлевает TTL файлов или оплаченные права.
      </p>
      <p class="muted" data-testid="billing-grace-as-of">
        Проверено на сервере: {{ snapshot.asOfAt }} (UTC).
        Это не подтверждение новой оплаты или автоматического продления.
      </p>
    </div>
  </section>
</template>

<style scoped>
.grace-status-panel{display:grid;gap:9px}
.grace-status-panel p{margin:0;font-size:12px;line-height:1.6}
.grace-status-heading{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.grace-status-heading h2{font-size:16px;margin:0 0 4px}
.grace-refresh{border:1px solid #525d55;background:#28342b;color:#dcefe1;
  padding:8px 12px;border-radius:7px;cursor:pointer;flex-shrink:0}
.grace-refresh:disabled{opacity:.5;cursor:not-allowed}
.grace-verified{display:grid;gap:9px}
.grace-limited{padding:9px 11px;border:1px solid #626054;border-radius:7px;
  background:#303029;color:#e4dfc2}
.grace-status-panel .muted{color:#a8b4a8;font-size:11px}
time{font-variant-numeric:tabular-nums}
@media(max-width:430px){.grace-status-heading{flex-wrap:wrap}}
</style>
