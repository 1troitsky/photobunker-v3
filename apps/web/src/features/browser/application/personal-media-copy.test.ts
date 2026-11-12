import {describe,expect,it} from 'vitest'
import {
  isPersonalMediaCopyChanged,mayCopyPersonalMediaSource,
  validatePersonalMediaCopy,
} from './personal-media-copy'

describe('P2 V-47 private metadata E2EE copy intent',()=>{
  const source='PRIVATE-MEDIA-ORIGINAL.jpg'
  const original={name:source,description:'Original',category:'Facade',
    tags:['tag-one','tag-two']}
  it('keeps canonical private fields and original extension',()=>{
    const validated=validatePersonalMediaCopy(source,{
      name:'  PRIVATE-COPY.jpg  ',description:' Updated private description ',
      category:' Detail ',tags:['new-tag','tag-two'],
    })
    expect(validated).toEqual({
      name:'PRIVATE-COPY.jpg',fields:{
        category:'Detail',description:'Updated private description',
        tags:['new-tag','tag-two'],
      },
    })
    expect(Object.keys(validated.fields)).not.toContain('gps')
    expect(Object.keys(validated.fields)).not.toContain('assignmentId')
    expect(isPersonalMediaCopyChanged(original,{...original}))
      .toBe(false)
    expect(isPersonalMediaCopyChanged(original,{
      ...original,name:'PRIVATE-COPY.jpg',
    })).toBe(true)
  })
  it('does not clone assignment captures, expired files or unverified sources',()=>{
    expect(mayCopyPersonalMediaSource(undefined)).toBe(false)
    const unexpired=Date.now()+500000
    const personal={state:'queued' as const,expiresAt:unexpired}
    expect(mayCopyPersonalMediaSource(personal)).toBe(true)
    expect(mayCopyPersonalMediaSource({...personal,state:'synced'})).toBe(true)
    expect(mayCopyPersonalMediaSource({...personal,state:'conflict'})).toBe(false)
    expect(mayCopyPersonalMediaSource({...personal,capture:{contract:'signed'}})).toBe(false)
    expect(mayCopyPersonalMediaSource({...personal,expiresAt:Date.now()-1}))
      .toBe(false)
  })
  it('rejects false filename disguises, controls and unsafe paths',()=>{
    for(const name of ['', '  ','../private.jpg','folder\\private.jpg',
      'photo.mp4','secret.jpg\u202e','x'.repeat(161)+'.jpg']){
      expect(()=>validatePersonalMediaCopy(source,{
        ...original,name,
      })).toThrow()
    }
  })
  it('enforces existing encrypted metadata and tag contracts',()=>{
    expect(()=>validatePersonalMediaCopy(source,{
      ...original,description:'x'.repeat(4001),
    })).toThrow('media.invalid_description')
    expect(()=>validatePersonalMediaCopy(source,{
      ...original,category:'x'.repeat(65),
    })).toThrow('media.invalid_category')
    expect(()=>validatePersonalMediaCopy(source,{
      ...original,tags:['duplicate','duplicate'],
    })).toThrow('assignment.duplicate_rule_label')
    expect(()=>validatePersonalMediaCopy(source,{
      ...original,tags:Array.from({length:13},(_,i)=>'t'+i),
    })).toThrow('assignment.invalid_rule_list')
  })
})
