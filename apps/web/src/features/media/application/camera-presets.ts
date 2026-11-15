import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {b64,unb64} from '../../identity/infrastructure/crypto'
import {AUDIO_TARGET_BITRATES} from '../domain/recording-options'
import type {AudioTargetBitrate} from '../domain/recording-options'

export type CameraPhotoAspect='1:1'|'4:3'|'3:2'|'16:9'
export type CameraPhotoQuality='maximum'|'high'|'medium'|'low'
export type CameraVideoQuality='480p'|'720p'|'1080p'
export interface CameraPresetSettings{
  photoAspect:CameraPhotoAspect
  photoQuality:CameraPhotoQuality
  photoStorage:'p1'|'p2'
  videoQuality:CameraVideoQuality
  videoMaxSeconds:number
  audioMaxSeconds:number
  audioTargetBitrate:AudioTargetBitrate
  gridVisible:boolean
  gpsStatusVisible:boolean
}
export interface CameraPreset{
  id:string;name:string;settings:CameraPresetSettings
}
export interface CameraPresetCatalog{
  version:1;selectedId:string;presets:CameraPreset[]
}
type SealedCameraPreset={key:string;version:1;revision:number;iv:string;ciphertext:string}
class CameraPresetDb extends Dexie{
  rows!:Table<SealedCameraPreset,string>
  constructor(){
    super('pb3-camera-encrypted-presets-v1')
    this.version(1).stores({rows:'&key'})
  }
}
const db=new CameraPresetDb()
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true})
const MAX_PRESETS=8
const quality=['maximum','high','medium','low'] as const
const aspects=['1:1','4:3','3:2','16:9'] as const
const videos=['480p','720p','1080p'] as const
const defaultSettings:CameraPresetSettings={
  photoAspect:'4:3',photoQuality:'high',photoStorage:'p1',
  videoQuality:'720p',videoMaxSeconds:300,audioMaxSeconds:3000,
  audioTargetBitrate:128000,gridVisible:false,gpsStatusVisible:true,
}
export function defaultCameraPresetCatalog():CameraPresetCatalog{
  return {version:1,selectedId:'default',presets:[{
    id:'default',name:'По умолчанию',settings:{...defaultSettings},
  }]}
}
function validEnum<T extends string>(v:unknown,values:readonly T[]):v is T{
  return typeof v==='string'&&values.includes(v as T)
}
function validBound(n:unknown,min:number,max:number):n is number{
  return typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max
}
export function validateCameraPresetSettings(raw:unknown):CameraPresetSettings{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('camera.preset_invalid')
  const s=raw as Record<string,unknown>
  if(Object.keys(s).length!==9
    ||!validEnum(s.photoAspect,aspects)||!validEnum(s.photoQuality,quality)
    ||!validEnum(s.photoStorage,['p1','p2'])
    ||!validEnum(s.videoQuality,videos)
    ||!validBound(s.videoMaxSeconds,5,300)
    ||!validBound(s.audioMaxSeconds,5,3000)
    ||!validBound(s.audioTargetBitrate,64000,256000)
    ||!(AUDIO_TARGET_BITRATES as readonly number[]).includes(s.audioTargetBitrate as number)
    ||typeof s.gridVisible!=='boolean'||typeof s.gpsStatusVisible!=='boolean')
    throw Error('camera.preset_invalid')
  return {
    photoAspect:s.photoAspect as CameraPhotoAspect,
    photoQuality:s.photoQuality as CameraPhotoQuality,
    photoStorage:s.photoStorage as 'p1'|'p2',
    videoQuality:s.videoQuality as CameraVideoQuality,
    videoMaxSeconds:s.videoMaxSeconds as number,
    audioMaxSeconds:s.audioMaxSeconds as number,
    audioTargetBitrate:s.audioTargetBitrate as AudioTargetBitrate,
    gridVisible:s.gridVisible as boolean,
    gpsStatusVisible:s.gpsStatusVisible as boolean,
  }
}
export function validateCameraPresetCatalog(raw:unknown):CameraPresetCatalog{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('camera.preset_invalid')
  const obj=raw as Record<string,unknown>
  if(obj.version!==1||!Array.isArray(obj.presets)
    ||obj.presets.length<1||obj.presets.length>MAX_PRESETS
    ||typeof obj.selectedId!=='string')
    throw Error('camera.preset_invalid')
  const seenIds=new Set<string>(),seenNames=new Set<string>()
  const presets:CameraPreset[]=obj.presets.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw Error('camera.preset_invalid')
    const p=value as Record<string,unknown>
    if(typeof p.id!=='string'
      ||!(p.id==='default'||/^custom-[0-9a-f-]{36}$/.test(p.id))
      ||typeof p.name!=='string'||p.name.trim()!==p.name
      ||p.name.length<1||p.name.length>36
      ||seenIds.has(p.id)||seenNames.has(p.name.toLocaleLowerCase('ru-RU')))
      throw Error('camera.preset_invalid')
    seenIds.add(p.id);seenNames.add(p.name.toLocaleLowerCase('ru-RU'))
    return {id:p.id,name:p.name,settings:validateCameraPresetSettings(p.settings)}
  })
  if(!seenIds.has(obj.selectedId)||presets[0]!.id!=='default')
    throw Error('camera.preset_invalid')
  return {version:1,selectedId:obj.selectedId,presets}
}
function scoped(s:Session):string{return s.accountId+'/'+s.deviceId}
function assertSame(s:Session):void{
  if(activeSession.value!==s)throw Error('identity.account_changed')
}
function aad(s:Session,revision:number):Uint8Array<ArrayBuffer>{
  return encoder.encode(JSON.stringify({domain:'pb3/camera/device-presets/v1',
    accountId:s.accountId,deviceId:s.deviceId,revision}))
}
async function decrypt(s:Session,row:SealedCameraPreset|undefined):Promise<CameraPresetCatalog>{
  assertSame(s)
  if(!row)return defaultCameraPresetCatalog()
  if(row.version!==1||row.key!==scoped(s)||!validBound(row.revision,1,100000000)
    ||row.iv.length>64||row.ciphertext.length>9000)
    throw Error('camera.preset_invalid')
  const iv=unb64(row.iv,12),cipher=unb64(row.ciphertext)
  if(cipher.length<17||cipher.length>6000)throw Error('camera.preset_invalid')
  const plain=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv,additionalData:aad(s,row.revision),tagLength:128,
  },s.device.encryptionKey,cipher))
  try{
    assertSame(s)
    return validateCameraPresetCatalog(JSON.parse(decoder.decode(plain)) as unknown)
  }finally{plain.fill(0)}
}
async function encrypt(s:Session,catalog:CameraPresetCatalog,revision:number):
Promise<SealedCameraPreset>{
  const verified=validateCameraPresetCatalog(catalog)
  const plain=encoder.encode(JSON.stringify(verified))
  if(plain.length>5800)throw Error('camera.preset_invalid')
  const iv=crypto.getRandomValues(new Uint8Array(12))
  try{
    assertSame(s)
    const cipher=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:aad(s,revision),tagLength:128,
    },s.device.encryptionKey,plain)
    assertSame(s)
    return {key:scoped(s),version:1,revision,iv:b64(iv),ciphertext:b64(cipher)}
  }finally{plain.fill(0)}
}
export async function loadCameraPresetCatalog():Promise<CameraPresetCatalog>{
  const s=requireSession(),row=await db.rows.get(scoped(s))
  return decrypt(s,row)
}
type Change={kind:'save';id:string;name:string;settings:CameraPresetSettings}
  |{kind:'add';name:string;settings:CameraPresetSettings}
  |{kind:'select';id:string}
