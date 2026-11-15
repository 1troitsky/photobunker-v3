import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { b64, unb64, random, digest, hex } from '../../identity/infrastructure/crypto'

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', {fatal:true})
const domain = 'pb3.local-profile.v1\n'
export type Visibility = 'everyone'|'contacts'|'team'|'nobody'
export type Profile = {
  version:1
  name:string
  username:string
  about:string
  cardVisibility:Visibility
  teamsVisibility:Visibility
  presenceVisibility:Visibility
}
type CipherRow = {scope:string;iv:string;ciphertext:string}
class ProfileDB extends Dexie {
  profiles!:Table<CipherRow,string>
  constructor(){ super('pb3-encrypted-profile-v1');this.version(1).stores({profiles:'&scope'}) }
}
const db=new ProfileDB()
const handle = /^[a-z0-9](?:[a-z0-9.-]{1,13}[a-z0-9])$/
const visibility:Visibility[]=['everyone','contacts','team','nobody']

export function blankProfile():Profile {
  return {version:1,name:'',username:'',about:'',cardVisibility:'nobody',
    teamsVisibility:'nobody',presenceVisibility:'nobody'}
}
export function validateProfile(value:Profile):void {
  if (!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join('|')!=='about|cardVisibility|name|presenceVisibility|teamsVisibility|username|version'
    ||value.version!==1
    ||typeof value.name!=='string'||value.name.length>64||value.name!==value.name.trim()
    ||typeof value.about!=='string'||value.about.length>600||value.about!==value.about.trim()
    ||typeof value.username!=='string'||(value.username!==''&&!handle.test(value.username))
    ||!visibility.includes(value.cardVisibility)
    ||!visibility.includes(value.teamsVisibility)
    ||!visibility.includes(value.presenceVisibility))throw Error('profile.invalid_input')
}
function same(s:Session):void {
  const a=activeSession.value
  if(!a||a.accountId!==s.accountId||a.deviceId!==s.deviceId
    ||a.pkg.akek!==s.pkg.akek||a.pkg.revision!==s.pkg.revision
    ||a.pkg.accountSpki!==s.pkg.accountSpki)throw Error('identity.changed')
}
async function scope(s:Session):Promise<string> {
  return hex(await digest(enc.encode(domain+s.accountId+'\n'+s.deviceId)))
}
async function key(s:Session):Promise<CryptoKey> {
  const raw=unb64(s.pkg.akek,32)
  try {return await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])}
  finally {raw.fill(0)}
}
export async function readLocalProfile():Promise<Profile> {
  const s=requireSession(),id=await scope(s)
  const row=await db.profiles.get(id)
  same(s)
  if(!row)return blankProfile()
  if(row.scope!==id)throw Error('profile.invalid_record')
  let profile:Profile
  try{
    const bytes=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),additionalData:enc.encode(domain+id),tagLength:128,
    },await key(s),unb64(row.ciphertext))
    profile=JSON.parse(dec.decode(bytes)) as Profile
    validateProfile(profile)
  }catch{throw Error('profile.encrypted_record_unreadable')}
  same(s)
  return profile
}
/** Device-local AES-GCM profile: no claim of global handle registration or public publishing. */
export async function saveLocalProfile(input:Profile):Promise<void>{
  validateProfile(input)
  const s=requireSession(),id=await scope(s),iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:enc.encode(domain+id),tagLength:128,
  },await key(s),enc.encode(JSON.stringify(input)))
  same(s)
  await db.profiles.put({scope:id,iv:b64(iv),ciphertext:b64(ciphertext)})
  same(s)
}
