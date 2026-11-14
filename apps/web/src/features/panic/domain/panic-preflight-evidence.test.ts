import {describe, expect, it} from 'vitest'
import {
  parsePanicPreflightEvidence, verifyPanicPreflightEvidence,
} from './panic-preflight-evidence'
import type {
  PanicPreflightEvidenceStatement, SignedPanicPreflightEvidence,
} from './panic-preflight-evidence'
import {
  createSignedPanicIntent,
} from './panic-intent'
import type {PanicIntentScope, SignedPanicIntent} from './panic-intent'
import {
  b64, canonical, digest, exportSpki, hex, newSigning, sign,
} from '../../identity/infrastructure/crypto'

const UUID = (n: number) => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0')
const SCOPE: PanicIntentScope = {accountId: UUID(1), deviceId: UUID(2), keyRevision: 3}
const NOW = 1_800_000_000_000
const DOMAIN = 'photobunker.panic.preflight-evidence.v1\n'

async function fixture() {
  const device = await newSigning(true)
  const server = await newSigning(true)
  const deviceSpki = await exportSpki(device.publicKey)
  const serverSpki = await exportSpki(server.publicKey)
  const original = await createSignedPanicIntent(SCOPE, device.privateKey, NOW)
  const payload = JSON.parse(original.contract) as {operationId:string}
  const statement: PanicPreflightEvidenceStatement = {
    version: 1,
    purpose: 'panic.preflight-recorded',
    phase: 'preflight_only',
    accountId: SCOPE.accountId,
    deviceId: SCOPE.deviceId,
    keyRevision: SCOPE.keyRevision,
    operationId: payload.operationId,
    contractHash: hex(await digest(new TextEncoder().encode(original.contract))),
    recordedAt: new Date(NOW + 2000).toISOString(),
    vault: 'preserve-existing-verified',
  }
  const signed = await serverSign(statement, server.privateKey)
  return {device, server, deviceSpki, serverSpki, original, statement, signed}
}

async function serverSign(
  payload: Record<string,unknown> | PanicPreflightEvidenceStatement,
  signer: CryptoKey,
  domain = DOMAIN,
): Promise<SignedPanicPreflightEvidence> {
  const statement = canonical(payload as Record<string, unknown>)
  return {statement, signature: await sign(signer, domain + statement)}
}

