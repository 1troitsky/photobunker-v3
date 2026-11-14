import {describe, expect, it, vi} from 'vitest'
import {createSignedPanicIntent} from '../domain/panic-intent'
import type {PanicIntentScope, SignedPanicIntent} from '../domain/panic-intent'
import {observePreparedPanicStatus} from './panic-preflight-status-client'
import {digest, exportSpki, hex, newSigning} from '../../identity/infrastructure/crypto'

const UUID = (n: number) => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0')
const SCOPE: PanicIntentScope = {accountId: UUID(1), deviceId: UUID(2), keyRevision: 4}
const NOW = 1_800_000_000_000

async function fixture() {
  const keys = await newSigning(true)
  const publicSpki = await exportSpki(keys.publicKey)
  const original = await createSignedPanicIntent(SCOPE, keys.privateKey, NOW)
  const contract = JSON.parse(original.contract) as {operationId: string}
  const response = {
    phase: 'preflight_only',
    operationId: contract.operationId,
    contractHash: hex(await digest(new TextEncoder().encode(original.contract))),
    recordedAt: new Date(NOW + 1000).toISOString(),
  }
  return {keys, publicSpki, original, response}
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: {'Content-Type': 'application/json; charset=utf-8'},
  })
}

const options = (request: (_url: string, _init: RequestInit) => Promise<Response>) =>
  ({request, nowMs: NOW + 3000})

