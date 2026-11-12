import {describe,expect,it} from 'vitest'
import {mediaSubmissionSigningDomain} from './assignment-outbox'

describe('P2 V-30 media submission signature domain separation',()=>{
  it('uses exact explicit versioned domains for legacy AV and P2 photo',()=>{
    expect(mediaSubmissionSigningDomain(1)).toBe('pb3.assignment-media-submit.v1\n')
    expect(mediaSubmissionSigningDomain(2)).toBe('pb3.assignment-media-submit.v2\n')
    expect(mediaSubmissionSigningDomain(3)).toBe('pb3.assignment-media-submit.v3\n')
    expect(mediaSubmissionSigningDomain(4)).toBe('pb3.assignment-media-submit.v4\n')
    expect(mediaSubmissionSigningDomain(4))
      .not.toBe(mediaSubmissionSigningDomain(1))
  })
  it('never silently signs unsupported/future media submission versions as v1',()=>{
    for(const invalid of [undefined,null,0,5,1.5,-1,'4',NaN,Infinity]){
      expect(()=>mediaSubmissionSigningDomain(invalid))
        .toThrow('assignment.unsupported_media_submission_version')
    }
  })
})
