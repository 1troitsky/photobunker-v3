/** Strictly local presentation preference, never evidence retention policy. */
export const BROWSER_DAYS_LEFT_KEY='pb3-browser-days-left-v1'

export interface BrowserDaysStorage{
  getItem(key:string):string|null
  setItem(key:string,value:string):void
}
function deviceStorage():BrowserDaysStorage|null{
  try{return typeof window==='undefined'?null:window.localStorage}
  catch{return null}
}
export function readBrowserDaysLeft(
  storage:BrowserDaysStorage|null=deviceStorage(),
):boolean{
  try{return storage?.getItem(BROWSER_DAYS_LEFT_KEY)==='1'}
  catch{return false}
}
export function saveBrowserDaysLeft(
  value:boolean,storage:BrowserDaysStorage|null=deviceStorage(),
):boolean{
  try{
    if(!storage)return false
    storage.setItem(BROWSER_DAYS_LEFT_KEY,value?'1':'0')
    return true
  }catch{return false}
}
/** Display-only; the returned label never authorizes extending a signed TTL. */
export function browserRetentionLabel(
  expiresAt:number,now:number,showRemainingDays:boolean,
):string{
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=0
    ||expiresAt>8_640_000_000_000_000||!Number.isFinite(now))
    return 'Срок хранения неизвестен'
  if(!showRemainingDays)
    return 'Хранение до '+new Date(expiresAt).toLocaleDateString('ru-RU')
  if(expiresAt<=now)return 'Срок хранения истёк'
  const days=Math.ceil((expiresAt-now)/86400000)
  const mod100=days%100,mod10=days%10
  const noun=mod100>=11&&mod100<=14?'дней'
    :mod10===1?'день':mod10>=2&&mod10<=4?'дня':'дней'
  return 'Осталось: '+days+' '+noun
}
