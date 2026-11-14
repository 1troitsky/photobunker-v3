import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  attemptPinVerifier, enrollPinVerifier, type PinScope,
  buildPinVerifierSnapshot,evaluatePinVerifierSnapshot,
  readVerifiedPinRelockDelay,prepareVerifiedPinRelockPolicy,
  type StoredPinState,
} from './pin-verifier'

const scope = (): PinScope => ({
  accountId: crypto.randomUUID(),
  deviceId: crypto.randomUUID(),
})

async function hmacSecret(extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', crypto.getRandomValues(new Uint8Array(32)),
    {name: 'HMAC', hash: 'SHA-256'}, extractable, ['sign'],
  )
}

afterEach(() => vi.useRealTimers())

describe('P3 #220 — protected offline dual-PIN verifier (not active PIN Shell)', () => {
  it('rejects non-decimal or wrong-sized PIN and same/emergency length mismatch', async () => {
    const owner = scope()
    const secret = await hmacSecret()
    for (const invalid of ['123', '123456789', '１２３４', '12 4', '12a4']) {
      await expect(enrollPinVerifier(owner, secret, invalid, null))
        .rejects.toThrow('pin.invalid_format')
    }
    await expect(enrollPinVerifier(owner, secret, '1234', '1234'))
      .rejects.toThrow('pin.emergency_mismatch')
    await expect(enrollPinVerifier(owner, secret, '12345', '9876'))
      .rejects.toThrow('pin.emergency_mismatch')
    await expect(enrollPinVerifier(owner, await hmacSecret(true), '1234', null))
      .rejects.toThrow('pin.invalid_device_secret')
    const weakKey = await crypto.subtle.importKey(
      'raw', new Uint8Array(8), {name:'HMAC',hash:'SHA-256'}, false, ['sign'],
    )
    await expect(enrollPinVerifier(owner, weakKey, '1234', null))
      .rejects.toThrow('pin.invalid_device_secret')
    await expect(attemptPinVerifier({accountId:'bad',deviceId:'bad'}, secret,'1234'))
      .rejects.toThrow('pin.invalid_scope')
  })

  it('recognizes same-shell app PIN and separate emergency intent; never executes wipe', async () => {
    const owner = scope()
    const secret = await hmacSecret()
    await enrollPinVerifier(owner, secret, '123456', '987654')
    expect(await attemptPinVerifier(owner, secret, '123456'))
      .toEqual({status:'app-unlocked'})
    expect(await attemptPinVerifier(owner, secret, '987654'))
      .toEqual({status:'emergency-intent'})
    // Returning an intent is not proof of server revoke or local wiping.
    expect(await attemptPinVerifier(owner, secret, '000000'))
      .toEqual({status:'invalid',attemptsRemaining:4})
  }, 30_000)

  it('persists five failed attempts, 30-minute lock, and resets budget after expiry', async () => {
    vi.useFakeTimers({toFake:['Date']})
    vi.setSystemTime(new Date('2026-11-14T08:00:00.000Z'))
    const owner = scope()
    const secret = await hmacSecret()
    await enrollPinVerifier(owner, secret, '1234', null)
    for (let n = 1; n <= 4; n++) {
      expect(await attemptPinVerifier(owner, secret, '9999')).toEqual({
        status:'invalid',attemptsRemaining:5-n,
      })
    }
    expect(await attemptPinVerifier(owner, secret, '9999'))
      .toEqual({status:'locked',retryAfterMs:1_800_000})
    vi.setSystemTime(new Date('2026-11-14T08:29:59.000Z'))
    expect(await attemptPinVerifier(owner, secret, '1234'))
      .toEqual({status:'locked',retryAfterMs:1000})
    vi.setSystemTime(new Date('2026-11-14T08:30:00.000Z'))
    expect(await attemptPinVerifier(owner, secret, '9999'))
      .toEqual({status:'invalid',attemptsRemaining:4})
    expect(await attemptPinVerifier(owner, secret, '1234'))
      .toEqual({status:'app-unlocked'})
  }, 60_000)

  it('atomically counts concurrent invalid guesses across independent async calls', async () => {
    const owner=scope()
    const secret=await hmacSecret()
    await enrollPinVerifier(owner, secret, '1234', '4321')
    const outcomes=await Promise.all(
      Array.from({length:5},()=>attemptPinVerifier(owner,secret,'0000')),
    )
    expect(outcomes.filter(x=>x.status==='locked')).toHaveLength(1)
    expect(outcomes.filter(x=>x.status==='invalid')).toHaveLength(4)
    const budget=outcomes.flatMap(x=>x.status==='invalid'?[x.attemptsRemaining]:[])
    expect(budget.sort()).toEqual([1,2,3,4])
    const blocked=await attemptPinVerifier(owner,secret,'1234')
    expect(blocked.status).toBe('locked')
  }, 60_000)

  it('fails closed on device clock rollback without resetting attempts', async () => {
    vi.useFakeTimers({toFake:['Date']})
    vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'))
    const owner=scope()
    const secret=await hmacSecret()
    await enrollPinVerifier(owner,secret,'1234',null)
    expect(await attemptPinVerifier(owner,secret,'9999'))
      .toEqual({status:'invalid',attemptsRemaining:4})
    vi.setSystemTime(new Date('2026-11-14T09:00:00.000Z'))
    expect(await attemptPinVerifier(owner,secret,'1234'))
      .toEqual({status:'clock-rollback'})
    vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'))
    expect(await attemptPinVerifier(owner,secret,'9999'))
      .toEqual({status:'invalid',attemptsRemaining:3})
  }, 30_000)

  it('does not permit wrong account, device or device-key substitution', async () => {
    const owner=scope()
    const secret=await hmacSecret()
    await enrollPinVerifier(owner,secret,'1234','8765')
    await expect(attemptPinVerifier({...owner,accountId:crypto.randomUUID()},secret,'1234'))
      .rejects.toThrow('pin.not_configured')
    await expect(attemptPinVerifier({...owner,deviceId:crypto.randomUUID()},secret,'1234'))
      .rejects.toThrow('pin.not_configured')
    const otherSecret=await hmacSecret()
    await expect(attemptPinVerifier(owner,otherSecret,'1234'))
      .rejects.toThrow('pin.integrity_failed')
    expect(await attemptPinVerifier(owner,secret,'1234'))
      .toEqual({status:'app-unlocked'})
  }, 30_000)

  it('never stores PIN, unwrapped secret or PBKDF2 output in IndexedDB', async () => {
    const owner=scope()
    const secret=await hmacSecret()
    await enrollPinVerifier(owner,secret,'1357','2468')
    const db=new Dexie('pb3_pin_verifier_v1')
    db.version(1).stores({records:'id'})
    try {
      const record=await db.table('records').get(owner.accountId+':'+owner.deviceId)
      expect(record).toBeDefined()
      expect(record.app.salt).toHaveLength(32)
      expect(record.integrityTag).toHaveLength(32)
      expect(record.app.tag).toHaveLength(32)
      expect(record.emergency.salt).toHaveLength(32)
      expect(record.emergency.tag).toHaveLength(32)
      expect(record.app.salt).not.toEqual(record.emergency.salt)
      expect(Object.keys(record).sort()).toEqual([
        'accountId','app','deviceId','emergency','failures','id',
        'integrityTag','lastObservedMs','lockedUntilMs','relockDelayMs','revision','version',
      ])
      expect(JSON.stringify(record)).not.toContain('"1357"')
      expect(JSON.stringify(record)).not.toContain('"2468"')
    } finally {
      db.close()
    }
  }, 30_000)

  it('rejects a corrupted local verifier without treating it as an unprotected session', async () => {
    const owner=scope()
    const secret=await hmacSecret()
    await enrollPinVerifier(owner,secret,'1234',null)
    const db=new Dexie('pb3_pin_verifier_v1')
    db.version(1).stores({records:'id'})
    try {
      const key=owner.accountId+':'+owner.deviceId
      await db.table('records').update(key,{app:null})
      await expect(attemptPinVerifier(owner,secret,'1234'))
        .rejects.toThrow('pin.corrupt_record')
    } finally {
      db.close()
    }
  }, 30_000)

  it('detects direct IndexedDB counter reset after five failures before evaluating correct PIN', async () => {
    const owner=scope()
    const secret=await hmacSecret()
    await enrollPinVerifier(owner,secret,'1234','4321')
    for(let i=0;i<5;i++) await attemptPinVerifier(owner,secret,'9999')

    const db=new Dexie('pb3_pin_verifier_v1')
    db.version(1).stores({records:'id'})
    try {
      const key=owner.accountId+':'+owner.deviceId
      await db.table('records').update(key,{
        failures:0,lockedUntilMs:0,lastObservedMs:0,
      })
      await expect(attemptPinVerifier(owner,secret,'1234'))
        .rejects.toThrow('pin.integrity_failed')
      await expect(attemptPinVerifier(owner,secret,'4321'))
        .rejects.toThrow('pin.integrity_failed')
    } finally {
      db.close()
    }
  }, 60_000)

  it('detects tampered verifier salts, tags and unsigned legacy state', async () => {
    for (const corruption of ['salt','tag','missing-mac'] as const) {
      const owner=scope()
      const secret=await hmacSecret()
      await enrollPinVerifier(owner,secret,'1234',null)
      const db=new Dexie('pb3_pin_verifier_v1')
      db.version(1).stores({records:'id'})
      try {
        const key=owner.accountId+':'+owner.deviceId
        const row=await db.table('records').get(key)
        if(corruption==='salt'){
          const salt=[...row.app.salt]
          salt[0]=(salt[0]+1)%256
          await db.table('records').update(key,{app:{...row.app,salt}})
        } else if(corruption==='tag'){
          const tag=[...row.app.tag]
          tag[0]=(tag[0]+1)%256
          await db.table('records').update(key,{app:{...row.app,tag}})
        } else {
          await db.table('records').update(key,{integrityTag:undefined})
        }
        await expect(attemptPinVerifier(owner,secret,'1234'))
          .rejects.toThrow(corruption==='missing-mac'?
            'pin.corrupt_record':'pin.integrity_failed')
      } finally {
        db.close()
      }
    }
  }, 60_000)

  it('cannot reset an enrolled verifier by repeating enroll, even after invalid PIN', async () => {
    const owner=scope()
    const secret=await hmacSecret()
    await enrollPinVerifier(owner,secret,'1234','4321')
    expect(await attemptPinVerifier(owner,secret,'0000'))
      .toEqual({status:'invalid',attemptsRemaining:4})
    await expect(enrollPinVerifier(owner,secret,'0000','9999'))
      .rejects.toThrow()
    expect(await attemptPinVerifier(owner,secret,'9999'))
      .toEqual({status:'invalid',attemptsRemaining:3})
    expect(await attemptPinVerifier(owner,secret,'1234'))
      .toEqual({status:'app-unlocked'})
  }, 30_000)

  it('authenticates new HMAC-v2 relock timing and preserves old v1 MAC records',async()=>{
    const owner=scope(),secret=await hmacSecret()
    const current=await buildPinVerifierSnapshot(owner,secret,'1234','4321')
    expect(current.relockDelayMs).toBe(0)
    expect(await readVerifiedPinRelockDelay(owner,secret,current)).toBe(0)
    const old:{[key:string]:unknown}={...current}
    delete old.relockDelayMs
    const frame=new TextEncoder().encode(JSON.stringify([
      'PB3/PIN/ledger/v1',old.id,old.version,old.accountId,old.deviceId,
      old.revision,current.app.salt,current.app.tag,
      current.emergency!.salt,current.emergency!.tag,
      old.failures,old.lockedUntilMs,old.lastObservedMs,
    ]))
    old.integrityTag=Array.from(new Uint8Array(
      await crypto.subtle.sign('HMAC',secret,frame),
    ))
    const legacy=old as StoredPinState
    expect(await readVerifiedPinRelockDelay(owner,secret,legacy)).toBe(0)
    expect((await evaluatePinVerifierSnapshot(
      owner,secret,'1234',legacy,
    )).result.status).toBe('app-unlocked')
  },45_000)

  it('prepares HMAC-v2 timing without reset of incorrect PIN budget or mutation of source',async()=>{
    const owner=scope(),secret=await hmacSecret()
    const initial=await buildPinVerifierSnapshot(owner,secret,'1234','4321')
    const failed=(await evaluatePinVerifierSnapshot(
      owner,secret,'9999',initial,
    )).next!
    expect(failed.failures).toBe(1)
    const next=await prepareVerifiedPinRelockPolicy(
      owner,secret,failed,300_000,
    )
    expect(next.relockDelayMs).toBe(300_000)
    expect(next.failures).toBe(1)
    expect(next.lockedUntilMs).toBe(failed.lockedUntilMs)
    expect(next.revision).not.toBe(failed.revision)
    expect(failed.relockDelayMs).toBe(0)
    expect(await readVerifiedPinRelockDelay(owner,secret,next)).toBe(300_000)
    expect((await evaluatePinVerifierSnapshot(
      owner,secret,'9999',next,
    )).result).toEqual({status:'invalid',attemptsRemaining:3})
  },55_000)

  it('rejects forged, removed, extra or out-of-range timing before a PIN attempt',async()=>{
    const owner=scope(),secret=await hmacSecret()
    const initial=await buildPinVerifierSnapshot(owner,secret,'1234','4321')
    const configured=await prepareVerifiedPinRelockPolicy(
      owner,secret,initial,120_000,
    )
    const cases:Array<{row:StoredPinState,reason:string}>=[
      {row:{...configured,relockDelayMs:300_000},reason:'pin.integrity_failed'},
      {row:{...configured,relockDelayMs:0},reason:'pin.integrity_failed'},
      {row:{...configured,relockDelayMs:-1},reason:'pin.corrupt_record'},
      {row:{...configured,relockDelayMs:300_001},reason:'pin.corrupt_record'},
      {row:{...configured,relockDelayMs:1.5},reason:'pin.corrupt_record'},
      {row:{...configured,relockDelayMs:undefined},reason:'pin.corrupt_record'},
      {row:{...configured,extraDelay:0} as StoredPinState,reason:'pin.corrupt_record'},
    ]
    const omitted={...configured}
    delete omitted.relockDelayMs
    cases.push({row:omitted,reason:'pin.integrity_failed'})
    for(const {row,reason} of cases){
      await expect(readVerifiedPinRelockDelay(owner,secret,row))
        .rejects.toThrow(reason)
      await expect(evaluatePinVerifierSnapshot(owner,secret,'1234',row))
        .rejects.toThrow(reason)
    }
  },60_000)

  it('denies preference preparation with wrong key/scope, during lockout, rollback or invalid interval',async()=>{
    vi.useFakeTimers({toFake:['Date']})
    vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'))
    const owner=scope(),secret=await hmacSecret()
    const initial=await buildPinVerifierSnapshot(owner,secret,'1234',null)
    for(const value of [-1,300_001,1.1,'300000',NaN,Infinity]){
      await expect(prepareVerifiedPinRelockPolicy(owner,secret,initial,value))
        .rejects.toThrow('pin.invalid_relock_delay')
    }
    await expect(prepareVerifiedPinRelockPolicy(
      {...owner,deviceId:crypto.randomUUID()},secret,initial,1000,
    )).rejects.toThrow('pin.corrupt_record')
    await expect(prepareVerifiedPinRelockPolicy(
      owner,await hmacSecret(),initial,1000,
    )).rejects.toThrow('pin.integrity_failed')
    const locked={...initial,lockedUntilMs:Date.now()+1800000}
    // Re-MAC the locked state by progressing through 5 actual attempts,
    // not by editing the unauthenticated timestamp in the test.
    let updated=initial
    for(let i=0;i<5;i++){
      updated=(await evaluatePinVerifierSnapshot(
        owner,secret,'9999',updated,
      )).next!
    }
    expect(updated.lockedUntilMs).toBeGreaterThan(Date.now())
    await expect(prepareVerifiedPinRelockPolicy(owner,secret,updated,1000))
      .rejects.toThrow('pin.policy_clock_or_lockout')
    vi.setSystemTime(new Date('2026-11-14T09:59:59.000Z'))
    await expect(prepareVerifiedPinRelockPolicy(owner,secret,initial,1000))
      .rejects.toThrow('pin.policy_clock_or_lockout')
    expect(locked.lockedUntilMs).toBeGreaterThan(Date.now())
    vi.useRealTimers()
  },90_000)

})
