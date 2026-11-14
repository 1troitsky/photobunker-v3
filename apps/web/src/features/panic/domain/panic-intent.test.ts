import {describe, expect, it} from 'vitest'
import {
  createSignedPanicIntent, isIdenticalPanicRetry,
  parsePanicIntent, verifySignedPanicIntent,
} from './panic-intent'
import type {PanicIntentScope, SignedPanicIntent} from './panic-intent'
import {b64, canonical, exportSpki, newSigning, sign} from '../../identity/infrastructure/crypto'

const uuid = (n: number) => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0')
const SCOPE: PanicIntentScope = {accountId: uuid(1), deviceId: uuid(2), keyRevision: 3}
const NOW = 1_800_000_000_000

async function fixture() {
  const keys = await newSigning(true)
  const spki = await exportSpki(keys.publicKey)
  const signed = await createSignedPanicIntent(SCOPE, keys.privateKey, NOW)
  return {keys, spki, signed}
}

function mutate(signed: SignedPanicIntent, patch: Record<string, unknown>): SignedPanicIntent {
  return { ...signed, contract: canonical({...JSON.parse(signed.contract), ...patch}) }
}

describe('P3 #221 fail-closed signed Panic intent (no destructive execution)', () => {
  it('issues an authenticated live-only envelope, not a Vault/secret deletion', async () => {
    const {signed, spki} = await fixture()
    const c = await verifySignedPanicIntent(signed, SCOPE, spki, NOW)
    expect(c).toEqual(parsePanicIntent(signed.contract))
    expect(c.version).toBe(1)
    expect(c.purpose).toBe('panic.live-delete')
    expect(c.vault).toBe('preserve-existing-verified')
    expect(c.liveScope).toBe('all-live-locations')
    expect(c.accountId).toBe(SCOPE.accountId)
    expect(c.deviceId).toBe(SCOPE.deviceId)
    expect(c.keyRevision).toBe(3)
    expect(signed.contract).not.toMatch(/pin|akek|secret|recoveryKey|mediaData/i)
    expect(Object.keys(signed).sort()).toEqual(['contract', 'signature'])
  })

  it('refuses cross-account, cross-device, stale revision and unrelated verifier key', async () => {
    const {signed, spki} = await fixture()
    for (const expected of [
      {...SCOPE, accountId: uuid(9)},
      {...SCOPE, deviceId: uuid(9)},
      {...SCOPE, keyRevision: 4},
    ]) {
      await expect(verifySignedPanicIntent(signed, expected, spki, NOW))
        .rejects.toThrow('panic.invalid_intent')
    }
    const other = await newSigning(true)
    await expect(verifySignedPanicIntent(signed, SCOPE, await exportSpki(other.publicKey), NOW))
      .rejects.toThrow('panic.invalid_intent')
  })

  it('binds every field: bytes may not be modified after P-256 signing', async () => {
    const {signed, spki} = await fixture()
    for (const patch of [
      {accountId:uuid(4)}, {deviceId:uuid(5)},
      {operationId:uuid(6)}, {nonce:b64(new Uint8Array(32).fill(42))},
      {issuedAt:new Date(NOW-10).toISOString()}, {keyRevision:4},
    ]) {
      await expect(verifySignedPanicIntent(mutate(signed, patch), SCOPE, spki, NOW))
        .rejects.toThrow('panic.invalid_intent')
    }
  })

  it('rejects destructive scope widening, malformed structures and extra fields BEFORE accepting a signature', async () => {
    const {signed, spki} = await fixture()
    for (const patch of [
      {purpose:'panic.delete-account'}, {vault:'delete'},
      {liveScope:'all-including-backups'}, {version:2},
      {backupId:uuid(7)}, {emergencyPin:'1234'},
      {keyRevision:0}, {keyRevision:1.5}, {nonce:'???'},
      {nonce:b64(new Uint8Array(31))}, {operationId:'broken'},
      {issuedAt:'2026-01-01T00:00:00+00:00'},
    ]) {
      await expect(verifySignedPanicIntent(mutate(signed,patch), SCOPE, spki,NOW))
        .rejects.toThrow('panic.invalid_intent')
    }
  })

  it('requires EXACT canonical JSON, rejects duplicate keys and parser ambiguity', async () => {
    const {signed} = await fixture()
    const obj = JSON.parse(signed.contract)
    expect(() => parsePanicIntent(JSON.stringify(Object.fromEntries(Object.entries(obj).reverse()))))
      .toThrow('panic.invalid_intent')
    expect(() => parsePanicIntent(signed.contract.replace(/^\{/, '{"version":1,')))
      .toThrow('panic.invalid_intent')
    expect(() => parsePanicIntent('not-json')).toThrow('panic.invalid_intent')
    expect(() => parsePanicIntent(null)).toThrow('panic.invalid_intent')
    expect(() => parsePanicIntent(signed.contract + '\n')).toThrow('panic.invalid_intent')
  })

  it('rejects missing/bad signatures and unknown wire keys without accepting forged ACK', async () => {
    const {signed, spki} = await fixture()
    for (const variant of [
      {contract:signed.contract, signature:'A'},
      {contract:signed.contract, signature:'@@@'},
      {contract:signed.contract, signature:signed.signature, acknowledged:true},
      {contract:signed.contract},
      {contract:signed.contract, signature:signed.signature.slice(0, -1) + '*'},
    ]) {
      await expect(verifySignedPanicIntent(variant, SCOPE, spki,NOW))
        .rejects.toThrow('panic.invalid_intent')
    }
  })

  it('does not accept a valid ECDSA signature from a different domain', async () => {
    const {signed, spki, keys} = await fixture()
    const forged = await sign(keys.privateKey,'photobunker.identity.v2\n'+signed.contract)
    await expect(verifySignedPanicIntent({...signed,signature:forged},SCOPE,spki,NOW))
      .rejects.toThrow('panic.invalid_intent')
  })

  it('accepts an old genuinely signed offline intent for later transport, but rejects future clock spoofing', async () => {
    const {signed, spki, keys} = await fixture()
    await expect(verifySignedPanicIntent(signed,SCOPE,spki,NOW+180*86400000))
      .resolves.toBeDefined()
    await expect(verifySignedPanicIntent(signed,SCOPE,spki,NOW-120001))
      .rejects.toThrow('panic.invalid_intent')
    const signedOnFuture = await createSignedPanicIntent(SCOPE, keys.privateKey, NOW+119999)
    await expect(verifySignedPanicIntent(signedOnFuture,SCOPE,spki,NOW))
      .resolves.toBeDefined()
  })

  it('recognizes byte-identical retries, but rejects same-operation different payload/signature', async () => {
    const {signed, keys} = await fixture()
    expect(isIdenticalPanicRetry(signed,{...signed})).toBe(true)
    const other = await createSignedPanicIntent(SCOPE,keys.privateKey,NOW)
    expect(isIdenticalPanicRetry(signed,other)).toBe(false)
    expect(() => isIdenticalPanicRetry(signed,mutate(signed,{issuedAt:new Date(NOW-1000).toISOString()})))
      .toThrow('panic.operation_collision')
    const alternativeSignature = await sign(keys.privateKey,
      'photobunker.panic.intent.v1\n'+signed.contract)
    // ECDSA may produce a second valid but non-identical signature. The same
    // operation must replay ORIGINAL bytes; no attempt to regenerate a command.
    if(alternativeSignature!==signed.signature){
      expect(() => isIdenticalPanicRetry(signed,{...signed,signature:alternativeSignature}))
        .toThrow('panic.operation_collision')
    }
  })

  it('does not sign invalid scopes or invalid timestamps', async () => {
    const {keys} = await fixture()
    for(const scope of [
      {...SCOPE, accountId:'bad'}, {...SCOPE, deviceId:'bad'},
      {...SCOPE, keyRevision:0}, {...SCOPE, keyRevision:NaN},
    ]) {
      await expect(createSignedPanicIntent(scope,keys.privateKey,NOW))
        .rejects.toThrow('panic.invalid_intent')
    }
    await expect(createSignedPanicIntent(SCOPE,keys.privateKey,Infinity))
      .rejects.toThrow('panic.invalid_intent')
  })
})
