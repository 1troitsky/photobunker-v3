import {describe,it,expect} from 'vitest'
import {
  emptyPreviewFields,parseFilePreviewContract,PREVIEW_FIELD_KEYS,
} from './media-file-preview-policy'
import type {PreviewContract} from './media-file-preview-policy'
const u=(n:string)=>n.repeat(8)+'-'+n.repeat(4)+'-4'+n.repeat(3)
  +'-8'+n.repeat(3)+'-'+n.repeat(12)
const example=():PreviewContract=>({
  version:1,operationId:u('a'),accountId:u('b'),
  sourceMediaId:u('c'),safeMediaId:u('d'),
  sourceContractHash:'a'.repeat(64),safeContractHash:'b'.repeat(64),
  fromRevision:0,toRevision:1,previousPolicyHash:'0'.repeat(64),
  publication:'disabled',fields:emptyPreviewFields(),
  actions:{view:false,copy:false,download:false,share:false},
  expiresAt:1810000000000,
})
describe('private, signed future-Public-Card file preview policy',()=>{
  it('starts with every disclosed metadata field OFF',()=>{
    expect(Object.values(emptyPreviewFields())).toEqual(
      Array(PREVIEW_FIELD_KEYS.length).fill(false))
    expect(Object.values(example().actions)).toEqual(
      [false,false,false,false])
    expect(parseFilePreviewContract(example()).publication).toBe('disabled')
  })
  it('permits ONLY future display-field ceilings, not actual publication',()=>{
    const e=example()
    const p={...e,fields:{...e.fields,
      description:true,tags:true,gps:true}}
    expect(parseFilePreviewContract(p).fields.gps).toBe(true)
    const forbidden=[
      {...e,publication:'public'}, {...e,publication:'enabled'},
      {...e,actions:{...e.actions,view:true}},
      {...e,actions:{...e.actions,copy:true}},
      {...e,actions:{...e.actions,download:true}},
      {...e,actions:{...e.actions,share:true}},
      {...e,fields:{...e.fields,original:true}},
      {...e,fields:{...e.fields,gps:'yes'}},
      {...e,sourceMediaId:e.safeMediaId},
      {...e,operationId:'invalid'},
      {...e,previousPolicyHash:'x'},
      {...e,safeContractHash:'x'},
      {...e,toRevision:3},
      {...e,fromRevision:-1},
      {...e,fromRevision:100,toRevision:101},
      {...e,expiresAt:Infinity}, {...e,expiresAt:0},
      {...e,rawKey:'secret'},
      {...e,actions:{download:false,copy:false,view:false}},
    ]
    for(const x of forbidden)
      expect(()=>parseFilePreviewContract(x))
        .toThrow('file_preview.invalid_contract')
  })
  it('allows signed next revision only for the exact distinct file pair',()=>{
    const first=example()
    expect(parseFilePreviewContract(first).fromRevision).toBe(0)
    const next={...first,fromRevision:1,toRevision:2,
      previousPolicyHash:'1'.repeat(64)}
    expect(parseFilePreviewContract(next).toRevision).toBe(2)
    expect(()=>parseFilePreviewContract(null))
      .toThrow('file_preview.invalid_contract')
    expect(()=>parseFilePreviewContract([]))
      .toThrow('file_preview.invalid_contract')
  })
})
