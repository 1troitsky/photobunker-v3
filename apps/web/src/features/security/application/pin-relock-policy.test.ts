import {describe,expect,it} from 'vitest'
import {
  PIN_RELOCK_DEFAULT_MS,PIN_RELOCK_MAX_MS,
  mustRelockPinAfterBackground,validPinRelockDelayMs,
} from './pin-relock-policy'

describe('P3 #220 PIN background lock policy (no user timeout enabled)',()=>{
  it('defaults to Immediate for PIN-protected sessions',()=>{
    expect(PIN_RELOCK_DEFAULT_MS).toBe(0)
    expect(mustRelockPinAfterBackground(2000,2000)).toBe(true)
  })

  it('accepts only integer 0..300000ms for eventual authenticated setting',()=>{
    for(const value of [0,1,1000,60_000,180_000,PIN_RELOCK_MAX_MS])
      expect(validPinRelockDelayMs(value)).toBe(value)
    for(const value of [-1,300_001,1.5,NaN,Infinity,undefined,null,'300000',{},true])
      expect(()=>validPinRelockDelayMs(value)).toThrow('pin.invalid_relock_delay')
  })

  it('supports inclusive deadline and short hide/show without early lock',()=>{
    expect(mustRelockPinAfterBackground(10_000,10_499,500)).toBe(false)
    expect(mustRelockPinAfterBackground(10_000,10_500,500)).toBe(true)
    expect(mustRelockPinAfterBackground(10_000,10_501,500)).toBe(true)
  })

  it('does not trust missing, invalid or clock-rolled-back background timing',()=>{
    for(const start of [undefined,null,'1000',-1,NaN,Infinity])
      expect(mustRelockPinAfterBackground(start,1200,5000)).toBe(true)
    for(const now of [undefined,null,'1200',-1,NaN,Infinity])
      expect(mustRelockPinAfterBackground(1000,now,5000)).toBe(true)
    expect(mustRelockPinAfterBackground(1000,999,300_000)).toBe(true)
  })

  it('catches throttled or entirely suspended background timers on resume',()=>{
    expect(mustRelockPinAfterBackground(0,300_000,300_000)).toBe(true)
    expect(mustRelockPinAfterBackground(0,299_999,300_000)).toBe(false)
    expect(mustRelockPinAfterBackground(0,15_000,0)).toBe(true)
  })
})
