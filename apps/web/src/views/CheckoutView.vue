<script setup lang="ts">
import {computed,onMounted,ref,watch,nextTick} from 'vue'
import {RouterLink,useRoute,useRouter} from 'vue-router'
import {readPublicCatalog,type PublicPlan} from '../features/billing/application/catalog-client'
import {checkoutPrice,checkoutDiscount,selectCheckoutOrder,type CheckoutSelection,type CheckoutTerm}
  from '../features/billing/application/checkout-selection'

const route=useRoute(),router=useRouter()
const plans=ref<PublicPlan[]>([])
const loading=ref(true),error=ref('')
const order=ref<CheckoutSelection|null>(null)
const draft=ref<CheckoutSelection|null>(null),showEditor=ref(false)
const closeButton=ref<HTMLButtonElement|null>(null)
const editorButton=ref<HTMLButtonElement|null>(null)
const editorDialog=ref<HTMLElement|null>(null)
const periodChoices=[1,6,12] as const
const names:Readonly<Record<string,string>>={go:'Go',pro:'Pro',unlimited:'Unlimited',unlimited_plus:'Unlimited+'}
const allowedPlans=computed(()=>plans.value.filter(x=>x.planId!=='free'))
const plan=computed(()=>plans.value.find(x=>x.planId===order.value?.planId))
const draftPlan=computed(()=>plans.value.find(x=>x.planId===draft.value?.planId))
const amount=computed(()=>order.value?checkoutPrice(plan.value,order.value.term):null)
const discount=computed(()=>order.value?checkoutDiscount(plan.value,order.value.term):null)
const draftAmount=computed(()=>draft.value?checkoutPrice(draftPlan.value,draft.value.term):null)
function usd(value:number):string{return '$'+(value/100).toFixed(2)}
function applyUrl():void{
  if(!plans.value.length)return
  order.value=selectCheckoutOrder(plans.value,route.query.plan,route.query.term)
}
watch(()=>[route.query.plan,route.query.term],()=>{if(!showEditor.value)applyUrl()})
async function load():Promise<void>{
  loading.value=true;plans.value=[];order.value=null;error.value=''
  try{plans.value=await readPublicCatalog();applyUrl()}
  catch(e){error.value=e instanceof Error?e.message:'Неизвестная ошибка каталога'}
  finally{loading.value=false}
}
onMounted(()=>{void load()})
async function edit():Promise<void>{
  if(!order.value)return
  draft.value={...order.value};showEditor.value=true
  await nextTick()
  closeButton.value?.focus()
}
function close():void{
  showEditor.value=false
  draft.value=null
  void nextTick(()=>editorButton.value?.focus())
}
function dialogKeydown(event:KeyboardEvent):void{
  if(event.key==='Escape'){
    event.preventDefault();event.stopPropagation();close();return
  }
  if(event.key!=='Tab'||!editorDialog.value)return
  // Owner-approved checkout is a modal inside the existing Shell: keyboard
  // focus cannot escape to the background Header/Dock.
  const items=Array.from(editorDialog.value.querySelectorAll<HTMLButtonElement>(
    'button:not(:disabled)',
  ))
  const first=items[0],last=items[items.length-1]
  if(!first||!last)return
  if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus()
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus()
  }
}
function selectPlan(item:PublicPlan):void{
  if(!draft.value)return
  const term=checkoutPrice(item,draft.value.term)===null?1:draft.value.term
  draft.value={planId:item.planId,term}
}
function selectTerm(term:CheckoutTerm):void{
  if(!draft.value||checkoutPrice(draftPlan.value,term)===null)return
  draft.value={...draft.value,term}
}
async function save():Promise<void>{
  if(!draft.value||draftAmount.value===null)return
  const v={...draft.value}
  close()
  await router.replace({path:'/settings/payments/checkout',
    query:{plan:v.planId,term:String(v.term)}})
  order.value=v
}
</script>

