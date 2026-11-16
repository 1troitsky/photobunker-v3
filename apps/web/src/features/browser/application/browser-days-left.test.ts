import {describe,expect,it} from 'vitest'
import {BROWSER_DAYS_LEFT_KEY,browserRetentionLabel,
  readBrowserDaysLeft,saveBrowserDaysLeft} from './browser-days-left'

describe('Browser v3 remaining days is a display-only device choice',()=>{
  it('matches accepted defaults and persists only a boolean',()=>{
    const values=new Map<string,string>()
    const storage={
      getItem:(key:string)=>values.get(key)??null,
      setItem:(key:string,value:string)=>{values.set(key,value)},
    }
    expect(readBrowserDaysLeft(storage)).toBe(false)
    expect(saveBrowserDaysLeft(true,storage)).toBe(true)
    expect(values.get(BROWSER_DAYS_LEFT_KEY)).toBe('1')
    expect(readBrowserDaysLeft(storage)).toBe(true)
    expect(saveBrowserDaysLeft(false,storage)).toBe(true)
    expect(values.get(BROWSER_DAYS_LEFT_KEY)).toBe('0')
    expect(readBrowserDaysLeft(storage)).toBe(false)
    expect(values.size).toBe(1)
  })
  it('refuses malformed, blocked or absent storage without disclosing anything',()=>{
    const malformed={
      getItem:()=>'{"gps":true,"showDays":true}',
      setItem:()=>{throw Error('blocked')},
    }
    expect(readBrowserDaysLeft(malformed)).toBe(false)
    expect(saveBrowserDaysLeft(true,malformed)).toBe(false)
    expect(readBrowserDaysLeft(null)).toBe(false)
    expect(saveBrowserDaysLeft(true,null)).toBe(false)
  })
  it('uses correct day forms and makes no claim that expired ciphertext was removed',()=>{
    const at=Date.UTC(2026,10,16,8)
    for(const [days,name] of [
      [1,'1 день'],[2,'2 дня'],[4,'4 дня'],[5,'5 дней'],
      [11,'11 дней'],[14,'14 дней'],[21,'21 день'],[22,'22 дня'],
    ] as const)expect(browserRetentionLabel(at+days*86400000,at,true))
      .toBe('Осталось: '+name)
    expect(browserRetentionLabel(at,at,true)).toBe('Срок хранения истёк')
    expect(browserRetentionLabel(at-1,at,true)).toBe('Срок хранения истёк')
    expect(browserRetentionLabel(NaN,at,true)).toBe('Срок хранения неизвестен')
    expect(browserRetentionLabel(0,at,false)).toBe('Срок хранения неизвестен')
    expect(browserRetentionLabel(Infinity,at,true)).toBe('Срок хранения неизвестен')
    expect(browserRetentionLabel(Number.MAX_SAFE_INTEGER,at,false))
      .toBe('Срок хранения неизвестен')
    expect(browserRetentionLabel(at+86400000,at,false))
      .toContain('Хранение до ')
  })
})
