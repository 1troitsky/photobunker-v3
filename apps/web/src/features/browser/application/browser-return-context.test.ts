import {afterEach,describe,expect,it} from 'vitest'
import {
  armBrowserReturn,captureBrowserReturnContext,discardBrowserReturnContext,
  takeBrowserReturn,peekOriginPager,noteViewerPosition,
} from './browser-return-context'

const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString().padStart(12,'0')
const context={
  accountId:'account-a',deviceId:'device-1',fileKey:'media:'+id(2),
  fileKeys:['photo:'+id(1),'media:'+id(2),'media:'+id(3)],
  folderId:'folder-opaque',filter:'audio' as const,
  sort:'expiry' as const,view:'grid' as const,
  search:'PRIVATE SEARCH',searchFolderScope:'current' as const,
  archiveTab:'all' as const,
}
afterEach(discardBrowserReturnContext)
describe('P2 V-39 Browser/File Viewer volatile navigation context',()=>{
  it('restores exactly once after a Viewer->Browser transition',()=>{
    captureBrowserReturnContext(context)
    expect(takeBrowserReturn('account-a','device-1')).toBeNull()
    captureBrowserReturnContext(context)
    armBrowserReturn('account-a','device-1')
    expect(takeBrowserReturn('account-a','device-1')).toEqual(context)
    expect(takeBrowserReturn('account-a','device-1')).toBeNull()
  })
  it('never restores another account or physical device',()=>{
    captureBrowserReturnContext(context)
    armBrowserReturn('account-a','different-device')
    expect(takeBrowserReturn('account-a','device-1')).toBeNull()
    captureBrowserReturnContext(context)
    armBrowserReturn('account-a','device-1')
    expect(takeBrowserReturn('account-b','device-1')).toBeNull()
    expect(takeBrowserReturn('account-a','device-1')).toBeNull()
  })
  it('superseding or cancelled navigation discards stale volatile search',()=>{
    captureBrowserReturnContext(context)
    captureBrowserReturnContext({...context,search:'new',folderId:null})
    armBrowserReturn('account-a','device-1')
    expect(takeBrowserReturn('account-a','device-1')?.search).toBe('new')
    captureBrowserReturnContext(context)
    discardBrowserReturnContext()
    armBrowserReturn('account-a','device-1')
    expect(takeBrowserReturn('account-a','device-1')).toBeNull()
  })
  it('paginates in exactly Browser-visible mixed-file order',()=>{
    captureBrowserReturnContext(context)
    expect(peekOriginPager('account-a','device-1','media:'+id(2))).toEqual({
      previous:{source:'photo',id:id(1)},
      next:{source:'media',id:id(3)},position:2,total:3,
    })
    expect(peekOriginPager('account-a','device-1','media:'+id(3))).toEqual({
      previous:{source:'media',id:id(2)},
      next:null,position:3,total:3,
    })
    expect(peekOriginPager('account-b','device-1','media:'+id(2))).toBeNull()
    expect(peekOriginPager('account-a','device-1','media:'+id(80))).toBeNull()
  })
  it('returns to the last navigated visible file and rejects invalid capture scope',()=>{
    captureBrowserReturnContext(context)
    noteViewerPosition('account-a','device-1','media:'+id(3))
    noteViewerPosition('account-b','device-1','media:'+id(1))
    noteViewerPosition('account-a','device-1','media:'+id(500))
    armBrowserReturn('account-a','device-1')
    expect(takeBrowserReturn('account-a','device-1')?.fileKey).toBe('media:'+id(3))
    captureBrowserReturnContext({...context,fileKeys:['photo:'+id(1)]})
    expect(peekOriginPager('account-a','device-1','photo:'+id(1))).toBeNull()
    captureBrowserReturnContext({
      ...context,fileKeys:['media:'+id(2),'media:'+id(2)],
    })
    expect(peekOriginPager('account-a','device-1','media:'+id(2))).toBeNull()
  })
})