<template>
<section class="checkout-page" data-testid="billing-checkout">
  <header class="page-heading">
    <RouterLink class="back-link" to="/settings/payments"
      aria-label="Вернуться к тарифам">‹</RouterLink>
    <div><h1>Оплата тарифа</h1><p>Подтверждение заказа</p></div>
  </header>
  <p v-if="loading" role="status" data-testid="checkout-loading">Проверка действующего тарифного каталога…</p>
  <p v-else-if="error" role="alert" class="checkout-error">
    Не удалось подтвердить каталог: {{error}}
    <button type="button" class="secondary-button" @click="load">Повторить</button>
  </p>
  <template v-else-if="order&&plan&&amount!==null">
    <section class="surface order-card" aria-label="Ваш заказ" data-testid="checkout-order">
      <div class="order-top">
        <div><span class="eyebrow">Выбранный тариф</span>
          <div class="order-name">{{names[plan.planId]}}</div>
          <span class="order-term">{{order.term}} мес.</span>
        </div>
        <div class="order-price"><strong>{{usd(amount)}}</strong>
          <small>По каталогу · USD</small></div>
      </div>
      <div class="order-divider"></div>
      <div class="summary-row"><span>Тариф</span><strong>{{names[plan.planId]}}</strong></div>
      <div class="summary-row"><span>Период</span><strong>{{order.term}} мес.</strong></div>
      <div class="summary-row"><span>Базовая цена</span>
        <strong>{{usd(plan.monthlyPriceCents*order.term)}}</strong></div>
      <div class="summary-row"><span>Скидка</span>
        <strong>{{discount===null?'Не рассчитана':usd(discount)}}</strong></div>
      <div class="summary-row total"><span>Предварительно</span>
        <strong data-testid="checkout-total">{{usd(amount)}}</strong></div>
      <button ref="editorButton" type="button" class="order-edit" data-testid="checkout-edit-order"
        @click="edit">Изменить тариф и период</button>
    </section>
    <p class="plan-context warn" data-testid="checkout-no-invoice">
      Это предварительный расчёт по актуальному тарифному каталогу, а не инвойс.
      Комиссии, сеть, токен и итог оплаты должны подтверждаться сервером.
    </p>
    <h2 class="section-label">Способ оплаты</h2>
    <div class="method-list" role="group" aria-label="Способ оплаты">
      <div class="method-row selected">
        <span class="method-mark" aria-hidden="true">◈</span>
        <span class="method-copy"><strong>Криптокошелёк · DePay</strong>
          <small>Шлюз пока не подключён к проверенному серверному settlement</small></span>
        <span class="method-radio" aria-hidden="true"></span>
      </div>
      <div class="method-row unavailable" aria-disabled="true">
        <span class="method-mark" aria-hidden="true">+</span>
        <span class="method-copy"><strong>Другие способы</strong><small>Будут добавлены после проверки</small></span>
        <span class="method-radio">Позже</span>
      </div>
    </div>
    <p class="methods-help">Сеть, токен и кошелёк выбираются у платёжного провайдера, а не в PhotoBunker.</p>
    <div class="info-line" role="status">
      <span aria-hidden="true">ⓘ</span>
      <p><strong>Оплата сейчас недоступна.</strong> Без проверенного инвойса и DePay нельзя
        начинать транзакцию или утверждать, что подписка оплачена.</p>
    </div>
    <footer class="payment-footer">
      <div class="payment-footer-inner">
        <button type="button" class="pay-button" disabled data-testid="checkout-pay">
          Продолжить с DePay · {{usd(amount)}}
        </button>
        <p class="pay-note">Действие включится после подключения и проверки платёжного шлюза.</p>
      </div>
    </footer>
  </template>
  <p v-else role="alert" class="checkout-error">Нет подтверждённых платных тарифов для выбора.</p>
  <div v-if="showEditor&&draft" class="overlay" @click.self="close" @keydown="dialogKeydown">
    <section ref="editorDialog" class="sheet" role="dialog" aria-modal="true" aria-labelledby="edit-checkout-title"
      data-testid="checkout-editor">
      <div class="sheet-head"><strong id="edit-checkout-title">Изменить заказ</strong>
        <button ref="closeButton" type="button" aria-label="Закрыть" @click="close">×</button>
      </div>
      <span class="field-title">Тариф</span>
      <div class="plan-choices" role="group" aria-label="Тариф">
        <button v-for="item in allowedPlans" :key="item.planId" type="button"
          :class="{selected:draft.planId===item.planId}"
          :aria-pressed="draft.planId===item.planId"
          :data-testid="'checkout-plan-'+item.planId" @click="selectPlan(item)">{{names[item.planId]}}</button>
      </div>
      <span class="field-title">Период</span>
      <div class="term-choices" role="group" aria-label="Период">
        <button v-for="term in periodChoices" :key="term" type="button"
          :class="{selected:draft.term===term}" :aria-pressed="draft.term===term"
          :disabled="checkoutPrice(draftPlan,term)===null"
          :data-testid="'checkout-term-'+term" @click="selectTerm(term)">{{term}} мес.</button>
      </div>
      <div class="sheet-total"><span>Предварительно (не инвойс)</span>
        <strong>{{draftAmount===null?'—':usd(draftAmount)}}</strong>
      </div>
      <div class="sheet-buttons">
        <button type="button" class="secondary-button" @click="close">Отмена</button>
        <button type="button" class="pay-button" :disabled="draftAmount===null"
          data-testid="checkout-apply" @click="save">Применить</button>
      </div>
    </section>
  </div>
