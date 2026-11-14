import {describe,it,expect} from 'vitest'
import {
  mixedCreationStage,optionalMixedGoal,validMixedCreationIntent,
  type MixedCreationIntent,
} from './mixed-creation'

const both:MixedCreationIntent={
  allowedMedia:['photo','video','audio'],videoGoal:3,audioGoal:4,
}
const trusted={policyRevision:2,allowedMedia:['photo','video','audio'] as
  Array<'photo'|'video'|'audio'>,videoGoal:3,audioGoal:4}

describe('#209 signed mixed-media creation stage',()=>{
  it('accepts only canonical photo-root-compatible media intent',()=>{
    expect(validMixedCreationIntent(both)).toBe(true)
    expect(validMixedCreationIntent({
      allowedMedia:['photo','audio'],videoGoal:null,audioGoal:1,
    })).toBe(true)
    for(const intent of [
      {allowedMedia:['video','audio'],videoGoal:2,audioGoal:3},
      {allowedMedia:['audio','photo'],videoGoal:null,audioGoal:null},
      {allowedMedia:['photo','video','video'],videoGoal:1,audioGoal:null},
      {allowedMedia:['photo'],videoGoal:1,audioGoal:null},
      {allowedMedia:['photo','video'],videoGoal:0,audioGoal:null},
      {allowedMedia:['photo','video'],videoGoal:1000,audioGoal:null},
      {allowedMedia:['photo','video'],videoGoal:Infinity,audioGoal:null},
      {allowedMedia:['photo','audio'],videoGoal:1,audioGoal:1},
      null,{},[],
    ])expect(validMixedCreationIntent(intent)).toBe(false)
  })
  it('preserves root ACK boundary even if local policy op says sent',()=>{
    expect(mixedCreationStage(both,'queued','sent',trusted))
      .toBe('pending-root')
    expect(mixedCreationStage(both,'retry',null,trusted))
      .toBe('pending-root')
    expect(mixedCreationStage(both,'sent',null,null))
      .toBe('pending-root')
  })
  it('requires fresh verified server-signed policy to declare acceptance',()=>{
    for(const op of [null,'queued','retry','sent'] as const)
      expect(mixedCreationStage(both,'sent',op,trusted)).toBe('accepted')
    for(const op of ['queued','retry','sent'] as const)
      expect(mixedCreationStage(both,'sent',op,{...trusted,policyRevision:1}))
        .toBe('pending-policy')
    expect(mixedCreationStage(both,'sent',null,{...trusted,policyRevision:1}))
      .toBe('ready-to-sign')
  })
  it('fails closed on rejected root, policy or unrelated signed revision',()=>{
    expect(mixedCreationStage(both,'conflict',null,null)).toBe('conflict')
    expect(mixedCreationStage(both,'sent','conflict',{...trusted,policyRevision:1}))
      .toBe('conflict')
    expect(mixedCreationStage(both,'sent',null,{...trusted,videoGoal:9}))
      .toBe('conflict')
    expect(mixedCreationStage(both,'sent',null,{...trusted,allowedMedia:['photo','video']}))
      .toBe('conflict')
    expect(mixedCreationStage(both,'sent',null,{...trusted,policyRevision:0}))
      .toBe('conflict')
  })
  it('validates optional goals without implicit limits or coercion',()=>{
    expect(optionalMixedGoal('')).toBeNull()
    expect(optionalMixedGoal('  ')).toBeNull()
    expect(optionalMixedGoal('999')).toBe(999)
    for(const raw of ['0','1000','1.5','NaN','Infinity','-2','4e4','abc'])
      expect(()=>optionalMixedGoal(raw)).toThrow('assignment.invalid_goal')
  })
})