describe('P3 #221 GET-only original-signed intent preflight observation — NEVER a server ACK', () => {
  it('observes a READ-ONLY same-origin prepared row without ever claiming deletion', async () => {
    const f = await fixture()
    const req = vi.fn(async () => json(f.response))
    const result = await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(req))
    expect(result).toEqual({
      kind: 'observed_preflight_only_unconfirmed',
      operationId: f.response.operationId,
      contractHash: f.response.contractHash,
      recordedAt: f.response.recordedAt,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/cloud.deleted|server.revoked|delete.success|backup.preserved/i)
    expect(req).toHaveBeenCalledTimes(1)
    expect(req).toHaveBeenCalledWith(
      '/panic/v1/preflight/' + f.response.operationId,
      {
        method: 'GET', credentials: 'same-origin', mode: 'same-origin',
        cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      },
    )
    expect(JSON.stringify(req.mock.calls)).not.toContain(f.original.signature)
  })

  it('never sends HTTP for wrong original device signing key or caller identity', async () => {
    const f = await fixture()
    const foreign = await newSigning(true)
    const req = vi.fn(async () => json(f.response))
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, await exportSpki(foreign.publicKey), options(req)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_local_intent'})
    for (const wrong of [
      {...SCOPE, accountId: UUID(9)},
      {...SCOPE, deviceId: UUID(9)},
      {...SCOPE, keyRevision: 5},
    ]) {
      expect(await observePreparedPanicStatus(
        f.original, wrong, f.publicSpki, options(req)))
        .toEqual({kind: 'unconfirmed', reason: 'invalid_local_intent'})
    }
    expect(req).not.toHaveBeenCalled()
  })

  it('never sends HTTP for unsigned/tampered/widened local Panic scope', async () => {
    const f = await fixture()
    const req = vi.fn(async () => json(f.response))
    for (const changed of [
      {...f.original, signature: 'invalid'},
      {...f.original, contract: '{}'},
      {...f.original, contract: f.original.contract.replace(
        'preserve-existing-verified', 'delete-every-backup')},
      {...f.original, serverAck: true} as unknown as SignedPanicIntent,
    ]) {
      expect(await observePreparedPanicStatus(
        changed, SCOPE, f.publicSpki, options(req)))
        .toEqual({kind: 'unconfirmed', reason: 'invalid_local_intent'})
    }
    expect(req).not.toHaveBeenCalled()
  })

  it('maps 401/403 to session unavailable, not a successful revoke or remote wipe', async () => {
    const f = await fixture()
    for (const status of [401, 403]) {
      const request = vi.fn(async () => json({error: 'unauthorized'}, status))
      expect(await observePreparedPanicStatus(
        f.original, SCOPE, f.publicSpki, options(request)))
        .toEqual({kind: 'unconfirmed', reason: 'session_unavailable'})
      expect(request).toHaveBeenCalledTimes(1)
    }
  })

  it('treats 404 as ambiguous — unmounted route, foreign/missing row or revoked, not proof of deletion', async () => {
    const f = await fixture()
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => json({error: 'not found'}, 404))))
      .toEqual({kind: 'unconfirmed', reason: 'not_observable'})
  })

  it('maps HTTP 429, 5xx, network outage and abort to UNKNOWN without retry', async () => {
    const f = await fixture()
    for (const status of [429, 500, 502, 503]) {
      const request = vi.fn(async () => json({error: 'try again later'}, status))
      expect(await observePreparedPanicStatus(
        f.original, SCOPE, f.publicSpki, options(request)))
        .toEqual({kind: 'unconfirmed', reason: 'network_unavailable'})
      expect(request).toHaveBeenCalledTimes(1)
    }
    for (const error of [new TypeError('Failed to fetch'), new DOMException('Aborted', 'AbortError')]) {
      const request = vi.fn(async (): Promise<Response> => { throw error })
      expect(await observePreparedPanicStatus(
        f.original, SCOPE, f.publicSpki, options(request)))
        .toEqual({kind: 'unconfirmed', reason: 'network_unavailable'})
      expect(request).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects a malicious claimed cloud-deleted or server-revoked status even on HTTP 200', async () => {
    const f = await fixture()
    for (const patch of [
      {phase: 'cloud_deleted'},
      {phase: 'server_revoked'},
      {phase: 'cloud_delete_pending'},
      {phase: 'backup_preserved'},
      {ack: true}, {success: true}, {s3Gc: 'complete'},
      {matrixRevoked: true}, {deleteReceipt: 'yes'},
    ]) {
      expect(await observePreparedPanicStatus(
        f.original, SCOPE, f.publicSpki,
        options(async () => json({...f.response, ...patch}))))
        .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    }
  })

  it('binds operationId/hash exactly to ORIGINAL signed bytes, not fresh retry or another device', async () => {
    const f = await fixture()
    const another = await createSignedPanicIntent(SCOPE, f.keys.privateKey, NOW)
    for (const patch of [
      {operationId: UUID(10)},
      {operationId: another && JSON.parse(another.contract).operationId as string},
      {contractHash: 'a'.repeat(64)},
      {contractHash: 'not-a-digest'},
    ]) {
      expect(await observePreparedPanicStatus(
        f.original, SCOPE, f.publicSpki,
        options(async () => json({...f.response, ...patch}))))
        .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    }
    expect(await observePreparedPanicStatus(
      another, SCOPE, f.publicSpki, options(async () => json(f.response))))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
  })

  it('rejects missing and extra keys, arrays, non-JSON and oversized response bodies', async () => {
    const f = await fixture()
    const invalid = [
      null, [], {}, {operationId: f.response.operationId},
      {...f.response, contract: f.original.contract},
      {...f.response, signature: f.original.signature},
      {...f.response, keyRevision: SCOPE.keyRevision},
      {...f.response, recordedAt: null},
    ]
    for (const body of invalid) {
      expect(await observePreparedPanicStatus(
        f.original, SCOPE, f.publicSpki, options(async () => json(body))))
        .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    }
    const unparseable = new Response('not-json', {
      status: 200, headers: {'Content-Type': 'application/json'},
    })
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => unparseable)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    const oversized = new Response(JSON.stringify({...f.response, pad: 'x'.repeat(900)}), {
      status: 200, headers: {'Content-Type': 'application/json'},
    })
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => oversized)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
  })

  it('refuses redirects, opaque responses, invalid MIME and suspicious content length', async () => {
    const f = await fixture()
    const redirect = json(f.response)
    Object.defineProperty(redirect, 'redirected', {value: true})
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => redirect)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    const opaque = json(f.response)
    Object.defineProperty(opaque, 'type', {value: 'opaque'})
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => opaque)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    const html = new Response(JSON.stringify(f.response), {
      status: 200, headers: {'Content-Type': 'text/html'},
    })
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => html)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    const long = new Response(JSON.stringify(f.response), {
      status: 200, headers: {
        'Content-Type': 'application/json', 'Content-Length': '1000',
      },
    })
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => long)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
  })

  it('checks strict UTC timestamp and future skew without expiring old prepared rows', async () => {
    const f = await fixture()
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, {
        request: async () => json(f.response),
        nowMs: NOW + 180 * 86400000,
      }))
      .toMatchObject({kind: 'observed_preflight_only_unconfirmed'})
    for (const recordedAt of [
      'wrong', '2026-02-30T12:00:00.000Z',
      '2026-01-01T00:00:00Z', new Date(NOW + 123_001).toISOString(),
    ]) {
      expect(await observePreparedPanicStatus(
        f.original, SCOPE, f.publicSpki, {
          request: async () => json({...f.response, recordedAt}),
          nowMs: NOW + 2000,
        }))
        .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    }
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, {...options(async () => json(f.response)), nowMs: Infinity}))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_local_intent'})
  })

  it('rejects duplicate JSON keys and whitespace even if parsed last value falsely looks prepared', async () => {
    const f = await fixture()
    const raw = JSON.stringify(f.response)
    const tricks = [
      raw.replace('"phase":"preflight_only"', '"phase":"cloud_deleted","phase":"preflight_only"'),
      raw.replace('"operationId":', '"operationId":"'+UUID(9)+'","operationId":'),
      ' ' + raw,
      raw + '\\n',
      JSON.stringify(Object.fromEntries(Object.entries(f.response).reverse())),
    ]
    for (const forged of tricks) {
      const request = vi.fn(async () => new Response(forged, {
        status: 200, headers: {'Content-Type': 'application/json'},
      }))
      expect(await observePreparedPanicStatus(
        f.original, SCOPE, f.publicSpki, options(request)))
        .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
      expect(request).toHaveBeenCalledTimes(1)
    }
  })

  it('bounds ACTUAL streamed bytes without trusting missing or fabricated Content-Length', async () => {
    const f = await fixture()
    for (const header of [undefined, '2']) {
      let canceled = false
      const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          // A single chunk already exceeds 512 bytes. Do not collect all
          // chunks, or allow a dishonest tiny Content-Length to bypass cap.
          controller.enqueue(new Uint8Array(2_000).fill(65))
        },
        cancel() { canceled = true },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...(header === undefined ? {} : {'Content-Length': header}),
        },
      })
      expect(await observePreparedPanicStatus(
        f.original, SCOPE, f.publicSpki, options(async () => response)))
        .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
      expect(canceled).toBe(true)
    }
  })

  it('supports bounded streaming chunks and rejects an endless sequence of empty chunks', async () => {
    const f = await fixture()
    const bytes = new TextEncoder().encode(JSON.stringify(f.response))
    let offset = 0
    const normal = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) { controller.close(); return }
        controller.enqueue(bytes.slice(offset, offset + 16))
        offset += 16
      },
    }), {status: 200, headers: {'Content-Type': 'application/json'}})
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => normal)))
      .toMatchObject({kind: 'observed_preflight_only_unconfirmed'})

    let cancelled = false
    const looping = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {controller.enqueue(new Uint8Array(0))},
      cancel() {cancelled = true},
    }), {status: 200, headers: {'Content-Type': 'application/json'}})
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => looping)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    expect(cancelled).toBe(true)
  })

  it('rejects invalid UTF-8 bytes and missing response stream without false confirmation', async () => {
    const f = await fixture()
    const original = new TextEncoder().encode(JSON.stringify(f.response))
    const poisoned = new Uint8Array(original.length + 1)
    poisoned.set(original.slice(0, 15))
    poisoned[15] = 0xff
    poisoned.set(original.slice(15), 16)
    const bad = new Response(poisoned, {
      status: 200, headers: {'Content-Type': 'application/json'},
    })
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => bad)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
    const missingBody = new Response(null, {
      status: 200, headers: {'Content-Type': 'application/json'},
    })
    expect(await observePreparedPanicStatus(
      f.original, SCOPE, f.publicSpki, options(async () => missingBody)))
      .toEqual({kind: 'unconfirmed', reason: 'invalid_response'})
  })

})
