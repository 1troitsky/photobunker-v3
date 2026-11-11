import {describe,it,expect} from 'vitest'
import {parseEditorialLink,parseEditorialDetach} from './safe-assignment-editorial'

const uuid=(x:string)=>x.repeat(8)+'-'+x.repeat(4)+'-4'+x.repeat(3)
  +'-8'+x.repeat(3)+'-'+x.repeat(12)
const base=()=>({
  version:1,linkId:uuid('a'),operationId:uuid('b'),
  ownerAccountId:uuid('c'),assignmentId:uuid('d'),
  sourceMediaId:uuid('e'),safeMediaId:uuid('f'),
  sourceContractHash:'a'.repeat(64),safeContractHash:'b'.repeat(64),
  assignmentRootHash:'c'.repeat(64),expiresAt:1830000000000,
})
describe('P2 owner-only editorial source+safe+assignment binding',()=>{
  it('accepts distinct signed three-way IDs but never includes public rights',()=>{
    const c=parseEditorialLink(base())
    expect(c.safeMediaId).not.toBe(c.sourceMediaId)
    expect(Object.keys(c)).not.toContain('publicUrl')
    expect(Object.keys(c)).not.toContain('grant')
    expect(Object.keys(c)).not.toContain('keyEnvelope')
  })
  it('rejects foreign fields, source confusion, malformed commitments and owner',()=>{
    const c=base()
    for(const x of [
      {...c,version:2}, {...c,sourceMediaId:c.safeMediaId},
      {...c,ownerAccountId:'unknown'}, {...c,assignmentId:'unknown'},
      {...c,sourceContractHash:'bad'}, {...c,safeContractHash:'bad'},
      {...c,assignmentRootHash:'bad'},
      {...c,expiresAt:Infinity}, {...c,expiresAt:-1},
      {...c,publication:'enabled'}, {...c,publicToken:'secret'},
      {...c,recipientAccountId:uuid('3')},
      {...c,grantId:uuid('4')},
    ]){
      expect(()=>parseEditorialLink(x)).toThrow('safe_editorial.invalid_contract')
    }
  })
  it('accepts only exact signed DETACH request with original link hash',()=>{
    const c={version:1,operationId:uuid('a'),linkId:uuid('b'),
      ownerAccountId:uuid('c'),safeMediaId:uuid('d'),
      linkContractHash:'a'.repeat(64),action:'detach' as const}
    expect(parseEditorialDetach(c).action).toBe('detach')
    for(const bad of [
      {...c,action:'attach'}, {...c,action:'delete-file'},
      {...c,linkContractHash:'bad'}, {...c,rawDEK:'leak'},
      {...c,originalDelete:true},
      {...c,safeMediaId:'oops'},
    ]){
      expect(()=>parseEditorialDetach(bad))
        .toThrow('safe_editorial.invalid_detach')
    }
  })
})
