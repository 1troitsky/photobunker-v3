<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { jsonApi } from '../features/identity/infrastructure/api'
import { activeSession } from '../features/identity/application/session'
import GraceStatusPanel from '../features/billing/ui/GraceStatusPanel.vue'

type Plan={
  planId:string;monthlyPriceCents:number;periodPricesCents:Record<string,number>
  limits:{
    assignmentCreationsPerMonth:number|null;maxMediaFiles:number|null;
    storage:{amount:number;unit:string};retention:{days?:number;mode?:string};
    graceDays:number|null
  }
}
const plans=ref<Plan[]>([])
const loading=ref(false),error=ref(''),months=ref(1)
const selected=ref('')
let seq=0
function parse(value:unknown):Plan[]{
  if(!value||typeof value!=='object')throw Error('billing.catalog_invalid')
  const x=value as Record<string,unknown>
  if(x.schemaVersion!==1||x.currency!=='USD'||!Array.isArray(x.plans)||x.plans.length!==5)
    throw Error('billing.catalog_invalid')
  const ids=['free','go','pro','unlimited','unlimited_plus']
  return x.plans.map((item:unknown)=>{
    if(!item||typeof item!=='object')throw Error('billing.catalog_invalid')
    const v=item as Plan
    if(!ids.includes(v.planId)||!Number.isSafeInteger(v.monthlyPriceCents)
      ||v.monthlyPriceCents<0||!v.periodPricesCents||!v.limits
      ||!v.limits.storage||!Number.isFinite(v.limits.storage.amount))
      throw Error('billing.catalog_invalid')
    return v
  })
}
async function refresh():Promise<void>{
  const id=++seq
  error.value='';plans.value=[];loading.value=true;selected.value=''
  try{
    const result=await jsonApi<unknown>('/billing/v1/plans')
    const parsed=parse(result)
    if(id===seq)plans.value=parsed
  }catch(e){if(id===seq)error.value=e instanceof Error?e.message:'Не удалось получить тарифы'}
  finally{if(id===seq)loading.value=false}
}
onMounted(()=>{void refresh()})
watch(activeSession,()=>{selected.value=''})
function money(cents:number):string{return '$'+(cents/100).toFixed(2)}
function price(plan:Plan):string{
  const cents=plan.periodPricesCents[String(months.value)]
  return typeof cents==='number'&&Number.isSafeInteger(cents)?money(cents):'Не предусмотрено'
}
function quota(n:number|null):string{return n===null?'Без лимита плана':String(n)}
</script>
<template>
<section class="payments-page" data-testid="payments-page">
  <RouterLink class="back" to="/settings">‹ Настройки</RouterLink>
  <h1>Платежи и тарифы</h1>
  <GraceStatusPanel v-if="activeSession" :session="activeSession" />
  <p v-else class="notice">Для проверки текущего тарифа войдите в аккаунт. <RouterLink to="/settings">Доступ</RouterLink></p>
  <header class="compare">
    <h2>Сравнить тарифы</h2>
    <div class="period" aria-label="Период подписки">
      <button v-for="period in [1,6,12]" :key="period" type="button"
        :aria-pressed="months===period" :class="{selected:months===period}"
        @click="months=period;selected=''">{{ period===1?'1 месяц':period+' месяцев' }}</button>
    </div>
  </header>
  <p v-if="loading" role="status">Получение действующего каталога с сервера…</p>
  <p v-if="error" role="alert" class="warning">{{ error }} <button @click="refresh">Повторить</button></p>
  <div v-if="plans.length" class="plan-grid">
    <article v-for="plan in plans" :key="plan.planId" class="plan-card">
      <h3>{{ plan.planId==='unlimited_plus'?'Unlimited+':plan.planId }}</h3>
      <strong class="price">{{ price(plan) }}</strong><span class="tiny">за выбранный период</span>
      <dl>
        <dt>Облако</dt><dd>{{ plan.limits.storage.amount }} {{ plan.limits.storage.unit }}</dd>
        <dt>Задания / месяц</dt><dd>{{ quota(plan.limits.assignmentCreationsPerMonth) }}</dd>
        <dt>Файлы</dt><dd>{{ quota(plan.limits.maxMediaFiles) }}</dd>
        <dt>Срок хранения</dt><dd>{{ plan.limits.retention.days?plan.limits.retention.days+' дней':'По правилам активного тарифа' }}</dd>
        <dt>Grace</dt><dd>{{ plan.limits.graceDays===null?'—':plan.limits.graceDays+' дней' }}</dd>
      </dl>
      <button type="button" :disabled="!activeSession" :aria-pressed="selected===plan.planId"
        @click="selected=plan.planId">Выбрать</button>
    </article>
  </div>
  <section v-if="selected" class="selection" role="status">
    <h2>Выбран тариф {{ selected }}</h2>
    <p>Выбор не активирует права и не создаёт счёт. Настоящий Web3 Checkout пока не подключён к проверенной оплате.</p>
    <button type="button" disabled>Перейти к оплате</button>
    <button type="button" @click="selected=''">Отмена</button>
  </section>
  <section class="history"><h2>История платежей</h2><p>Подтверждённый серверный список квитанций ещё не доступен; вымышленные операции не показываются.</p></section>
</section>
</template>
<style scoped>
.payments-page{max-width:1120px;margin:auto;padding:24px 16px 120px;color:#f1f4f1}
.back,.payments-page a{color:#b2e5c1;text-decoration:none}.payments-page h1{font-size:26px;margin:24px 0}
.compare{display:flex;flex-wrap:wrap;gap:15px;align-items:center;justify-content:space-between;margin:30px 0 16px}
.compare h2,.history h2,.selection h2{font-size:18px}
.period{display:flex;gap:4px;border:1px solid #414a43;border-radius:8px;overflow:hidden}
.period button{border:0;background:#252a25;color:#d4ded5;padding:10px;cursor:pointer;font-size:12px}
.period button.selected{background:#3d6546}
.plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px}
.plan-card{padding:17px;border:1px solid #444f46;border-radius:11px;background:#1e231f}
.plan-card h3{font-size:16px;margin:0 0 12px;text-transform:capitalize}
.price{display:block;font-size:23px}.tiny{font-size:10px;color:#aeb7ae}
.plan-card dl{display:grid;grid-template-columns:1fr auto;gap:9px 6px;font-size:11px;margin:24px 0}
.plan-card dt{color:#afc1b1}.plan-card dd{margin:0;text-align:right}
.plan-card button,.selection button,.warning button{padding:10px 14px;border:1px solid #52745b;background:#2e5539;color:#fff;border-radius:8px;cursor:pointer}
.plan-card button:disabled,.selection button:disabled{opacity:.5;cursor:not-allowed}
.plan-card button[aria-pressed=true]{background:#457f53}
.selection,.history{margin-top:20px;padding:20px;background:#222923;border:1px solid #455647;border-radius:9px;font-size:12px}
.selection button{margin:7px 9px 0 0}.warning{color:#ffd0bc}.notice{font-size:13px}
</style>
