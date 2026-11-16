<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeSession, type Session } from '../features/identity/application/session'
import { readVerifiedGraceStatus, type GraceStatus } from '../features/billing/application/grace-client'
import { readPublicCatalog, type PublicPlan } from '../features/billing/application/catalog-client'

type Screen='home'|'compare'|'renew'|'history'
const screen=ref<Screen>('home'),period=ref<1|6|12>(1)
const catalog=ref<PublicPlan[]>([]),loading=ref(false),error=ref('')
const verified=ref<GraceStatus|null>(null),verifyState=ref<'missing'|'loading'|'ready'|'error'>('missing')
const chosen=ref('go')
const periodOptions=[{n:1,label:'1 месяц'},{n:6,label:'6 месяцев · скидка'},{n:12,label:'12 месяцев · выгоднее'}] as const
let catalogGeneration=0,verificationGeneration=0
const titles:Record<string,string>={free:'Free',go:'Go',pro:'Pro',unlimited:'Unlimited',unlimited_plus:'Unlimited+'}
function name(id:string):string{return titles[id]??'Тариф'}
function currency(cents:number):string{return '$'+(cents/100).toFixed(2)}
function quota(v:number|null):string{return v===null?'∞':String(v)}
function priceFor(plan:PublicPlan):number|null{
  const n=plan.periodPricesCents[String(period.value)]
  return typeof n==='number'&&Number.isSafeInteger(n)?n:null
}
function discount(plan:PublicPlan):string{
  const amount=priceFor(plan)
  if(amount===null||period.value===1||plan.monthlyPriceCents===0)return ''
  const full=plan.monthlyPriceCents*period.value
  return full>amount?String(Math.round((full-amount)/full*100))+'%':''
}
function openCompare():void{screen.value='compare'}
function openRenew(planId?:string):void{if(planId)chosen.value=planId;screen.value='renew'}
function back():void{
  screen.value=screen.value==='renew'||screen.value==='history'?'home':'home'
}
const currentPlan=computed(()=>verified.value
  ?catalog.value.find(x=>x.planId===verified.value!.planId)??null:null)
const selectedPlan=computed(()=>catalog.value.find(x=>x.planId===chosen.value)??null)
const chosenPrice=computed(()=>selectedPlan.value?priceFor(selectedPlan.value):null)
async function loadCatalog():Promise<void>{
  const gen=++catalogGeneration
  catalog.value=[];loading.value=true;error.value=''
  try{
    const items=await readPublicCatalog()
    if(gen!==catalogGeneration)return
    catalog.value=items
  }catch(e){if(gen===catalogGeneration)error.value=e instanceof Error?e.message:'Не удалось получить каталог'}
  finally{if(gen===catalogGeneration)loading.value=false}
}
async function loadAccount():Promise<void>{
  const session:Session|null=activeSession.value,gen=++verificationGeneration
  verified.value=null;verifyState.value='missing'
  if(!session||!session.online)return
  verifyState.value='loading'
  try{
    const v=await readVerifiedGraceStatus(session)
    if(gen===verificationGeneration&&activeSession.value===session){
      verified.value=v;verifyState.value='ready';chosen.value=v.planId==='free'?'go':v.planId
    }
  }catch{
    if(gen===verificationGeneration)verifyState.value='error'
  }
}
watch(activeSession,()=>{void loadAccount()},{immediate:true})
onMounted(()=>{void loadCatalog()})
</script>

