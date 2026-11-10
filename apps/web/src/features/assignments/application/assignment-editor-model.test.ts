import { describe,expect,it } from 'vitest'
import { blankEditorDraft,buildEditorPolicy,editorDraftFromListing } from './assignment-editor-model'
import type { AssignmentListing } from './assignment-outbox'

function root():AssignmentListing{
  return {
    assignmentId:'11111111-1111-4111-8111-111111111111',
    ownerAccountId:'22222222-2222-4222-8222-222222222222',
    ownerAccountSpki:'owner-spki',state:'active',revision:1,
    photoGoal:30,videoGoal:null,audioGoal:null,
    confirmedPhotoCount:0,confirmedVideoCount:0,confirmedAudioCount:0,
    policyRevision:1,policyContract:'signed-root',policySignature:'signed',
    policyAmendmentContract:null,policyAmendmentSignature:null,
    stateContract:null,stateSignature:null,privateEnvelope:{
      version:1,iv:'',ciphertext:'',wrappedKey:{iv:'',ciphertext:''},
    },startsAt:Date.now()-3600000,endsAt:null,
  }
}
describe('P1-18 Fieldwork four-tab editor is a pure signed v6 policy projection',()=>{
  it('reads immutable legacy v1 correctly and preserves photo-only status',()=>{
    const d=editorDraftFromListing(root())
    expect(d).toEqual({...blankEditorDraft(),photoGoal:'30'})
    expect(buildEditorPolicy(d)).toMatchObject({
      allowedMedia:['photo'],photoGoal:30,videoGoal:null,audioGoal:null,
      photoAdvanced:{allowedCategories:[],requiredTags:[]},
      videoRequirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
    })
  })
  it('maps signed v6 inputs and preserves all three independent media kinds',()=>{
    const advanced={allowedCategories:['Report'],requiredTags:['field']}
    const noAdvanced={allowedCategories:[],requiredTags:[]}
    const rules={requiredCategory:true,descriptionMinLength:12,requiredGps:true}
    const none={requiredCategory:false,descriptionMinLength:0,requiredGps:false}
    const a=root()
    a.policyRevision=2
    a.photoGoal=40;a.videoGoal=2;a.audioGoal=3
    a.policyAmendmentContract=JSON.stringify({
      version:6,allowedMedia:['photo','video','audio'],
      photoGoal:40,videoGoal:2,audioGoal:3,
      requiredCategory:true,descriptionMinLength:12,requiredGps:true,
      videoRequirements:rules,audioRequirements:none,
      photoAdvanced:advanced,videoAdvanced:noAdvanced,audioAdvanced:advanced,
    })
    const d=editorDraftFromListing(a)
    expect(d).toMatchObject({
      photoGoal:'40',videoGoal:'2',audioGoal:'3',video:true,audio:true,
      photoRequiredCategory:true,photoDescriptionMin:12,photoGps:true,
      videoRequiredCategory:true,videoDescriptionMin:12,videoGps:true,
      photoCategories:'Report',photoTags:'field',audioTags:'field',
    })
    expect(buildEditorPolicy(d)).toMatchObject({
      allowedMedia:['photo','video','audio'],
      photoGoal:40,videoGoal:2,audioGoal:3,
      requiredCategory:true,descriptionMinLength:12,requiredGps:true,
      videoRequirements:rules,audioRequirements:none,
      photoAdvanced:advanced,videoAdvanced:noAdvanced,audioAdvanced:advanced,
    })
  })
  it('switching a kind off removes its goals and signed rules instead of resurrecting stale values',()=>{
    const d=blankEditorDraft()
    d.photoGoal='';d.videoGoal='4';d.audioGoal='1'
    d.video=true;d.audio=true
    d.videoRequiredCategory=true;d.videoDescriptionMin=33;d.videoGps=true
    d.videoCategories='Report';d.videoTags='field'
    d.audioCategories='Audio';d.audioTags='recorded'
    d.video=false;d.audio=false
    expect(buildEditorPolicy(d)).toMatchObject({
      allowedMedia:['photo'],photoGoal:null,videoGoal:null,audioGoal:null,
      videoRequirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
      audioRequirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
      videoAdvanced:{allowedCategories:[],requiredTags:[]},
      audioAdvanced:{allowedCategories:[],requiredTags:[]},
    })
  })
  it('validates strict progress, description length and taxonomy prior to signing',()=>{
    const d=blankEditorDraft()
    d.photoGoal='0'
    expect(()=>buildEditorPolicy(d)).toThrow('assignment.invalid_goal')
    d.photoGoal='1.5'
    expect(()=>buildEditorPolicy(d)).toThrow('assignment.invalid_goal')
    d.photoGoal='10000'
    expect(()=>buildEditorPolicy(d)).toThrow('assignment.invalid_goal')
    d.photoGoal=''
    d.photoDescriptionMin=4001
    expect(()=>buildEditorPolicy(d)).toThrow('assignment.invalid_capture_requirements')
    d.photoDescriptionMin=1
    d.photoCategories='Report,Report'
    expect(()=>buildEditorPolicy(d)).toThrow('assignment.duplicate_rule_label')
    d.photoCategories='Report'
    d.photoTags=' evidence, field '
    expect(buildEditorPolicy(d).photoAdvanced).toEqual({
      allowedCategories:['Report'],requiredTags:['evidence','field'],
    })
  })
})
