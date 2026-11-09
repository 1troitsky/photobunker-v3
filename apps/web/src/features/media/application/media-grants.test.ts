import {describe,it,expect} from 'vitest'
import {parseMediaGrantContract} from './media-grants'
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
    expect(()=>parseMediaGrantContract({...fixture(),version:2})).toThrow()
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