<template>
<section class="billing-page" data-testid="payments-page">
  <RouterLink class="billing-back" to="/settings">‹ Настройки</RouterLink>
  <div class="page-heading">
    <h1>{{ screen==='home'?'Платежи и тарифы':screen==='compare'?'Сравнение тарифов':screen==='renew'?'Продлить тариф':'История платежей' }}</h1>
    <p>{{ screen==='home'?'Задания, файлы и подписка':screen==='compare'?'Выберите возможности для ваших заданий':screen==='renew'?'Выбор плана и периода':'Операции и квитанции' }}</p>
  </div>
  <button v-if="screen!=='home'" class="billing-btn billing-secondary-back" type="button" @click="back">‹ К тарифам</button>
  <p v-if="loading" role="status" class="billing-note">Получение каталога с сервера…</p>
  <p v-if="error" role="alert" class="billing-note">{{error}} <button class="billing-btn" type="button" @click="loadCatalog">Повторить</button></p>

  <template v-if="screen==='home'">
    <section class="billing-current" data-testid="billing-current">
      <span class="billing-eyebrow">Текущий тариф</span>
      <template v-if="verified">
        <div class="billing-plan-name"><strong>{{name(verified.planId)}}</strong>
          <span class="billing-active"><i></i>{{verified.status==='active'?'Активен':verified.status==='grace'?'Льготный срок':verified.status==='expired'?'Истёк':'Ожидает вступления'}}</span>
        </div>
        <p v-if="verified.planEndsAt" class="billing-days">Дата окончания оплаты:
          <strong>{{verified.planEndsAt}} (UTC)</strong>
        </p>
        <p v-else class="billing-days">Бесплатный план. Платного срока окончания нет.</p>
        <p v-if="verified.graceEndsAt" class="billing-days">Окончание льготного срока:
          <strong>{{verified.graceEndsAt}} (UTC)</strong>
        </p>
      </template>
      <p v-else-if="verifyState==='loading'" class="billing-muted" role="status">Проверка подписки на сервере…</p>
      <p v-else-if="verifyState==='error'" class="billing-muted" role="alert">Нет подтверждённого статуса подписки. Платные права не отображаются.</p>
      <p v-else class="billing-muted">Для подтверждения тарифа откройте аккаунт и подключитесь к серверу. Локальные данные не подтверждают платежи.</p>
      <div class="billing-actions">
        <button class="billing-btn" type="button" :disabled="!catalog.length" @click="openRenew()">Продлить или сменить</button>
        <button class="billing-btn primary" type="button" :disabled="!catalog.length" @click="openCompare">Сравнить тарифы</button>
      </div>
    </section>

    <template v-if="currentPlan">
      <h2 class="billing-section-label">Лимиты {{name(currentPlan.planId)}}</h2>
      <div class="billing-metrics">
        <div><strong>{{quota(currentPlan.limits.assignmentCreationsPerMonth)}}</strong><span>Заданий в месяц</span></div>
        <div><strong>{{quota(currentPlan.limits.maxMediaFiles)}}</strong><span>Файлов</span></div>
        <div><strong>{{currentPlan.limits.storage.amount}} {{currentPlan.limits.storage.unit}}</strong><span>Облачный лимит</span></div>
      </div>
      <p class="billing-note">Лимиты взяты из действующего каталога. Новые операции проверяются сервером по реальным правам и квотам аккаунта.</p>
    </template>
    <h2 class="billing-section-label">Управление подпиской</h2>
    <div class="billing-panel">
      <button type="button" class="billing-nav-row" :disabled="!catalog.length" @click="openCompare">
        <span><strong>Сравнение тарифов</strong><small>Free · Go · Pro · Unlimited · Unlimited+</small></span><span aria-hidden="true">›</span>
      </button>
      <button type="button" class="billing-nav-row" :disabled="!catalog.length" @click="openRenew()">
        <span><strong>Продлить или сменить тариф</strong><small>1, 6 или 12 месяцев</small></span><span aria-hidden="true">›</span>
      </button>
      <button type="button" class="billing-nav-row" @click="screen='history'">
        <span><strong>История платежей</strong><small>Проверенные операции и квитанции</small></span><span aria-hidden="true">›</span>
      </button>
    </div>
    <p class="billing-muted">Подтверждение оплаты и выдача платных прав требуют настоящего серверного settlement. Эта страница не создаёт оплаченных заказов.</p>
  </template>

  <template v-else-if="screen==='compare'">
    <p class="billing-muted">Все цены и лимиты получены с действующего сервера PB3, без демонстрационных данных.</p>
    <h2 class="billing-section-label">Период оплаты</h2>
    <div class="billing-periods" role="group" aria-label="Период оплаты">
      <button v-for="option in periodOptions" :key="option.n" type="button"
        :class="{selected:period===option.n}" :aria-pressed="period===option.n"
        @click="period=option.n">{{option.label}}</button>
    </div>
    <div class="billing-grid">
      <article v-for="plan in catalog" :key="plan.planId" class="billing-tier"
        :class="{featured:plan.planId===verified?.planId}" :data-testid="'billing-tier-'+plan.planId">
        <div class="billing-tier-top"><strong>{{name(plan.planId)}}</strong>
          <small v-if="plan.planId===verified?.planId">Ваш тариф</small>
        </div>
        <div class="billing-tier-description">{{plan.planId==='free'?'Бесплатное использование':'Зашифрованное хранение и задания'}}</div>
        <div class="billing-price">{{priceFor(plan)===null?'Недоступно':currency(priceFor(plan)!)}} <small v-if="priceFor(plan)!==null">за {{period}} мес.</small></div>
        <div v-if="discount(plan)" class="billing-discount">Скидка {{discount(plan)}}</div>
        <div class="billing-tier-points">
          <div><span>✓</span><span>Заданий: {{quota(plan.limits.assignmentCreationsPerMonth)}} / месяц</span></div>
          <div><span>✓</span><span>Файлы: {{quota(plan.limits.maxMediaFiles)}}</span></div>
          <div><span>✓</span><span>Облако: {{plan.limits.storage.amount}} {{plan.limits.storage.unit}}</span></div>
          <div><span>✓</span><span>Ручных обновлений копии: {{quota(plan.limits.manualBackupUpdatesPerWeek)}} / неделю</span></div>
        </div>
        <button class="billing-btn" type="button" :disabled="priceFor(plan)===null"
          @click="openRenew(plan.planId)">Выбрать {{name(plan.planId)}}</button>
      </article>
    </div>
    <h2 class="billing-section-label">Полное сравнение</h2>
    <div v-if="catalog.length" class="billing-compare">
      <table>
        <thead><tr><th>Возможность</th><th v-for="plan in catalog" :key="plan.planId">{{name(plan.planId)}}</th></tr></thead>
        <tbody>
          <tr><td>Новые задания / месяц</td><td v-for="plan in catalog" :key="plan.planId">{{quota(plan.limits.assignmentCreationsPerMonth)}}</td></tr>
          <tr><td>Медиафайлы</td><td v-for="plan in catalog" :key="plan.planId">{{quota(plan.limits.maxMediaFiles)}}</td></tr>
          <tr><td>Зашифрованное облако</td><td v-for="plan in catalog" :key="plan.planId">{{plan.limits.storage.amount}} {{plan.limits.storage.unit}}</td></tr>
          <tr><td>Хранение</td><td v-for="plan in catalog" :key="plan.planId">{{plan.limits.retention.days?plan.limits.retention.days+' дней':'По правилам действующего тарифа'}}</td></tr>
          <tr><td>Ручные обновления копии / неделю</td><td v-for="plan in catalog" :key="plan.planId">{{quota(plan.limits.manualBackupUpdatesPerWeek)}}</td></tr>
          <tr><td>Облачный backup</td><td v-for="plan in catalog" :key="plan.planId">{{plan.featureFlags.encryptedCloudBackup?'Да':'Нет'}}</td></tr>
          <tr><td>Emergency PIN (право по тарифу)</td><td v-for="plan in catalog" :key="plan.planId">{{plan.featureFlags.emergencyPin?'Да':'Нет'}}</td></tr>
          <tr><td>Удалённое экстренное удаление (право)</td><td v-for="plan in catalog" :key="plan.planId">{{plan.featureFlags.remoteEmergency?'Да':'Нет'}}</td></tr>
          <tr><td>Grace</td><td v-for="plan in catalog" :key="plan.planId">{{plan.limits.graceDays===null?'—':plan.limits.graceDays+' дней'}}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="billing-note">Наличие права по тарифу не означает, что функция уже технически реализована или безопасно принята. Существующие файлы подчиняются подписанным TTL и правилам заданий.</p>
  </template>

  <template v-else-if="screen==='renew'">
    <h2 class="billing-section-label">Выберите тариф</h2>
    <div class="billing-select" role="radiogroup" aria-label="Тариф">
      <label v-for="plan in catalog" :key="plan.planId" class="billing-option" :class="{selected:chosen===plan.planId}">
        <input v-model="chosen" type="radio" name="billing-plan" :value="plan.planId">
        <span class="billing-radio"></span><span class="billing-option-text">
          <strong>{{name(plan.planId)}}</strong>
          <small>{{plan.limits.storage.amount}} {{plan.limits.storage.unit}} · {{quota(plan.limits.assignmentCreationsPerMonth)}} заданий</small>
        </span>
        <span v-if="plan.planId===verified?.planId" class="billing-active">Текущий</span>
      </label>
    </div>
    <h2 class="billing-section-label">Продолжительность</h2>
    <div class="billing-periods" role="group" aria-label="Период оплаты">
      <button v-for="option in periodOptions" :key="option.n" type="button"
        :class="{selected:period===option.n}" :aria-pressed="period===option.n"
        @click="period=option.n">{{option.label}}</button>
    </div>
    <div class="billing-summary" v-if="selectedPlan">
      <h2>Предварительный расчёт — не счёт</h2>
      <div class="billing-fact"><span>Тариф</span><strong>{{name(selectedPlan.planId)}}</strong></div>
      <div class="billing-fact"><span>Период</span><strong>{{period}} мес.</strong></div>
      <div class="billing-fact"><span>Скидка</span><strong>{{discount(selectedPlan)||'Нет'}}</strong></div>
      <div class="billing-fact"><span>Предварительная стоимость</span><strong>{{chosenPrice===null?'Недоступно':currency(chosenPrice)}}</strong></div>
      <div class="billing-fact"><span>Текущий тариф</span><strong>{{verified?name(verified.planId):'Не подтверждён'}}</strong></div>
    </div>
    <p class="billing-note">Окончательная цена, зачёт ранее оплаченного периода и условия перехода должны рассчитываться серверным checkout. Этот интерфейс не выставляет счёт и не проводит платёж.</p>
    <div class="billing-footer-actions">
      <button type="button" class="billing-btn" @click="openCompare">Сравнить</button>
      <RouterLink v-if="selectedPlan&&chosenPrice!==null&&selectedPlan.planId!=='free'"
        class="billing-btn primary" data-testid="billing-checkout-link"
        :to="{path:'/settings/payments/checkout',
          query:{plan:selectedPlan.planId,term:String(period)}}">
        Открыть оформление
      </RouterLink>
      <button v-else type="button" class="billing-btn primary" disabled>
        {{selectedPlan?.planId==='free'?'Free не требует оплаты':'Оформление недоступно'}}
      </button>
    </div>
  </template>

  <template v-else-if="screen==='history'">
    <p class="billing-note">Подтверждённая история платежей недоступна: серверного endpoint квитанций пока нет. Вымышленные операции не отображаются.</p>
    <div class="billing-empty">Нет проверенных записей для отображения.</div>
  </template>
