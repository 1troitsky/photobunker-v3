import { describe, expect, it } from 'vitest'
import { isDockSectionActive, resolveDockRetap } from './dock-retap'

describe('Appearance 1.3 active Dock retap: one safe logical level',()=>{
  const B={kind:'back'} as const
  const R=(path:string)=>({kind:'replace',path} as const)

  it('does not add history entries at any Dock section root',()=>{
    for(const path of ['/assignments','/browser','/camera','/contacts','/settings','/notifications'])
      expect(resolveDockRetap(path,path,'/outside')).toEqual({kind:'none'})
  })
  it('does not capture adjacent lookalike routes or inactive Dock links',()=>{
    expect(isDockSectionActive('/browser-other','/browser')).toBe(false)
    expect(isDockSectionActive('/settings-other','/settings')).toBe(false)
    expect(isDockSectionActive('/notifications-other','/notifications')).toBe(false)
    expect(resolveDockRetap('/settings/appearance','/browser','/settings')).toBeNull()
    expect(resolveDockRetap('/camera','/settings','/browser')).toBeNull()
  })
  it('pops Viewer -> original Browser when and ONLY when that is the previous route',()=>{
    const file='/browser/file/photo/00000000-0000-4000-8000-000000000001'
    expect(resolveDockRetap(file,'/browser','/browser')).toEqual(B)
    expect(resolveDockRetap(file,'/browser','/settings')).toEqual(R('/browser'))
    expect(resolveDockRetap(file,'/browser',null)).toEqual(R('/browser'))
    expect(resolveDockRetap(file,'/browser','https://evil.example')).toEqual(R('/browser'))
  })
  it('pops Editor -> same-file Viewer, or replaces for a direct editor deep link',()=>{
    const file='/browser/file/media/00000000-0000-4000-8000-000000000007'
    const other='/browser/file/media/00000000-0000-4000-8000-000000000008'
    expect(resolveDockRetap(file+'/edit','/browser',file)).toEqual(B)
    expect(resolveDockRetap(file+'/edit','/browser',other)).toEqual(R(file))
    expect(resolveDockRetap(file+'/edit','/browser','/settings')).toEqual(R(file))
    expect(resolveDockRetap(file+'/edit','/browser',null)).toEqual(R(file))
  })
  it('returns Assignment editor to list without cross-section history leakage',()=>{
    const path='/assignments/00000000-0000-4000-8000-000000000001/edit'
    expect(resolveDockRetap(path,'/assignments','/assignments')).toEqual(B)
    expect(resolveDockRetap(path,'/assignments','/browser')).toEqual(R('/assignments'))
  })
  it('pops exactly one Settings step even for Search -> Appearance deep link',()=>{
    expect(resolveDockRetap('/settings/appearance','/settings','/settings/search?q=language')).toEqual(B)
    expect(resolveDockRetap('/settings/search','/settings','/settings')).toEqual(B)
    expect(resolveDockRetap('/settings/appearance','/settings','/contacts')).toEqual(R('/settings'))
    expect(resolveDockRetap('/settings/appearance','/settings','/settings/appearance')).toEqual(R('/settings'))
    expect(resolveDockRetap('/settings/search','/settings',null)).toEqual(R('/settings'))
  })
  it('returns Notification Settings to trusted inbox, never to arbitrary history',()=>{
    expect(isDockSectionActive('/notifications/settings','/notifications')).toBe(true)
    expect(resolveDockRetap('/notifications/settings','/notifications','/notifications')).toEqual(B)
    expect(resolveDockRetap('/notifications/settings','/notifications','/contacts')).toEqual(R('/notifications'))
    expect(resolveDockRetap('/notifications/settings','/notifications',null)).toEqual(R('/notifications'))
    expect(resolveDockRetap('/notifications/unknown','/notifications','//outside')).toEqual(R('/notifications'))
  })
  it('never allows unknown nested paths or untrusted previous path as a target',()=>{
    expect(resolveDockRetap('/browser/unknown','/browser','/settings')).toEqual(R('/browser'))
    expect(resolveDockRetap('/settings/other','/settings','//evil.example')).toEqual(R('/settings'))
    expect(resolveDockRetap('/browser/file/photo/traversal/edit','/browser','/browser'))
      .toEqual(R('/browser'))
  })
})
