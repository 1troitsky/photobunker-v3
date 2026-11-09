/* PB2 identity protocol v2. Browser WebCrypto primitives only; no legacy PB1,
   no photo ciphertext encryption with account key and no server-side secrets. */
const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })
const domain = 'photobunker/recovery-key/v2\0'
export type PB2 = Readonly<{ locator: string; secret: Uint8Array<ArrayBuffer>; encoded: string }>
export type PackageV2 = Readonly<{ v: 2; accountId: string; accountSpki: string; accountPkcs8: string; akek: string; signingKeyId: string; wrappingKeyId: string; revision: number }>
export type RecoveryEnvelope = Readonly<{
  v: 2; alg: 'A256GCM'; accountId: string; locator: string; keyId: string;
  purpose: 'recovery'; revision: number; iv: string; ciphertext: string
}>
export type DeviceEnvelope = Readonly<{
  v: 2; alg: 'A256GCM'; accountId: string; deviceId: string; keyId: string;
  purpose: 'device'; revision: number; iv: string; ciphertext: string
}>

function bytes(...buffers: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const merged = new Uint8Array(buffers.reduce((sum, b) => sum + b.byteLength, 0))
  let offset = 0
  for (const b of buffers) { merged.set(b, offset); offset += b.length }
  return merged
}
export function b64(data: Uint8Array | ArrayBuffer): string {
  const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  let raw = ''
  for (const byte of u8) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
export function unb64(text: string, expected?: number): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length > 8192) throw new Error('identity.invalid_base64')
  let raw: string
  try { raw = atob(text.replace(/-/g, '+').replace(/_/g, '/')) } catch { throw new Error('identity.invalid_base64') }
  const out = Uint8Array.from(raw, c => c.charCodeAt(0))
  if (b64(out) !== text || (expected !== undefined && out.length !== expected)) throw new Error('identity.noncanonical_base64')
  return out
}
export function random(size: number): Uint8Array<ArrayBuffer> { return crypto.getRandomValues(new Uint8Array(size)) }
export function uuid(): string { return crypto.randomUUID() }
export async function digest(value: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', value))
}
export function hex(value: Uint8Array): string { return [...value].map(x => x.toString(16).padStart(2, '0')).join('') }
export async function createPB2(): Promise<PB2> {
  const locator = random(16), secret = random(32)
  const check = (await digest(bytes(enc.encode(domain), locator, secret))).slice(0, 8)
  const encoded = ['PB2', b64(locator), b64(secret), b64(check)].join('.')
  return { locator: b64(locator), secret, encoded }
}
export async function parsePB2(value: string): Promise<PB2> {
  if (value !== value.trim() || value.length > 256) throw new Error('identity.invalid_key')
  const fields = value.split('.')
  if (fields.length !== 4 || fields[0] !== 'PB2') throw new Error('identity.invalid_key')
  const locator = unb64(fields[1] ?? '', 16), secret = unb64(fields[2] ?? '', 32)
  const check = unb64(fields[3] ?? '', 8)
  const expected = (await digest(bytes(enc.encode(domain), locator, secret))).slice(0, 8)
  let bad = 0
  for (let i=0;i<8;i++) bad |= check[i]! ^ expected[i]!
  if (bad !== 0) throw new Error('identity.invalid_checksum')
  return { locator: b64(locator), secret, encoded: value }
}
export function canonical(input: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)))
}
const p256Sign = { name: 'ECDSA', namedCurve: 'P-256' } as const
export async function newSigning(extractable: boolean): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(p256Sign, extractable, ['sign','verify'])
}
export async function exportSpki(key: CryptoKey): Promise<string> { return b64(await crypto.subtle.exportKey('spki', key)) }
export async function importSpki(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', unb64(value), p256Sign, false, ['verify'])
}
export async function importSigner(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', unb64(value), p256Sign, false, ['sign'])
}
export async function sign(key: CryptoKey, message: string): Promise<string> {
  return b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(message)))
}
export async function verify(key: CryptoKey, message: string, signature: string): Promise<boolean> {
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature,64), enc.encode(message))
}
export async function freshPackage(accountId: string, revision = 1): Promise<{ pkg: PackageV2; signer: CryptoKey }> {
  const pair = await newSigning(true)
  const accountSpki = await exportSpki(pair.publicKey)
  const accountPkcs8 = b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  return { pkg: {
    v: 2, accountId, accountSpki, accountPkcs8, akek: b64(random(32)),
    signingKeyId: b64(random(16)), wrappingKeyId: b64(random(16)), revision,
  }, signer: await importSigner(accountPkcs8) }
}
export function validatedPackage(value: unknown, accountId: string): PackageV2 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('identity.invalid_package')
  const v = value as Record<string, unknown>
  const fields = ['v','accountId','accountSpki','accountPkcs8','akek','signingKeyId','wrappingKeyId','revision']
  if (Object.keys(v).sort().join('|') !== fields.sort().join('|')
    || v.v !== 2 || v.accountId !== accountId || !Number.isSafeInteger(v.revision) || (v.revision as number) < 1) throw new Error('identity.invalid_package')
  for (const f of ['accountSpki','accountPkcs8','akek','signingKeyId','wrappingKeyId']) {
    if (typeof v[f] !== 'string') throw new Error('identity.invalid_package')
  }
  unb64(v.akek as string,32); unb64(v.signingKeyId as string,16); unb64(v.wrappingKeyId as string,16)
  unb64(v.accountSpki as string); unb64(v.accountPkcs8 as string)
  return v as PackageV2
}
export function descriptor(v: Record<string, string | number>): Uint8Array<ArrayBuffer> {
  for (const [key,value] of Object.entries(v)) if (!/^[a-zA-Z]+$/.test(key) || !/^[\x20-\x7e]+$/.test(String(value))) throw new Error('identity.invalid_descriptor')
  return enc.encode(canonical(v))
}
export async function recoveryKey(kit: PB2, accountId: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', kit.secret, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',salt:unb64(kit.locator,16),
    info:enc.encode('photobunker/recovery-envelope/v2:'+accountId),
  }, material, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt'])
}
async function encrypt(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<{iv:string;ciphertext:string}> {
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,plaintext)
  return {iv:b64(iv),ciphertext:b64(ciphertext)}
}
async function decrypt(key: CryptoKey, value:{iv:string;ciphertext:string}, aad:Uint8Array<ArrayBuffer>):Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(value.iv,12),additionalData:aad,tagLength:128,
  },key,unb64(value.ciphertext)))
}
export function recoveryAAD(e:Pick<RecoveryEnvelope,'accountId'|'locator'|'keyId'|'purpose'|'revision'>):Uint8Array<ArrayBuffer> {
  return descriptor({version:2,alg:'A256GCM',accountId:e.accountId,locator:e.locator,keyId:e.keyId,purpose:e.purpose,revision:e.revision})
}
export async function sealRecovery(pkg:PackageV2,kit:PB2):Promise<RecoveryEnvelope> {
  const e={v:2 as const,alg:'A256GCM' as const,accountId:pkg.accountId,
    locator:kit.locator,keyId:pkg.wrappingKeyId,purpose:'recovery' as const,revision:pkg.revision}
  return {...e,...await encrypt(await recoveryKey(kit,pkg.accountId),enc.encode(canonical(pkg)),recoveryAAD(e))}
}
function exactEnvelope(e:Record<string,unknown>,keys:string[]) {
  if (Object.keys(e).sort().join('|')!==keys.sort().join('|')) throw new Error('identity.invalid_envelope')
}
export async function openRecovery(input:unknown,kit:PB2,accountId:string):Promise<PackageV2> {
  if (typeof input!=='object' || !input || Array.isArray(input)) throw new Error('identity.invalid_envelope')
  const e=input as Record<string,unknown>
  exactEnvelope(e,['v','alg','accountId','locator','keyId','purpose','revision','iv','ciphertext'])
  if (e.v!==2 || e.alg!=='A256GCM' || e.accountId!==accountId || e.locator!==kit.locator ||
      e.purpose!=='recovery' || !Number.isSafeInteger(e.revision) || typeof e.keyId!=='string' ||
      typeof e.iv!=='string' || typeof e.ciphertext!=='string') throw new Error('identity.invalid_envelope')
  unb64(e.keyId as string,16)
  const clear=await decrypt(await recoveryKey(kit,accountId),{iv:e.iv as string,ciphertext:e.ciphertext as string},recoveryAAD(e as unknown as RecoveryEnvelope))
  const pkg=validatedPackage(JSON.parse(dec.decode(clear)),accountId)
  if (pkg.revision!==e.revision || pkg.wrappingKeyId!==e.keyId) throw new Error('identity.invalid_envelope')
  const publicKey=await importSpki(pkg.accountSpki)
  const privateKey=await importSigner(pkg.accountPkcs8)
  const probe='photobunker/identity/key-match/v2'
  if (!(await verify(publicKey,probe,await sign(privateKey,probe)))) throw new Error('identity.invalid_signing_key')
  return pkg
}
export async function newDeviceEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
export function deviceAAD(e:Pick<DeviceEnvelope,'accountId'|'deviceId'|'keyId'|'purpose'|'revision'>):Uint8Array<ArrayBuffer>{
  return descriptor({version:2,alg:'A256GCM',accountId:e.accountId,deviceId:e.deviceId,keyId:e.keyId,purpose:e.purpose,revision:e.revision})
}
export async function sealDevice(pkg:PackageV2,deviceId:string,key:CryptoKey):Promise<DeviceEnvelope>{
  const e={v:2 as const,alg:'A256GCM' as const,accountId:pkg.accountId,deviceId,
    keyId:pkg.wrappingKeyId,purpose:'device' as const,revision:pkg.revision}
  return {...e,...await encrypt(key,enc.encode(canonical(pkg)),deviceAAD(e))}
}
export async function openDevice(input:DeviceEnvelope,key:CryptoKey,accountId:string,deviceId:string):Promise<PackageV2>{
  exactEnvelope(input as unknown as Record<string,unknown>,['v','alg','accountId','deviceId','keyId','purpose','revision','iv','ciphertext'])
  if (input.v!==2 || input.alg!=='A256GCM' || input.accountId!==accountId ||
      input.deviceId!==deviceId || input.purpose!=='device') throw new Error('identity.invalid_envelope')
  const pkg=validatedPackage(JSON.parse(dec.decode(await decrypt(key,input,deviceAAD(input)))),accountId)
  if (pkg.revision!==input.revision || pkg.wrappingKeyId!==input.keyId) throw new Error('identity.invalid_envelope')
  return pkg
}
/* AKEK wraps fresh independent per-asset DEKs. Never encrypt pixels with AKEK. */
export async function wrapAssetDEK(pkg:PackageV2,assetId:string,expiresAt:string):Promise<{iv:string;ciphertext:string}> {
  const key=await crypto.subtle.importKey('raw',unb64(pkg.akek,32),{name:'AES-GCM'},false,['encrypt'])
  return encrypt(key,random(32),descriptor({version:2,purpose:'asset-dek',accountId:pkg.accountId,assetId,expiresAt}))
}
export async function unwrapAssetDEK(pkg:PackageV2,assetId:string,expiresAt:string,wrapped:{iv:string;ciphertext:string}):Promise<CryptoKey>{
  const key=await crypto.subtle.importKey('raw',unb64(pkg.akek,32),{name:'AES-GCM'},false,['decrypt'])
  const raw=await decrypt(key,wrapped,descriptor({version:2,purpose:'asset-dek',accountId:pkg.accountId,assetId,expiresAt}))
  if (raw.byteLength!==32) throw new Error('identity.invalid_asset_key')
  return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])
}
/**
 * The owner's AKEK never encrypts photos. Briefly unwrap exactly ONE asset DEK
 * for an application-controlled recipient wrapping operation; erase the raw
 * byte buffer on success, error and account-switch races.
 * Keep this capability out of UI modules and never persist callback material.
 */
