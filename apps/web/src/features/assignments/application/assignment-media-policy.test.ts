import {describe,expect,it} from 'vitest'
import {
  validAllowedMedia,signedAllowedAssignmentMedia,signedPolicyRequirements,
} from './assignment-outbox'
import type {AssignmentListing} from './assignment-outbox'

function policy(revision:number,body?:Record<string,unknown>):AssignmentListing{
  return {
    assignmentId:'00000000-0000-4000-8000-000000000001',
    ownerAccountId:'00000000-0000-4000-8000-000000000002',
    ownerAccountSpki:'unverified fixture',
    state:'active',revision:1,policyRevision:revision,
    policyContract:'{}',policySignature:'',
    policyAmendmentContract:body?JSON.stringify(body):null,
    policyAmendmentSignature:body?'synthetic':'',
    photoGoal:30,confirmedPhotoCount:0,
    privateEnvelope:{} as AssignmentListing['privateEnvelope'],
    stateContract:null,stateSignature:null,startsAt:Date.now(),endsAt:null,
  }
}
describe('P1-13 signed media type policy',()=>{
  it('never treats an original photo-only assignment as video/audio permission',()=>{
    expect(signedAllowedAssignmentMedia(policy(1))).toEqual(['photo'])
    expect(signedAllowedAssignmentMedia(policy(2,{version:2,
      requiredGps:false,requiredCategory:false,descriptionMinLength:0,
      allowedMedia:['photo'],
    }))).toEqual(['photo'])
  })
  it('allows only canonical photo-first v3 opt-in shapes',()=>{
    for(const types of [
      ['photo'],['photo','video'],['photo','audio'],
      ['photo','video','audio'],
    ]){
      expect(validAllowedMedia(types)).toBe(true)
      expect(signedAllowedAssignmentMedia(policy(2,{
        version:3,allowedMedia:types,
      }))).toEqual(types)
    }
    for(const wrong of [
      ['video'],['audio'],[],['photo','photo'],
      ['photo','audio','video'],['video','photo'],['photo','unexpected'],
    ]){
      expect(validAllowedMedia(wrong)).toBe(false)
      expect(()=>signedAllowedAssignmentMedia(policy(2,{
        version:3,allowedMedia:wrong,
      }))).toThrow('assignment.invalid_allowed_media')
    }
  })
  it('retains required PHOTO metadata flags in v3 without treating them as verified for video',()=>{
    const root=policy(2,{
      version:3,allowedMedia:['photo','video'],
      requiredGps:true,requiredCategory:true,descriptionMinLength:15,
    })
    expect(signedPolicyRequirements(root)).toEqual({
      requiredGps:true,requiredCategory:true,descriptionMinLength:15,
    })
    expect(()=>signedPolicyRequirements(policy(2,{
      version:3,allowedMedia:['photo','video'],
      requiredGps:'yes',requiredCategory:true,descriptionMinLength:15,
    }))).toThrow('assignment.invalid_capture_requirements')
  })
})
