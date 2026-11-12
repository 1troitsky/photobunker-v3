import {afterEach,describe,expect,it,vi} from 'vitest'
import {nextTick} from 'vue'
import {activeSession,type Session} from '../../identity/application/session'
import {
  rememberBrowserViewerReturn,takeBrowserViewerReturn,
  clearBrowserViewerReturn,
} from './volatile-viewer-return'
const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const device='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const otherDevice='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const sample={
  folderId:first,filter:'audio' as const,sort:'expiry' as const,
  view:'grid' as const,query:'ПРИВАТНАЯ-ФРАЗА' as const,
  searchScope:'all' as const,archiveTab:'all' as const,
  expandedSearch:true,focusKey:'media:'+second,scrollTop:420,
}
function account(id:string,deviceId=device,pkg:object={}):void{
  activeSession.value={accountId:id,deviceId,pkg,device:{},
    online:true} as unknown as Session
}
afterEach(()=>{
  clearBrowserViewerReturn()
  activeSession.value=null
  vi.restoreAllMocks()
})

describe('P2 V-39 volatile Browser -> File Viewer -> Browser return',()=>{
  it('consumes complete folder/filter/sort/query/position exactly once',()=>{
    account(first)
    rememberBrowserViewerReturn(sample)
    expect(takeBrowserViewerReturn()).toEqual(sample)
    expect(takeBrowserViewerReturn()).toBeNull()
  })
  it('never replays private query across account/device/key changes',async()=>{
    account(first)
    rememberBrowserViewerReturn(sample)
    account(second)
    await nextTick()
    expect(takeBrowserViewerReturn()).toBeNull()
    account(first)
    rememberBrowserViewerReturn(sample)
    account(first,otherDevice)
    await nextTick()
    expect(takeBrowserViewerReturn()).toBeNull()
    const pkg={}
    account(first,device,pkg)
    rememberBrowserViewerReturn(sample)
    account(first,device,{})
    await nextTick()
    expect(takeBrowserViewerReturn()).toBeNull()
  })
  it('same-key reauthentication does not lose private return context',async()=>{
    const pkg={}
    const deviceObject={}
    activeSession.value={accountId:first,deviceId:device,pkg,
      device:deviceObject,online:false} as unknown as Session
    rememberBrowserViewerReturn(sample)
    activeSession.value={accountId:first,deviceId:device,pkg,
      device:deviceObject,online:true} as unknown as Session
    await nextTick()
    expect(takeBrowserViewerReturn()?.query).toBe('ПРИВАТНАЯ-ФРАЗА')
  })
  it('refuses expired snapshots, stale clock and invalid opaque folder/target keys',()=>{
    account(first)
    const clock=vi.spyOn(Date,'now').mockReturnValue(1_000_000)
    rememberBrowserViewerReturn(sample)
    clock.mockReturnValue(1_000_000+16*60_000)
    expect(takeBrowserViewerReturn()).toBeNull()
    clock.mockReturnValue(1_000_000)
    rememberBrowserViewerReturn({...sample,folderId:'../files'})
    expect(takeBrowserViewerReturn()).toBeNull()
    rememberBrowserViewerReturn({...sample,focusKey:'media:../settings'})
    expect(takeBrowserViewerReturn()).toBeNull()
    rememberBrowserViewerReturn({...sample,query:'x'.repeat(161)})
    expect(takeBrowserViewerReturn()).toBeNull()
    rememberBrowserViewerReturn(sample)
    clock.mockReturnValue(999_999)
    expect(takeBrowserViewerReturn()).toBeNull()
  })
})
