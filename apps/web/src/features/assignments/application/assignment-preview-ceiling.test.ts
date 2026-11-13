import {describe,it,expect} from 'vitest'
import {
  comparePrivatePreviewCeilings,parseAssignmentCeiling,
} from './assignment-preview-ceiling'
import type {AssignmentCeilingContract} from './assignment-preview-ceiling'
import {
  emptyPreviewFields,parseFilePreviewContract,
} from '../../media/application/media-file-preview-policy'
import type {PreviewContract} from '../../media/application/media-file-preview-policy'

const id=(x:string)=>x.repeat(8)+'-'+x.repeat(4)+'-4'+x.repeat(3)
  +'-8'+x.repeat(3)+'-'+x.repeat(12)
const example=():AssignmentCeilingContract=>({
  version:1,operationId:id('a'),assignmentId:id('b'),ownerAccountId:id('c'),
  rootPolicyHash:'a'.repeat(64),
  fromRevision:0,toRevision:1,previousPolicyHash:'0'.repeat(64),
  publication:'disabled',fields:emptyPreviewFields(),
  actions:{view:false,copy:false,download:false,share:false},
  expiresAt:1830000000000,
})
const file=():PreviewContract=>({
  version:1,operationId:id('d'),accountId:id('c'),
  sourceMediaId:id('e'),safeMediaId:id('f'),
  sourceContractHash:'d'.repeat(64),safeContractHash:'f'.repeat(64),
  fromRevision:0,toRevision:1,previousPolicyHash:'0'.repeat(64),
  publication:'disabled',fields:emptyPreviewFields(),
  actions:{view:false,copy:false,download:false,share:false},
  expiresAt:1830000000000,
})

describe('signed assignment-level PRIVATE preview metadata ceiling',()=>{
  it('starts closed for ALL seven metadata fields and actions',()=>{
    const value=parseAssignmentCeiling(example())
    expect(Object.values(value.fields).every(v=>v===false)).toBe(true)
    expect(Object.values(value.actions).every(v=>v===false)).toBe(true)
  })
  it('rejects forged public, download, unknown field, malformed chain',()=>{
    const x=example()
    for(const bad of [
      {...x,publication:'public'}, {...x,publication:'published'},
      {...x,actions:{...x.actions,view:true}},
      {...x,actions:{...x.actions,download:true}},
      {...x,actions:{...x.actions,copy:true}},
      {...x,actions:{...x.actions,share:true}},
      {...x,actions:{...x.actions,original:true}},
      {...x,fields:{...x.fields,gps:1}},
      {...x,fields:{...x.fields,privateText:true}},
      {...x,rootPolicyHash:'bad'}, {...x,ownerAccountId:'bad'},
      {...x,assignmentId:'bad'}, {...x,operationId:'bad'},
      {...x,previousPolicyHash:'bad'},
      {...x,fromRevision:-1}, {...x,fromRevision:100,toRevision:101},
      {...x,toRevision:4},
      {...x,expiresAt:Infinity}, {...x,expiresAt:-1},
      {...x,plaintextGps:'original'},
    ]){
      expect(()=>parseAssignmentCeiling(bad))
        .toThrow('assignment_preview.invalid_contract')
    }
  })
  it('computes the mathematical upper-ceiling AND, never actual public permission',()=>{
    const assignment={
      ...example(),fields:{...emptyPreviewFields(),
        description:true,updatedAt:true,tags:true,gps:true},
    }
    const safe={
      ...file(),fields:{...emptyPreviewFields(),
        description:true,capturedAt:true,tags:true,metadata:true},
    }
    expect(parseFilePreviewContract(safe).publication).toBe('disabled')
    const result=comparePrivatePreviewCeilings(assignment,safe,true)
    expect(result.candidateFields).toEqual({
      description:true,capturedAt:false,updatedAt:false,
      tags:true,authorTeam:false,gps:false,metadata:false,
    })
    expect(Object.values(result.effectivePublicFields)).toEqual(
      Array(7).fill(false))
    const blocked=comparePrivatePreviewCeilings(null,safe)
    expect(Object.values(blocked.candidateFields)).toEqual(
      Array(7).fill(false))
    expect(Object.values(comparePrivatePreviewCeilings(
      assignment,null).effectivePublicFields)).toEqual(Array(7).fill(false))
  })
})
