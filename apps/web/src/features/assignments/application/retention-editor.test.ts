import {describe,expect,it} from 'vitest'
import {buildEditorRetention,retentionDraftFromListing} from './retention-editor'
import {
  assignmentFilesOpenAt,assignmentOpenAt,
  signedAssignmentRetention,validAssignmentRetention,
} from './assignment-outbox'
import type {AssignmentListing,AssignmentRetention} from './assignment-outbox'

function listing():AssignmentListing{
  return {
    assignmentId:crypto.randomUUID(),ownerAccountId:crypto.randomUUID(),
    ownerAccountSpki:'owner-account-spki',state:'active',revision:1,
    policyRevision:1,privateRevision:1,
    policyContract:'root-owner-signed-contract',policySignature:'owner-signature',
    privateEnvelope:{version:1,iv:'',ciphertext:'',wrappedKey:{iv:'',ciphertext:''}},
    photoGoal:30,confirmedPhotoCount:0,
    stateContract:null,stateSignature:null,
    startsAt:Date.now()-3600000,endsAt:null,
  }
}

describe('P1-21 signed logical retention; contributor originals remain independent',()=>{
  it('defaults to OFF and does not imply any physical deletion consent',()=>{
    const root=listing()
    const value=signedAssignmentRetention(root)
    expect(value).toEqual({
      filesAccessUntil:null,assignmentAccessUntil:null,deleteOriginals:false,
    })
    expect(retentionDraftFromListing(root)).toEqual({
      filesEnabled:false,filesDate:'',
      assignmentEnabled:false,assignmentDate:'',
    })
    expect(assignmentFilesOpenAt(root,Date.now())).toBe(true)
    expect(validAssignmentRetention({
      ...value,deleteOriginals:true,
    } as unknown as AssignmentRetention)).toBe(false)
  })

  it('preserves signed millisecond precision in unchanged local datetime fields',()=>{
    const now=Date.now()
    const value:AssignmentRetention={
      filesAccessUntil:now+86400000+187,
      assignmentAccessUntil:now+172800000+419,
      deleteOriginals:false,
    }
    const row={
      ...listing(),
      retentionRevision:2,
      retentionAmendmentContract:JSON.stringify(value),
      filesAccessUntil:value.filesAccessUntil,
      assignmentAccessUntil:value.assignmentAccessUntil,
    }
    const draft=retentionDraftFromListing(row)
    expect(buildEditorRetention(draft,signedAssignmentRetention(row),null,now))
      .toEqual(value)
    expect(assignmentFilesOpenAt(row,value.filesAccessUntil!-1)).toBe(true)
    expect(assignmentFilesOpenAt(row,value.filesAccessUntil!)).toBe(false)
    expect(assignmentOpenAt(row,value.filesAccessUntil!)).toBe(true)
    expect(assignmentOpenAt(row,value.assignmentAccessUntil!)).toBe(false)
  })

  it('rejects reversed, expired, before-schedule, missing and malformed dates',()=>{
    const now=Date.now()
    const row=listing()
    const baseline=signedAssignmentRetention(row)
    const future=new Date(now+8*86400000)
    const later=new Date(now+10*86400000)
    const formatted=(date:Date):string=>{
      const pad=(n:number)=>String(n).padStart(2,'0')
      return [
        date.getFullYear(),
        pad(date.getMonth()+1),pad(date.getDate()),
      ].join('-')+'T'+pad(date.getHours())+':'+pad(date.getMinutes())
    }
    const draft={
      filesEnabled:true,filesDate:formatted(future),
      assignmentEnabled:true,assignmentDate:formatted(later),
    }
    expect(buildEditorRetention(draft,baseline,null,now).filesAccessUntil)
      .toBeGreaterThan(now)
    expect(()=>buildEditorRetention({
      ...draft,assignmentDate:formatted(new Date(now+7*86400000)),
    },baseline,null,now)).toThrow('assignment.retention_invalid_deadline')
    expect(()=>buildEditorRetention(draft,baseline,now+9*86400000,now))
      .toThrow('assignment.retention_invalid_deadline')
    expect(()=>buildEditorRetention(draft,baseline,null,now+11*86400000))
      .toThrow('assignment.retention_invalid_deadline')
    expect(()=>buildEditorRetention({...draft,filesDate:''},baseline,null,now))
      .toThrow('assignment.retention_invalid_date')
    expect(()=>buildEditorRetention({
      ...draft,filesDate:'2027-02-30T11:30',
    },baseline,null,now)).toThrow('assignment.retention_invalid_date')
  })
})
