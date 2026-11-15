import {describe,expect,it} from 'vitest'
import {blankProfile,validateProfile} from './local-profile'
import type {Profile} from './local-profile'
describe('E2EE profile local contract',()=>{
  it('starts fully private and does not invent a global username',()=>{
    const p=blankProfile()
    expect(p.username).toBe('')
    expect(p.cardVisibility).toBe('nobody')
    expect(p.teamsVisibility).toBe('nobody')
    expect(p.presenceVisibility).toBe('nobody')
    expect(()=>validateProfile(p)).not.toThrow()
  })
  it('enforces accepted 3–15 user handle grammar',()=>{
    for(const username of ['abc','a-b','a.b','abc123456789012']){
      expect(()=>validateProfile({...blankProfile(),username})).not.toThrow()
    }
    for(const username of ['ab','a','ABC','-abc','abc-','abc.','.abc','abc_','abc def','a'.repeat(16)]){
      expect(()=>validateProfile({...blankProfile(),username})).toThrow('profile.invalid_input')
    }
  })
  it('rejects overlong text, unknown visibility and extra fields',()=>{
    const p=blankProfile()
    const bad:unknown[]=[
      {...p,name:'x'.repeat(65)},
      {...p,about:'x'.repeat(601)},
      {...p,name:' spaced '},
      {...p,about:' spaced '},
      {...p,cardVisibility:'fake'},
      {...p,accountId:'should-never-be-in-local-payload'},
    ]
    for(const value of bad)expect(()=>validateProfile(value as Profile)).toThrow('profile.invalid_input')
  })
})
