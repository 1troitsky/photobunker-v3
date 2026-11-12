import {afterEach,describe,expect,it} from 'vitest'
import {
  armBrowserReturn,captureBrowserReturnContext,discardBrowserReturnContext,
  takeBrowserReturn,
} from './browser-return-context'

const context={
  accountId:'account-a',deviceId:'device-1',fileKey:'media:abc',
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
})
