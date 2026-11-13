import {describe,it,expect} from 'vitest'
import {
  parseMediaGrantContract,mediaGrantExpiry,
  MEDIA_GRANT_MAX_TTL_MS,MEDIA_GRANT_CLOCK_MARGIN_MS,
} from './media-grants'
import type {MediaGrantContract} from './media-grants'

const uuid=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
function fixture():MediaGrantContract{
  return {
    version:1,grantId:uuid(1),mediaId:uuid(2),
    ownerAccountId:uuid(3),recipientAccountId:uuid(4),
    recipientKeyDigest:'a'.repeat(64),mediaContractHash:'b'.repeat(64),
    scope:'read',expiresAt:Date.now()+86400000,
    envelope:{
      ephemeralSpki:'test-signed-SPKI',
      salt:'AAAAAAAAAAAAAAAAAAAAAA',
      iv:'AAAAAAAAAAAAAAAA',
      ciphertext:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    },
  }
}
describe('P1-11 immutable owner-signed media recipient scope',()=>{
  it('accepts exact one-DEK read scope and rejects write/download/public variants',()=>{
    expect(parseMediaGrantContract(fixture()).scope).toBe('read')
    for(const scope of ['write','download','original','public']){
      expect(()=>parseMediaGrantContract({
        ...fixture(),scope,
      })).toThrow('media_grant.invalid_scope')
    }
    // Old independent v1 shares cannot quietly acquire an assignment scope.
    expect(()=>parseMediaGrantContract({...fixture(),version:2})).toThrow()
    expect(()=>parseMediaGrantContract({...fixture(),
      assignmentId:uuid(5),
    })).toThrow()
    // New v2 ECDH grant explicitly names exactly one Fieldwork assignment.
    const scoped:MediaGrantContract={
      ...fixture(),version:2,assignmentId:uuid(5),
    }
    expect(parseMediaGrantContract(scoped).assignmentId).toBe(uuid(5))
    expect(()=>parseMediaGrantContract({
      ...scoped,assignmentId:null,
    })).toThrow()
    expect(()=>parseMediaGrantContract({
      ...scoped,assignmentId:'not-a-uuid',
    })).toThrow()
    expect(()=>parseMediaGrantContract({
      ...scoped,recipientAccountId:uuid(99),rogueDEK:'plaintext',
    })).toThrow()
    expect(()=>parseMediaGrantContract({...fixture(),
      recipientKeyDigest:'ff',
    })).toThrow()
    expect(()=>parseMediaGrantContract({...fixture(),
      envelope:{...fixture().envelope,ciphertext:'short'},
    })).toThrow()
    expect(()=>parseMediaGrantContract({...fixture(),
      envelope:{...fixture().envelope,extra:'surprise'},
    })).toThrow()
    expect(()=>parseMediaGrantContract({...fixture(),
      rawDEK:'never',
    })).toThrow()
  })
})

describe('P1 media clock-boundary grant expiry',()=>{
  const nowMs=1_800_000_000_000

  it('avoids 422 for an exact 24h grant when client clock is ahead by milliseconds',()=>{
    const expiresAt=mediaGrantExpiry(nowMs+2*86400000,nowMs)
    expect(expiresAt).toBe(nowMs+MEDIA_GRANT_MAX_TTL_MS-MEDIA_GRANT_CLOCK_MARGIN_MS)
    for(const clockAheadMs of [3,1000,120000,MEDIA_GRANT_CLOCK_MARGIN_MS]){
      const serverNowMs=nowMs-clockAheadMs
      expect(expiresAt).toBeLessThanOrEqual(serverNowMs+MEDIA_GRANT_MAX_TTL_MS)
    }
    // Without a clock reserve a +3 ms client lead creates a 422.
    expect(nowMs+MEDIA_GRANT_MAX_TTL_MS).toBeGreaterThan(
      nowMs-3+MEDIA_GRANT_MAX_TTL_MS)
  })

  it('preserves the strict media and assignment deadlines',()=>{
    const mediaExpiry=nowMs+600000
    const assignmentExpiry=nowMs+120000
    expect(mediaGrantExpiry(mediaExpiry,nowMs)).toBe(mediaExpiry)
    expect(mediaGrantExpiry(mediaExpiry,nowMs,assignmentExpiry))
      .toBe(assignmentExpiry)
    expect(mediaGrantExpiry(nowMs+2*86400000,nowMs,null))
      .toBe(nowMs+MEDIA_GRANT_MAX_TTL_MS-MEDIA_GRANT_CLOCK_MARGIN_MS)
  })

  it('rejects expired or untrusted deadline inputs before signing a grant',()=>{
    for(const limit of [nowMs,nowMs-1,Number.NaN,
      Number.POSITIVE_INFINITY,0,-1,1.23]){
      expect(()=>mediaGrantExpiry(nowMs+86400000,nowMs,limit))
        .toThrow()
    }
    expect(()=>mediaGrantExpiry(nowMs-1,nowMs)).toThrow(
      'media_grant.assignment_access_expired')
    expect(()=>mediaGrantExpiry(nowMs+86400000,Number.NaN))
      .toThrow('media_grant.invalid_expiry_bounds')
  })
})
