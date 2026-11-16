import type {PublicPlan} from './catalog-client'

export type CheckoutTerm=1|6|12
export interface CheckoutSelection {planId:PublicPlan['planId'];term:CheckoutTerm}
const terms=[1,6,12] as const
const paid=['go','pro','unlimited','unlimited_plus'] as const

/** URL values are untrusted *display preferences*, not a price, invoice or entitlement. */
export function selectCheckoutOrder(
  plans:readonly PublicPlan[], rawPlan:unknown,rawTerm:unknown,
):CheckoutSelection|null {
  const candidates=plans.filter(p=>paid.includes(p.planId as typeof paid[number]))
  if(!candidates.length)return null
  const wanted=typeof rawPlan==='string'&&paid.some(id=>id===rawPlan)
    ?candidates.find(p=>p.planId===rawPlan)
    :null
  const plan=wanted??candidates[0]!
  const term=terms.find(n=>String(n)===rawTerm && Number.isSafeInteger(plan.periodPricesCents[String(n)]))??1
  if(!Number.isSafeInteger(plan.periodPricesCents[String(term)]))return null
  return {planId:plan.planId,term}
}
export function checkoutPrice(plan:PublicPlan|undefined,term:CheckoutTerm):number|null {
  if(!plan)return null
  const cents=plan.periodPricesCents[String(term)]
  return typeof cents==='number'&&Number.isSafeInteger(cents)&&cents>=0?cents:null
}
export function checkoutDiscount(plan:PublicPlan|undefined,term:CheckoutTerm):number|null {
  if(!plan)return null
  const amount=checkoutPrice(plan,term)
  if(amount===null||plan.monthlyPriceCents<0)return null
  return Math.max(0,plan.monthlyPriceCents*term-amount)
}