export async function withTransientOwnerDEK<T>(pkg:PackageV2,assetId:string,
  expiresAt:string,wrapped:{iv:string;ciphertext:string},
  operation:(bytes:Uint8Array<ArrayBuffer>)=>Promise<T>):Promise<T>{
  if(!/^[a-f0-9-]{36}$/.test(assetId)||!/^[1-9][0-9]{8,15}$/.test(expiresAt))
    throw Error('identity.invalid_asset_scope')
  const akek=unb64(pkg.akek,32)
  try{
    const key=await crypto.subtle.importKey('raw',akek,{name:'AES-GCM'},false,['decrypt'])
    const plain=await decrypt(key,wrapped,descriptor({
      version:2,purpose:'asset-dek',accountId:pkg.accountId,assetId,expiresAt,
    }))
    try{
      if(plain.byteLength!==32)throw Error('identity.invalid_asset_key')
      return await operation(plain)
    }finally{plain.fill(0)}
  }finally{akek.fill(0)}
}

export type Challenge = {id:string;nonce:string;expiresAt:string;digest:string;message:string}
export async function verifyChallenge(c:Challenge,purpose:string,payload:Record<string,string>):Promise<void>{
  if (unb64(c.nonce,32).length!==32) throw new Error('identity.bad_challenge')
  const digestHex=hex(await digest(enc.encode(canonical(payload))))
  const frame=['photobunker.identity.v2',purpose,c.id,c.nonce,c.expiresAt,digestHex].join('\n')
  if (c.message!==frame || c.digest!==digestHex || Date.parse(c.expiresAt)<=Date.now()
      || Date.parse(c.expiresAt)>Date.now()+120000 || payload.purpose!==purpose) throw new Error('identity.bad_challenge')
}
export async function exchangeKey(privateKey:CryptoKey,peerSpki:string,info:string,salt:Uint8Array<ArrayBuffer>):Promise<CryptoKey>{
  const other=await crypto.subtle.importKey('spki',unb64(peerSpki),{name:'ECDH',namedCurve:'P-256'},false,[])
  const shared=await crypto.subtle.deriveBits({name:'ECDH',public:other},privateKey,256)
  const material=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey'])
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:enc.encode(info)},material,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
export async function newPairingKey():Promise<CryptoKeyPair>{
  return crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
}
export async function exportECDHPublic(key:CryptoKey):Promise<string>{return b64(await crypto.subtle.exportKey('spki',key))}
export async function sealPairing(pkg:PackageV2,key:CryptoKey,pairingId:string,newDeviceId:string):Promise<{iv:string;ciphertext:string}>{
  return encrypt(key,enc.encode(canonical(pkg)),descriptor({version:2,purpose:'pairing',accountId:pkg.accountId,pairingId,newDeviceId}))
}
export async function openPairing(value:{iv:string;ciphertext:string},key:CryptoKey,accountId:string,pairingId:string,newDeviceId:string):Promise<PackageV2>{
  const raw=await decrypt(key,value,descriptor({version:2,purpose:'pairing',accountId,pairingId,newDeviceId}))
  return validatedPackage(JSON.parse(dec.decode(raw)),accountId)
}
