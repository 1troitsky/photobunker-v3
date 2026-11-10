import Dexie, {type Table} from 'dexie'
import {computed,shallowRef} from 'vue'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {b64,unb64,digest,hex,random} from '../../identity/infrastructure/crypto'

// Only functional routes may be selected. Notifications is part of the
// accepted catalog but remains disabled until a real inbox is implemented.
export const DOCK_CATALOG=[
  {id:'assignments',label:'Задания',to:'/assignments',icon:'tasks',available:true},
  {id:'browser',label:'Browser',to:'/browser',icon:'folder',available:true},
  {id:'camera',label:'Камера',to:'/camera',icon:'camera',available:true},
  {id:'notifications',label:'Уведомления',to:'/notifications',icon:'bell',available:false},
  {id:'contacts',label:'Контакты',to:'/contacts',icon:'users',available:true},
  {id:'messages',label:'Сообщения',to:'/messages',icon:'message',available:true},
  {id:'settings',label:'Настройки',to:'/settings',icon:'settings',available:true},
] as const
export type DockId=(typeof DOCK_CATALOG)[number]['id']
export const DEFAULT_DOCK:readonly DockId[]=[
  'assignments','browser','camera','contacts','settings',
]
export const appliedDock=shallowRef<readonly DockId[]>([...DEFAULT_DOCK])
export const previewDock=shallowRef<readonly DockId[]|null>(null)
export const visibleDock=computed(()=>previewDock.value??appliedDock.value)
export const dockLoadError=shallowRef('')

type EncryptedDockRow={scope:string;iv:string;ciphertext:string}
const domain='pb3.appearance.dock.v1'
const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
class AppearanceDB extends Dexie{
  prefs!:Table<EncryptedDockRow,string>
  constructor(){
    super('pb3-encrypted-appearance-dock-v1')
    this.version(1).stores({prefs:'&scope'})
  }
}
const db=new AppearanceDB()
let generation=0

export function validateDock(value:unknown):DockId[]{
  if(!Array.isArray(value)||value.length<3||value.length>6)
    throw Error('appearance.dock_count')
  const ids=value as unknown[]
  if(ids.some(x=>typeof x!=='string' ||
    !DOCK_CATALOG.some(d=>d.id===x&&d.available)))
    throw Error('appearance.dock_unknown')
  if(new Set(ids).size!==ids.length)
    throw Error('appearance.dock_duplicate')
  if(!ids.includes('settings'))
    throw Error('appearance.dock_settings_required')
  return [...ids] as DockId[]
}
function decode(value:unknown):DockId[]{
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join('|')!=='dock|version')
    throw Error('appearance.invalid_record')
  const v=value as {version?:unknown;dock?:unknown}
  if(v.version!==1)throw Error('appearance.invalid_record')
  return validateDock(v.dock)
}
function same(s:Session):void{
  const now=activeSession.value
  if(!now||now.accountId!==s.accountId||now.deviceId!==s.deviceId
    ||now.pkg.akek!==s.pkg.akek
    ||now.pkg.accountSpki!==s.pkg.accountSpki
    ||now.pkg.revision!==s.pkg.revision)
    throw Error('identity.changed')
}
async function scopeOf(s:Session):Promise<string>{
  return hex(await digest(enc.encode(domain+'\n'+s.accountId)))
}
async function derivedKey(s:Session,usage:KeyUsage):Promise<CryptoKey>{
  const material=unb64(s.pkg.akek,32)
  let root:CryptoKey
  try{
    root=await crypto.subtle.importKey('raw',material,'HKDF',false,['deriveKey'])
  }finally{material.fill(0)}
  // Domain-separated subkey; no reuse of the AKEK directly as an AES key.
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',salt:enc.encode(domain),
    info:enc.encode(s.accountId+'\npreferences'),
  },root,{name:'AES-GCM',length:256},false,[usage])
}
function aad(scope:string):Uint8Array<ArrayBuffer>{
  return enc.encode(domain+'\n'+scope)
}
/** Load only this signed-in account's local preferences; never await HTTP. */
export async function loadDock():Promise<void>{
  const token=++generation
  const s=activeSession.value
  previewDock.value=null
  appliedDock.value=[...DEFAULT_DOCK]
  dockLoadError.value=''
  if(!s)return
  try{
    const scope=await scopeOf(s)
    same(s)
    const row=await db.prefs.get(scope)
    same(s)
    if(!row)return
    if(row.scope!==scope)throw Error('appearance.scope_mismatch')
    let raw:ArrayBuffer
    try{
      raw=await crypto.subtle.decrypt({
        name:'AES-GCM',iv:unb64(row.iv,12),additionalData:aad(scope),
        tagLength:128,
      },await derivedKey(s,'decrypt'),unb64(row.ciphertext))
    }catch{throw Error('appearance.decrypt_failed')}
    const selected=decode(JSON.parse(dec.decode(raw)) as unknown)
    same(s)
    if(token===generation)appliedDock.value=selected
  }catch(e){
    if(token===generation&&activeSession.value?.accountId===s.accountId){
      dockLoadError.value=e instanceof Error?e.message:'appearance.unavailable'
    }
    throw e
  }
}
/** One atomic encrypted IndexedDB update. Commit the visible Dock after ACK. */
export async function saveDock(selection:unknown):Promise<void>{
  const values=validateDock(selection)
  const s=requireSession()
  const token=++generation
  same(s)
  const scope=await scopeOf(s)
  const iv=random(12)
  const cipher=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:aad(scope),tagLength:128,
  },await derivedKey(s,'encrypt'),enc.encode(JSON.stringify({
    version:1,dock:values,
  })))
  same(s)
  await db.prefs.put({scope,iv:b64(iv),ciphertext:b64(cipher)})
  same(s)
  if(token===generation){
    appliedDock.value=[...values]
    dockLoadError.value=''
  }
}
