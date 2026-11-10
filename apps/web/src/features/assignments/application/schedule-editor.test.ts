import { describe,expect,it } from 'vitest'
import { buildEditorSchedule,scheduleDraftFromListing } from './schedule-editor'
import { signedAssignmentSchedule,schedulePermitsAt } from './assignment-outbox'
import type { AssignmentListing } from './assignment-outbox'

function listing():AssignmentListing{
  const start=Date.now()-3600000
  return {
    assignmentId:crypto.randomUUID(),ownerAccountId:crypto.randomUUID(),
    ownerAccountSpki:'trusted-account-key',
    state:'active',revision:1,policyRevision:1,privateRevision:1,
    policyContract:'signed-root',policySignature:'signature',
    privateEnvelope:{version:1,iv:'',ciphertext:'',wrappedKey:{iv:'',ciphertext:''}},
    photoGoal:30,confirmedPhotoCount:0,
    stateContract:null,stateSignature:null,
    startsAt:start,endsAt:null,
  }
}
describe('P1-20 lossless local datetime display and independent signed time gates',()=>{
  it('preserves original signed millisecond precision when datetime-local input is unchanged',()=>{
    const root=listing()
    root.startsAt+=971
    root.endsAt=Date.now()+86400000+487
    const original=signedAssignmentSchedule(root)
    expect(original.blockBeforeStart).toBe(true)
    expect(original.blockAfterEnd).toBe(true)
    const draft=scheduleDraftFromListing(root)
    const exact=buildEditorSchedule(draft,original)
    expect(exact).toEqual(original)
    expect(schedulePermitsAt(root,root.startsAt-1)).toBe(false)
    expect(schedulePermitsAt(root,root.startsAt)).toBe(true)
    expect(schedulePermitsAt(root,root.endsAt)).toBe(false)
  })
  it('allows genuinely optional before/after gates and rejects nonsensical or missing dates',()=>{
    const root=listing()
    const initial=signedAssignmentSchedule(root)
    const draft=scheduleDraftFromListing(root)
    draft.startsAt='2027-03-21T09:30'
    draft.endsAt='2027-03-22T09:30'
    draft.blockBeforeStart=false
    draft.blockAfterEnd=false
    const changed=buildEditorSchedule(draft,initial)
    expect(changed.startsAt).toBeGreaterThan(Date.now())
    expect(changed.endsAt).toBeGreaterThan(changed.startsAt)
    expect(changed.blockAfterEnd).toBe(false)
    draft.blockAfterEnd=true
    draft.endsAt=''
    expect(()=>buildEditorSchedule(draft,initial)).toThrow('assignment.invalid_schedule')
    draft.startsAt=''
    expect(()=>buildEditorSchedule(draft,initial)).toThrow('assignment.schedule_start_required')
    draft.startsAt='2027-02-30T19:40'
    expect(()=>buildEditorSchedule(draft,initial)).toThrow('assignment.invalid_schedule_date')
  })
})
