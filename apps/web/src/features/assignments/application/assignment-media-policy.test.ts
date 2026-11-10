import {describe,expect,it} from 'vitest'
import {
  validAllowedMedia,signedAllowedAssignmentMedia,signedPolicyRequirements,signedPolicyGoals,signedMediaRequirements,
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

describe('P1-15 independently signed multimedia target counts',()=>{
  it('reads v4 targets but never invents old v1-v3 goals',()=>{
    const legacy=policy(2,{version:3,allowedMedia:['photo','video']})
    expect(signedPolicyGoals(legacy)).toEqual({
      photoGoal:30,videoGoal:null,audioGoal:null,
    })
    expect(()=>signedPolicyGoals({...legacy,videoGoal:2}))
      .toThrow('assignment.unsigned_media_goal')
    const amended=policy(3,{
      version:4,photoGoal:30,videoGoal:2,audioGoal:1,
      allowedMedia:['photo','video','audio'],
    })
    expect(signedPolicyGoals({...amended,videoGoal:2,audioGoal:1}))
      .toEqual({photoGoal:30,videoGoal:2,audioGoal:1})
  })
  it('rejects forged projections, out-of-bounds counts, and goals for disabled types',()=>{
    const base=policy(2,{
      version:4,photoGoal:30,videoGoal:2,audioGoal:null,
      allowedMedia:['photo','video'],
    })
    expect(()=>signedPolicyGoals({...base,videoGoal:3}))
      .toThrow('assignment.invalid_signed_goal')
    expect(()=>signedPolicyGoals({...base,audioGoal:1,videoGoal:2}))
      .toThrow('assignment.invalid_signed_goal')
    for(const wrong of [0,-1,1.5,1000,'2']){
      const mutated=policy(2,{
        version:4,photoGoal:30,videoGoal:wrong,audioGoal:null,
        allowedMedia:['photo','video'],
      })
      expect(()=>signedPolicyGoals({...mutated,videoGoal:wrong as number}))
        .toThrow('assignment.invalid_signed_goal')
    }
    expect(()=>signedPolicyGoals({...policy(2,{
      version:4,photoGoal:30,videoGoal:1,audioGoal:null,
      allowedMedia:['photo'],
    }),videoGoal:1})).toThrow('assignment.invalid_signed_goal')
    expect(signedPolicyGoals({...base,videoGoal:2}))
      .toEqual({photoGoal:30,videoGoal:2,audioGoal:null})
  })
})

describe('P1-16 owner-signed per-kind media requirements',()=>{
  const empty={requiredCategory:false,descriptionMinLength:0,requiredGps:false}
  const mandatory={requiredCategory:true,descriptionMinLength:12,requiredGps:true}
  it('never invents video/audio restrictions under older photo-only/v3/v4 policies',()=>{
    expect(signedMediaRequirements(policy(1),'video')).toEqual(empty)
    expect(signedMediaRequirements(policy(2,{version:3,
      allowedMedia:['photo','video'],
    }),'video')).toEqual(empty)
    expect(signedMediaRequirements(policy(2,{version:4,
      videoGoal:2,audioGoal:1,allowedMedia:['photo','video','audio'],
    }),'audio')).toEqual(empty)
  })
  it('recognizes independent mandatory audio rules with optional video metadata',()=>{
    const p=policy(2,{
      version:5,photoGoal:30,videoGoal:2,audioGoal:1,
      allowedMedia:['photo','video','audio'],
      videoRequirements:empty,audioRequirements:mandatory,
      requiredCategory:false,descriptionMinLength:0,requiredGps:false,
    })
    expect(signedPolicyGoals({...p,videoGoal:2,audioGoal:1}))
      .toEqual({photoGoal:30,videoGoal:2,audioGoal:1})
    expect(signedAllowedAssignmentMedia(p)).toEqual(['photo','video','audio'])
    expect(signedMediaRequirements(p,'video')).toEqual(empty)
    expect(signedMediaRequirements(p,'audio')).toEqual(mandatory)
  })
  it('rejects malformed or enabled restrictions for a disabled type',()=>{
    const p=policy(2,{version:5,allowedMedia:['photo','audio'],
      videoRequirements:empty,audioRequirements:mandatory,
    })
    for(const invalid of [
      {...mandatory,requiredGps:'yes'}, {...mandatory,descriptionMinLength:4001},
      {...mandatory,extra:true},{...mandatory,descriptionMinLength:1.5},
    ])expect(()=>signedMediaRequirements(policy(2,{
      version:5,allowedMedia:['photo','audio'],
      videoRequirements:empty,audioRequirements:invalid,
    }),'audio')).toThrow('assignment.invalid_media_requirements')
    expect(()=>signedMediaRequirements(policy(2,{
      version:5,allowedMedia:['photo','audio'],
      videoRequirements:mandatory,audioRequirements:mandatory,
    }),'video')).toThrow('assignment.invalid_media_requirements')
    expect(signedMediaRequirements(p,'audio')).toEqual(mandatory)
  })
})