</section>
</template>
<style scoped>
/* CSS carried from owner-approved docs/ux/payments-tariffs/style.css / Fieldwork 1.1.
   The unified application header and dock are not duplicated. */
.billing-page{max-width:790px;margin:0 auto;padding-bottom:18px}
.billing-page h1{margin:0;font-size:26px;letter-spacing:-.045em;line-height:1.2}
.billing-page .page-heading{margin-bottom:20px}
.billing-page .page-heading p{margin:6px 0 0;color:#9e9e9e;font-size:11px}
.billing-current{padding:19px 17px;background:#202020;border:1px solid #303030;border-radius:9px;margin-bottom:16px}
.billing-eyebrow{font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:750;color:#a1a1a1}
.billing-plan-name{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:9px}
.billing-plan-name strong{font-size:23px;letter-spacing:-.035em;font-weight:800}
.billing-active{display:inline-flex;align-items:center;gap:6px;color:#a9e8ba;font-size:10px;font-weight:670}
.billing-active i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green)}
.billing-days{font-size:12px;color:#cfcfcf;margin:8px 0 0}
.billing-days strong{color:#fff;font-size:13px}
.billing-actions{display:flex;gap:9px;margin-top:19px}
.billing-btn{min-height:43px;padding:10px 14px;border:1px solid #494949;border-radius:8px;background:#353535;color:#eee;font-size:12px;font-weight:720;display:inline-flex;justify-content:center;align-items:center;gap:8px;text-align:center}
.billing-btn svg{width:16px;height:16px}
.billing-btn.primary{background:var(--green);color:#112719;border-color:var(--green)}
.billing-btn.primary:hover{background:#4ae47c}
.billing-btn:disabled{opacity:.48}
.billing-actions .billing-btn{flex:1;min-width:0}
.billing-muted{color:#a4a4a4;font-size:11px;line-height:1.55}
.billing-section-label{font-weight:740;font-size:12px;margin:19px 0 11px;color:#dadada}
.billing-panel{border-radius:9px;background:#202020;padding:7px 15px;margin-bottom:14px}
.billing-nav-row{display:flex;align-items:center;gap:12px;width:100%;min-height:65px;padding:11px 0;border:0;border-bottom:1px solid #343434;background:transparent;color:#e8e8e8;text-align:left}
.billing-nav-row:last-child{border-bottom:0}
.billing-nav-row>svg:first-child{width:20px;height:20px;color:#b6b6b6}
.billing-nav-row>svg:last-child{width:16px;height:16px;color:#888}
.billing-nav-row>span{min-width:0;flex:1;display:grid;gap:3px}
.billing-nav-row strong{font-size:12.5px;font-weight:720}
.billing-nav-row small{color:#a0a0a0;font-size:11px}
.billing-nav-row:hover strong{color:#fff}
.billing-note{background:#191919;border:1px solid #303030;border-radius:8px;padding:12px 13px;color:#a8a8a8;font-size:11px;line-height:1.6;margin:12px 0}
.billing-note strong{color:#dedede}
.billing-periods{display:flex;gap:7px;flex-wrap:wrap;margin:9px 0 16px}
.billing-periods button{flex:1;min-width:78px;min-height:36px;border:1px solid #454545;background:#262626;color:#b8b8b8;border-radius:7px;padding:8px 7px;font-size:11px;font-weight:680}
.billing-periods button.selected{background:#304234;border-color:#4b895c;color:#e5f3e8}
.billing-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.billing-tier{display:flex;flex-direction:column;gap:9px;background:#202020;border:1px solid #383838;border-radius:9px;padding:16px 13px;min-width:0}
.billing-tier.featured{border-color:#447950;background:#202820}
.billing-tier-top{display:flex;align-items:center;justify-content:space-between;gap:6px}
.billing-tier-top strong{font-size:16px;letter-spacing:-.02em}
.billing-tier-top small{font-size:10px;color:#b1d8ba}
.billing-price{font-size:13px;font-weight:730;line-height:1.4;min-height:38px}
.billing-tier-description{font-size:11px;color:#b9b9b9;line-height:1.5;min-height:34px}
.billing-tier-points{display:grid;gap:9px;margin:3px 0 12px;padding:10px 0;border-top:1px solid #363636}
.billing-tier-points>div{display:flex;align-items:flex-start;gap:6px;font-size:11px;color:#c2c2c2}
.billing-tier-points svg{width:14px;height:14px;color:var(--green)}
.billing-tier .billing-btn{margin-top:auto;width:100%;font-size:11px;padding:10px 6px}
.billing-compare{background:#202020;border-radius:9px;padding:6px 13px 12px;margin:16px 0}
.billing-compare table{border-collapse:collapse;width:100%;font-size:11px}
.billing-compare th{font-weight:700;text-align:left;color:#eee;padding:11px 6px;border-bottom:1px solid #414141}
.billing-compare td{padding:11px 6px;border-bottom:1px solid #353535;color:#bababa;vertical-align:top}
.billing-compare tr:last-child td{border:0}
.billing-compare td:first-child{color:#eee;width:38%}
.billing-select{display:grid;gap:8px;margin-bottom:15px}
.billing-option{position:relative;display:flex;gap:10px;align-items:center;min-height:63px;background:#202020;border:1px solid #373737;border-radius:8px;padding:12px 13px;cursor:pointer}
.billing-option.selected{background:#223026;border-color:#52835d}
.billing-option input{position:absolute;opacity:0;pointer-events:none}
.billing-radio{width:17px;height:17px;border:2px solid #838383;border-radius:50%;flex:none;display:grid;place-items:center}
.billing-option.selected .billing-radio{border-color:var(--green)}
.billing-option.selected .billing-radio:after{content:"";width:7px;height:7px;border-radius:50%;background:var(--green)}
.billing-option-text{display:grid;gap:3px;flex:1}
.billing-option-text strong{font-size:12px;font-weight:720}
.billing-option-text small{color:#aaa;font-size:10.5px}
.billing-option>svg{width:17px;height:17px;color:#888}
.billing-summary{background:#202020;border-radius:9px;border:1px solid #333;padding:14px;margin:12px 0}
.billing-summary h2{font-size:13px;margin:0 0 10px}
.billing-fact{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #363636;font-size:11.5px}
.billing-fact:last-child{border:0}
.billing-fact>span:first-child{color:#a9a9a9}
.billing-fact>strong{text-align:right;font-weight:720;color:#eee}
.billing-footer-actions{display:flex;gap:9px;margin-top:16px}
.billing-footer-actions .billing-btn{flex:1}
.billing-step{color:#a7a7a7;font-size:11px;margin:-5px 0 13px}
.billing-rows{background:#202020;border-radius:9px;padding:4px 13px;margin-top:12px}
.billing-transaction{display:flex;align-items:center;gap:11px;width:100%;border:0;border-bottom:1px solid #393939;background:transparent;text-align:left;padding:13px 2px;min-height:72px}
.billing-transaction:last-child{border-bottom:0}
.billing-transaction-icon{width:34px;height:34px;border-radius:7px;background:#353535;display:grid;place-items:center;color:#ddd}
.billing-transaction-icon svg{width:18px;height:18px}
.billing-transaction-info{display:grid;gap:4px;flex:1;min-width:0}
.billing-transaction-info strong{font-size:12px}
.billing-transaction-info small{font-size:10.5px;color:#aaa}
.billing-transaction-end{text-align:right;display:grid;justify-items:end;gap:4px;font-size:10.5px;color:#aaa}
.billing-status{color:#b7deb9;font-size:10px;font-weight:670}
.billing-status.failed{color:#eba5a5}.billing-status.pending{color:#d9c59b}
.billing-empty{padding:26px 17px;border-radius:9px;background:#202020;color:#aaa;text-align:center;font-size:12px}
.billing-method-icon{width:32px;height:32px;border-radius:7px;background:#333;display:grid;place-items:center;color:#e5e5e5}
.billing-method-icon svg{width:18px;height:18px}
.billing-success{display:grid;justify-items:center;text-align:center;padding:27px 17px;background:#202020;border-radius:9px}
.billing-success-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:9px;background:#264a31;color:var(--green)}
.billing-success-icon svg{width:25px;height:25px}
.billing-success h2{font-size:18px;line-height:1.3;margin:16px 0 6px}
.billing-success p{color:#aaa;font-size:12px;line-height:1.6;margin:0}
.billing-success .billing-btn{margin-top:17px;width:100%}
@media(max-width:670px){.billing-grid{grid-template-columns:1fr}.billing-tier{padding:15px}.billing-tier-points{grid-template-columns:1fr 1fr}.billing-price,.billing-tier-description{min-height:0}.billing-compare{padding:5px 7px}.billing-compare th,.billing-compare td{padding:10px 4px;font-size:10px}}
@media(max-width:370px){.billing-actions{flex-direction:column}.billing-periods{gap:5px}.billing-tier-points{grid-template-columns:1fr}}
.billing-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
.billing-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:#202020;border-radius:9px;padding:12px 9px;gap:8px}
.billing-metrics>div{display:grid;gap:6px;text-align:center;border-right:1px solid #373737;padding:7px 3px}
.billing-metrics>div:last-child{border-right:0}.billing-metrics strong{font-size:19px;color:#e4eee6}
.billing-metrics span{font-size:10px;color:#a8a8a8;line-height:1.3}
.billing-discount{font-size:10.5px;color:#b6e7be;background:#2a392d;border-radius:6px;padding:7px 9px}
.billing-price small{font-size:11px;color:#aaa;font-weight:500}
.billing-compare{overflow-x:auto;scrollbar-width:thin}
.billing-compare table{min-width:690px}
.billing-compare td:not(:first-child){min-width:114px}
.billing-tier.featured{background:#202820;border-color:#3a6946}
.billing-tier .billing-tier-points{grid-template-columns:1fr}
@media(max-width:850px){.billing-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:670px){.billing-grid{grid-template-columns:1fr}.billing-tier{padding:15px}}
.billing-page{--green:#1ed760;max-width:980px;width:100%;padding:24px 16px 100px;color:#f2f2f2}
.billing-page .page-heading{margin:22px 0 20px}
.billing-page .billing-back{color:#b6e6c3;text-decoration:none;font-size:12px}
.billing-secondary-back{margin:0 0 14px}
.billing-page button{cursor:pointer}
.billing-page button:disabled{cursor:not-allowed}
.billing-page .billing-current{max-width:790px}
.billing-page .billing-grid{grid-template-columns:repeat(5,minmax(0,1fr))}
.billing-page .billing-price{min-height:35px}
.billing-page a.billing-btn{text-decoration:none}
.billing-page .billing-price small{display:block}
.billing-page .billing-nav-row:disabled{opacity:.5;cursor:not-allowed}
.billing-page .billing-note button{margin-left:8px}
.billing-page .billing-compare table{min-width:920px}
.billing-page .billing-tier-points>div>span:first-child{color:#1ed760}
@media(max-width:950px){.billing-page .billing-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:660px){.billing-page .billing-grid{grid-template-columns:repeat(1,minmax(0,1fr))}.billing-page .billing-tier-points{grid-template-columns:repeat(2,minmax(0,1fr))}.billing-page .billing-tier{padding:15px}.billing-page .billing-tier-points>div{min-width:0}}
@media(max-width:370px){.billing-page .billing-tier-points{grid-template-columns:1fr}}
</style>