import {describe,expect,it} from 'vitest'
import {checkoutPrice,checkoutDiscount,selectCheckoutOrder} from './checkout-selection'
import type {PublicPlan} from './catalog-client'
function p(planId:PublicPlan['planId'],monthly=2000):PublicPlan{
  return {planId,monthlyPriceCents:monthly,periodPricesCents:planId==='free'
    ?{'1':0}:{'1':monthly,'6':monthly*5,'12':monthly*9},
    limits:{} as PublicPlan['limits'],featureFlags:{} as PublicPlan['featureFlags']}
}
const plans=[p('free',0),p('go'),p('pro',3000),p('unlimited',5000)]
describe('Checkout 1.0 never trusts URL as a payment invoice',()=>{
  it('accepts only server-present paid plans and supported periods',()=>{
    expect(selectCheckoutOrder(plans,'go','6')).toEqual({planId:'go',term:6})
    expect(selectCheckoutOrder(plans,'unlimited','12')).toEqual({planId:'unlimited',term:12})
    expect(selectCheckoutOrder(plans,'admin','12')).toEqual({planId:'go',term:12})
    expect(selectCheckoutOrder(plans,'free','9')).toEqual({planId:'go',term:1})
    expect(selectCheckoutOrder([], 'go','1')).toBeNull()
  })
  it('totals and discount derive solely from verified catalog',()=>{
    expect(checkoutPrice(plans[1],6)).toBe(10000)
    expect(checkoutDiscount(plans[1],6)).toBe(2000)
    expect(checkoutPrice(undefined,6)).toBeNull()
  })
})