describe('P3 #221 VERIFY-ONLY preflight-only server-signed evidence (not cloud ACK)', () => {
  it('verifies two distinct ECDSA P-256 signers, exact original contract hash and only preflight phase', async () => {
    const f = await fixture()
    const result = await verifyPanicPreflightEvidence(
      f.signed, f.original, SCOPE, f.deviceSpki, f.serverSpki, NOW + 3000)
    expect(result).toEqual({
      phase: 'preflight_only', accountId: SCOPE.accountId,
      deviceId: SCOPE.deviceId,
      operationId: f.statement.operationId,
      contractHash: f.statement.contractHash,
      recordedAt: f.statement.recordedAt,
    })
    expect(Object.keys(result).sort()).toEqual(
      ['accountId','contractHash','deviceId','operationId','phase','recordedAt'])
    expect(JSON.stringify(result)).not.toMatch(/cloud_deleted|server_revoked|delete_ack|backup_preserved/)
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('never accepts device signatures as server trust or keys copied from evidence', async () => {
    const f = await fixture()
    const fraud = await serverSign(f.statement, f.device.privateKey)
    await expect(verifyPanicPreflightEvidence(
      fraud, f.original, SCOPE, f.deviceSpki, f.serverSpki, NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
    await expect(verifyPanicPreflightEvidence(
      fraud, f.original, SCOPE, f.deviceSpki, f.deviceSpki, NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
    const fake = {...f.signed, serverSpki:f.serverSpki}
    await expect(verifyPanicPreflightEvidence(
      fake, f.original, SCOPE, f.deviceSpki, f.serverSpki, NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
  })

  it('rejects another valid independent server signer or missing external trust anchor', async () => {
    const f = await fixture()
    const unknown = await newSigning(true)
    await expect(verifyPanicPreflightEvidence(
      f.signed, f.original, SCOPE, f.deviceSpki,
      await exportSpki(unknown.publicKey), NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
    await expect(verifyPanicPreflightEvidence(
      f.signed, f.original, SCOPE, f.deviceSpki, '', NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
    await expect(verifyPanicPreflightEvidence(
      f.signed, f.original, SCOPE, f.deviceSpki, 'not-spki', NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
  })

  it('rejects signed destructive progress or fabricated ACK even from a capable test signer', async () => {
    const f = await fixture()
    for (const changes of [
      {phase:'cloud_deleted'}, {phase:'server_revoked'},
      {phase:'cloud_delete_pending'}, {purpose:'panic.gc-confirmed'},
      {vault:'delete-backup'}, {cloudDeleted:true},
      {allS3ReplicasDeleted:true}, {matrixRevoked:true},
      {serverAck:true}, {acknowledgedAt:new Date(NOW+2000).toISOString()},
      {deletedLocations:['s3-a','s3-b']},
    ]) {
      const forged = await serverSign({...f.statement, ...changes}, f.server.privateKey)
      await expect(verifyPanicPreflightEvidence(
        forged, f.original, SCOPE, f.deviceSpki, f.serverSpki, NOW+3000))
        .rejects.toThrow('panic.invalid_preflight_evidence')
    }
  })

  it('binds verified original signed device intent; fresh operation cannot borrow old evidence', async () => {
    const f = await fixture()
    const another = await createSignedPanicIntent(SCOPE, f.device.privateKey, NOW)
    await expect(verifyPanicPreflightEvidence(
      f.signed, another, SCOPE, f.deviceSpki, f.serverSpki, NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
    const forged: SignedPanicIntent = {
      ...f.original, signature:(await sign(f.server.privateKey,
        'photobunker.panic.intent.v1\n'+f.original.contract)),
    }
    await expect(verifyPanicPreflightEvidence(
      f.signed, forged, SCOPE, f.deviceSpki, f.serverSpki, NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
  })

  it('rejects changed account, device, revision, operation ID and digest despite valid server re-signing', async () => {
    const f = await fixture()
    for (const patch of [
      {accountId: UUID(8)}, {deviceId: UUID(9)},
      {operationId:UUID(10)}, {keyRevision:4},
      {contractHash:'f'.repeat(64)}, {contractHash:'INVALID'},
      {accountId:'garbage'}, {keyRevision:3.5},
    ]) {
      const forged = await serverSign({...f.statement,...patch}, f.server.privateKey)
      await expect(verifyPanicPreflightEvidence(
        forged, f.original, SCOPE, f.deviceSpki, f.serverSpki, NOW+3000))
        .rejects.toThrow('panic.invalid_preflight_evidence')
    }
    await expect(verifyPanicPreflightEvidence(
      f.signed, f.original, {...SCOPE,deviceId:UUID(10)},
      f.deviceSpki,f.serverSpki,NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
  })

  it('rejects whitespace, noncanonical order, duplicate JSON keys and non-object payloads', async () => {
    const f = await fixture()
    const reversed = JSON.stringify(Object.fromEntries(
      Object.entries(f.statement).reverse()))
    const doubleKey = f.signed.statement.replace(/^\{/, '{"phase":"preflight_only",')
    for (const value of [
      reversed,doubleKey,f.signed.statement+'\n','not-json','null',
      '[]','{}',
    ]) {
      expect(() => parsePanicPreflightEvidence(value))
        .toThrow('panic.invalid_preflight_evidence')
    }
    const bad = {...f.signed, statement:reversed}
    await expect(verifyPanicPreflightEvidence(
      bad, f.original, SCOPE,f.deviceSpki,f.serverSpki,NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
  })

  it('checks strictly scoped wire and P1363 signature shape', async () => {
    const f = await fixture()
    for (const input of [
      {statement:f.signed.statement},
      {...f.signed,signature:'@bad'},
      {...f.signed,signature:b64(new Uint8Array(63))},
      {...f.signed,clientSigningKey:'attack'},
      {...f.signed,proof:'cloud-deleted'},
      null,[],{},
    ]) {
      await expect(verifyPanicPreflightEvidence(
        input,f.original,SCOPE,f.deviceSpki,f.serverSpki,NOW+3000))
        .rejects.toThrow('panic.invalid_preflight_evidence')
    }
  })

  it('rejects cross-purpose ECDSA signing and mutation of original signed statement', async () => {
    const f = await fixture()
    const wrongDomain = await serverSign(f.statement,f.server.privateKey,
      'photobunker.panic.intent.v1\n')
    await expect(verifyPanicPreflightEvidence(
      wrongDomain,f.original,SCOPE,f.deviceSpki,f.serverSpki,NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
    await expect(verifyPanicPreflightEvidence(
      {...f.signed,statement:canonical({...f.statement,recordedAt:new Date(NOW).toISOString()})},
      f.original,SCOPE,f.deviceSpki,f.serverSpki,NOW+3000))
      .rejects.toThrow('panic.invalid_preflight_evidence')
  })

  it('permits delayed original signed offline preflight evidence, but never future-date spoofing', async () => {
    const f = await fixture()
    await expect(verifyPanicPreflightEvidence(
      f.signed,f.original,SCOPE,f.deviceSpki,f.serverSpki,NOW+365*86400000))
      .resolves.toBeDefined()
    const edge = await serverSign({...f.statement,recordedAt:new Date(NOW+120000).toISOString()},
      f.server.privateKey)
    await expect(verifyPanicPreflightEvidence(
      edge,f.original,SCOPE,f.deviceSpki,f.serverSpki,NOW))
      .resolves.toBeDefined()
    const future = await serverSign({...f.statement,recordedAt:new Date(NOW+120001).toISOString()},
      f.server.privateKey)
    await expect(verifyPanicPreflightEvidence(
      future,f.original,SCOPE,f.deviceSpki,f.serverSpki,NOW))
      .rejects.toThrow('panic.invalid_preflight_evidence')
    for (const issuedAt of ['2026-12-01T10:00:00Z', '2026-02-30T10:00:00.000Z','broken']) {
      const malformed = await serverSign({...f.statement,recordedAt:issuedAt},f.server.privateKey)
      await expect(verifyPanicPreflightEvidence(
        malformed,f.original,SCOPE,f.deviceSpki,f.serverSpki,NOW+3000))
        .rejects.toThrow('panic.invalid_preflight_evidence')
    }
  })
})
