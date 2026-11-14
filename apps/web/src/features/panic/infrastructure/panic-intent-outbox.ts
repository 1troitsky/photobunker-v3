/**
 * P3 #221: isolated PRE-DISPATCH intent journal.
 *
 * No network calls, no device/session access, no local wipe or cloud deletion.
 * Never treat a local journal write as a server ACK or a completed Panic.
 * This DB is deliberately separate from volatile media/outbox caches that a
 * future authorized Panic procedure needs to destroy.
 */
import Dexie, {type Table} from 'dexie'
import {
  parsePanicIntent, verifySignedPanicIntent,
} from '../domain/panic-intent'
import type {
  PanicIntentScope, SignedPanicIntent,
} from '../domain/panic-intent'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DEFAULT_DB='pb3-panic-intent-prepared-v1'

type PreparedRow={
  slot:string
  version:1
  phase:'prepared-unconfirmed'
  accountId:string
  deviceId:string
  keyRevision:number
  operationId:string
  contract:string
  signature:string
  preparedAt:number
}

class PanicPreparedDb extends Dexie{
  readonly entries!:Table<PreparedRow,string>
  constructor(dbName:string){
    super(dbName)
    // Cross-tab, write-once slot per account/device. The signed operation
    // is never silently replaced by a new one on a repeated emergency.
    this.version(1).stores({
      entries:'&slot,&operationId,accountId,deviceId',
    })
  }
}

function scopeKey(scope:PanicIntentScope):string{
  if(!scope||!UUID.test(scope.accountId)||!UUID.test(scope.deviceId)
    ||!Number.isSafeInteger(scope.keyRevision)||scope.keyRevision<1)
    throw Error('panic.invalid_scope')
  return scope.accountId+'/'+scope.deviceId
}

function verifyRowShape(row:PreparedRow,slot:string,scope:PanicIntentScope):void{
  if(!row||typeof row!=='object'||Array.isArray(row)
    ||Object.keys(row).sort().join('|')!==[
      'slot','version','phase','accountId','deviceId','keyRevision',
      'operationId','contract','signature','preparedAt',
    ].sort().join('|')
    ||row.slot!==slot||row.version!==1
    ||row.phase!=='prepared-unconfirmed'
    ||row.accountId!==scope.accountId||row.deviceId!==scope.deviceId
    ||row.keyRevision!==scope.keyRevision
    ||typeof row.contract!=='string'||typeof row.signature!=='string'
    ||!Number.isSafeInteger(row.preparedAt)||row.preparedAt<0)
    throw Error('panic.corrupt_prepared_intent')
  let parsed:ReturnType<typeof parsePanicIntent>
  try{parsed=parsePanicIntent(row.contract)}
  catch{throw Error('panic.corrupt_prepared_intent')}
  if(parsed.operationId!==row.operationId
    ||parsed.accountId!==row.accountId
    ||parsed.deviceId!==row.deviceId
    ||parsed.keyRevision!==row.keyRevision)
    throw Error('panic.corrupt_prepared_intent')
}

/**
 * Durable, prepared-but-UNCONFIRMED signed requests.
 *
 * An emergency caller MUST lock access and securely finalize THIS promise
 * (including read-after-write) before destroying the signer. Browser quota
 * and private-mode failures intentionally reject; never report a successful
 * wipe on failed storage. We do not claim IDB survives OS eviction/malware.
 */
export class PanicIntentJournal {
  private readonly db:PanicPreparedDb
  constructor(dbName=DEFAULT_DB){
    this.db=new PanicPreparedDb(dbName)
  }

  /**
   * Always supply trusted scope & SPKI from an already authenticated device,
   * NOT from the intent and NOT from the IndexedDB row.
   * Commit order is serialized across browser tabs by one Dexie transaction.
   */
  async prepare(
    signed:SignedPanicIntent,scope:PanicIntentScope,trustedDeviceSpki:string,
    nowMs=Date.now(),
  ):Promise<SignedPanicIntent>{
    const slot=scopeKey(scope)
    const parsed=await verifySignedPanicIntent(
      signed,scope,trustedDeviceSpki,nowMs)
    const stable={contract:signed.contract,signature:signed.signature}
    await this.db.transaction('rw',this.db.entries,async()=>{
      const existing=await this.db.entries.get(slot)
      if(existing){
        verifyRowShape(existing,slot,scope)
        if(existing.contract!==stable.contract
          ||existing.signature!==stable.signature
          ||existing.operationId!==parsed.operationId)
          throw Error('panic.prepared_conflict')
        return
      }
      const row:PreparedRow={
        slot,version:1,phase:'prepared-unconfirmed',
        accountId:scope.accountId,deviceId:scope.deviceId,
        keyRevision:scope.keyRevision,operationId:parsed.operationId,
        contract:stable.contract,signature:stable.signature,
        preparedAt:Date.now(),
      }
      await this.db.entries.add(row)
    })
    // No "prepared" result until a real round-trip to persistent IndexedDB.
    const durable=await this.read(scope,trustedDeviceSpki,nowMs)
    if(!durable||durable.contract!==stable.contract
      ||durable.signature!==stable.signature)
      throw Error('panic.durability_not_confirmed')
    return durable
  }

  /**
   * Read the original signed bytes after reload or an offline interruption.
   * Missing row !== success. No auto-send or auto-delete occurs on read.
   */
  async read(
    scope:PanicIntentScope,trustedDeviceSpki:string,nowMs=Date.now(),
  ):Promise<SignedPanicIntent|null>{
    const slot=scopeKey(scope)
    const row=await this.db.entries.get(slot)
    if(!row)return null
    verifyRowShape(row,slot,scope)
    const signed={contract:row.contract,signature:row.signature}
    try{await verifySignedPanicIntent(signed,scope,trustedDeviceSpki,nowMs)}
    catch{throw Error('panic.corrupt_prepared_intent')}
    return Object.freeze(signed)
  }

  /** Close this TAB's handle. Never clears or deletes prepared requests. */
  close():void{this.db.close()}
}