</section>
</template>
<style scoped>
/* Existing Fieldwork Shell owns Header and Dock. Control geometry from approved UX Checkout 1.0. */
.method-list{background:var(--surface);border-radius:9px;overflow:hidden}.method-row{width:100%;min-height:76px;display:flex;align-items:center;gap:12px;text-align:left;border:0;background:none;padding:14px 15px}.method-row+.method-row{border-top:1px solid #353535}.method-row.selected{background:#232f26}.method-mark{height:39px;width:39px;border-radius:9px;display:grid;place-items:center;background:#343c36;border:1px solid #3b5945;flex:none;color:#bdedcb}.method-mark svg{width:21px;height:21px}.method-row:not(.selected) .method-mark{background:#303030;border-color:#414141;color:#adadad}.method-copy{flex:1;min-width:0;display:grid;gap:3px}.method-copy strong{color:#ececec;font-size:12.5px;font-weight:740}.method-copy small{font-size:10.5px;color:#a1a1a1;line-height:1.4}.method-radio{height:18px;width:18px;border:2px solid #777;border-radius:50%;flex:none;display:grid;place-items:center}.method-row.selected .method-radio{border-color:var(--green)}.method-row.selected .method-radio:after{content:"";width:8px;height:8px;border-radius:50%;background:var(--green)}.method-row.unavailable{opacity:.55;cursor:not-allowed}.method-row.unavailable .method-radio{width:auto;height:auto;border:0;color:#aaa;font-size:10px;white-space:nowrap}.methods-help{margin:9px 2px 0;font-size:10.7px;color:#999;line-height:1.55}.info-line{display:flex;gap:10px;background:#1a1a1a;border:1px solid #303030;border-radius:8px;padding:12px;margin-top:17px;align-items:flex-start}.info-line svg{height:18px;width:18px;color:#aaa;margin-top:1px}.info-line p{margin:0;color:#a9a9a9;line-height:1.55;font-size:10.8px}.info-line strong{color:#dadada}.payment-footer{padding:10px 14px calc(10px + env(safe-area-inset-bottom, 0px));background:#181818;border-top:1px solid #333;flex:none}.payment-footer-inner{max-width:707px;margin:auto;display:grid;gap:8px}.pay-button{display:flex;justify-content:center;align-items:center;gap:10px;width:100%;min-height:46px;border:0;background:var(--green);border-radius:8px;color:#102517;font-weight:770;font-size:12.5px;padding:10px 13px}.pay-button svg{width:18px;height:18px}.pay-button:hover{background:#41e374}.pay-note{font-size:10px;color:#a0a0a0;text-align:center;line-height:1.4}.secondary-button{min-height:43px;background:#343434;border:1px solid #464646;border-radius:8px;font-size:12px;font-weight:710;padding:10px 15px}.app-dock{height:var(--dock-h);flex:0 0 var(--dock-h);display:grid;grid-template-columns:repeat(5,minmax(0,1fr));padding:9px 2px 14px;background:var(--header);border-top:1px solid #303030}.app-dock button{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:7px;border:0;background:none;color:#999;padding:2px;min-width:0;height:54px}.app-dock button.active{color:var(--green)}.app-dock svg{height:23px;width:23px}.app-dock small{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
.overlay{position:absolute;z-index:10;inset:0;background:#000b;display:flex;align-items:flex-end;justify-content:center}.sheet{width:100%;max-height:90%;overflow-y:auto;background:#292929;border-radius:13px 13px 0 0;padding:17px 16px 22px;box-shadow:0 -10px 25px #0005}.sheet-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.sheet-head strong{font-size:16px;font-weight:770}.sheet-head button{background:transparent;border:0;display:grid;place-items:center;width:31px;height:31px;border-radius:7px}.sheet-head button svg{width:19px}.field-title{font-size:11.5px;color:#ddd;font-weight:710;display:block;margin-bottom:8px}.plan-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.plan-choices button,.term-choices button{min-height:41px;border:1px solid #464646;border-radius:7px;background:#343434;font-size:11px;font-weight:690}.plan-choices button.selected,.term-choices button.selected{border-color:#4c8658;background:#284331;color:#dff9e5}.term-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:0 0 17px}.sheet-total{display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid #414141;padding:16px 0;margin:16px 0 1px}.sheet-total span{color:#aaa;font-size:11px}.sheet-total strong{font-size:20px}.sheet-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sheet-buttons>button{width:100%}.toast{position:absolute;z-index:15;top:calc(var(--header-h) + 9px);left:50%;transform:translateX(-50%);background:#344639;color:#e1f6e8;padding:10px 13px;border-radius:8px;box-shadow:0 8px 22px #0009;font-size:11px;white-space:normal;text-align:center;max-width:calc(100% - 30px);pointer-events:none}
.checkout-page{--green:var(--accent,#1ed760);--surface:#202020;--warn:#e7c995;
  --muted:#a4a4a4;width:100%;max-width:735px;margin:0 auto;padding:24px 14px 100px;color:#f3f3f3}
.checkout-page .page-heading{display:flex;gap:12px}
.checkout-page .back-link{color:#b6e5c2;font-size:25px;text-decoration:none}
.checkout-page .order-card{border:1px solid #363636}
.checkout-page .method-row{cursor:default}
.checkout-page .method-mark{font-size:25px}
.checkout-page .payment-footer{position:sticky;bottom:0;z-index:4;border-radius:9px;margin-top:23px}
.checkout-page .pay-button:disabled{background:#41594a;color:#cfdad0;opacity:.65;cursor:not-allowed}
.checkout-page .overlay{position:fixed;inset:0;z-index:60}
.checkout-page .sheet{max-width:480px;align-self:flex-end;margin:0 auto;
  border:1px solid #515151;background:#292929;color:#f4f4f4}
.checkout-page .sheet .field-title{margin-top:16px}
.checkout-page .checkout-error{padding:14px;color:#f0aca9;border:1px solid #865656;border-radius:8px}
@media(min-width:850px){.checkout-page .payment-footer-inner{display:flex;align-items:center;
  justify-content:space-between;gap:15px}.checkout-page .pay-note{order:-1;text-align:left}}
</style>