function apply(c:CameraPresetCatalog,change:Change):CameraPresetCatalog{
  if(change.kind==='select'){
    if(!c.presets.some(p=>p.id===change.id))throw Error('camera.preset_missing')
    return {...c,selectedId:change.id}
  }
  const name=change.name.trim()
  if(name.length<1||name.length>36)throw Error('camera.preset_invalid')
  const settings=validateCameraPresetSettings(change.settings)
  const conflicts=c.presets.some(p=>p.name.toLocaleLowerCase('ru-RU')
    ===name.toLocaleLowerCase('ru-RU')
      &&(change.kind==='add'||p.id!==change.id))
  if(conflicts)throw Error('camera.preset_duplicate')
  if(change.kind==='add'){
    if(c.presets.length>=MAX_PRESETS)throw Error('camera.preset_limit')
    const id='custom-'+crypto.randomUUID()
    return {...c,selectedId:id,presets:[...c.presets,{id,name,settings}]}
  }
  if(!c.presets.some(p=>p.id===change.id))throw Error('camera.preset_missing')
  return {...c,presets:c.presets.map(p=>p.id===change.id?{id:p.id,name,settings}:p)}
}
async function commit(s:Session,change:Change):Promise<CameraPresetCatalog>{
  for(let attempt=0;attempt<4;attempt++){
    assertSame(s)
    const previous=await db.rows.get(scoped(s))
    const catalog=await decrypt(s,previous)
    const next=apply(catalog,change)
    const sealed=await encrypt(s,next,(previous?.revision??0)+1)
    try{
      await db.transaction('rw',db.rows,async()=>{
        const latest=await db.rows.get(scoped(s))
        if((latest?.revision??0)!==(previous?.revision??0))
          throw Error('camera.preset_write_race')
        assertSame(s)
        await db.rows.put(sealed)
      })
      assertSame(s)
      return next
    }catch(e){
      if(e instanceof Error&&e.message==='camera.preset_write_race'&&attempt<3)
        continue
      throw e
    }
  }
  throw Error('camera.preset_write_race')
}
export async function changeCameraPreset(change:Change):Promise<CameraPresetCatalog>{
  const s=requireSession()
  if(typeof navigator!=='undefined'&&navigator.locks?.request)
    return navigator.locks.request('pb3/camera/presets/'+scoped(s),()=>commit(s,change))
  return commit(s,change)
}
