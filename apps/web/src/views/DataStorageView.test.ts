// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,nextTick,type App} from 'vue'
import {activeSession,type Session} from '../features/identity/application/session'

const mock=vi.hoisted(()=>({
  catalog:vi.fn(),server:vi.fn(),queue:vi.fn(),
  backup:vi.fn(),retry:vi.fn(),
}))
vi.mock('../features/billing/application/catalog-client',()=>({
  readPublicCatalog:mock.catalog,
}))
vi.mock('../features/storage/application/storage-status',()=>({
  readEncryptedLocalQueueDetails:mock.queue,
  readServerStorageUsage:mock.server,
  retryPendingEncryptedQueue:mock.retry,
  filteredEncryptedQueue:(entries:unknown[])=>entries,
}))
vi.mock('../features/storage/application/backup-technical-status',()=>({
  readBackupTechnicalStatus:mock.backup,
}))
import DataStorageView from './DataStorageView.vue'

const ACCOUNT='11111111-1111-4111-8111-111111111111'
let host:HTMLDivElement,app:App|undefined
function session():Session{
  return {
    accountId:ACCOUNT,deviceId:'22222222-2222-4222-8222-222222222222',
    pkg:{accountSpki:'spki',akek:'akek',revision:1},online:true,
  } as unknown as Session
}
async function flush():Promise<void>{
  for(let i=0;i<18;i++){await Promise.resolve();await nextTick()}
}
async function mount():Promise<void>{
  app=createApp(DataStorageView)
  app.component('RouterLink',{props:['to'],template:'<a><slot /></a>'})
  app.mount(host)
  await flush()
}
function quotaText():string{
  return host.querySelector('[data-testid="storage-file-quota-denominator"]')
    ?.textContent?.replace(/\\s+/g,' ').trim()??''
}
beforeEach(()=>{
  host=document.createElement('div');document.body.append(host)
  activeSession.value=session()
  mock.queue.mockReset().mockResolvedValue({
    summary:{pendingCount:0,conflictedCount:0,expiredPendingCount:0,pendingCipherBytes:0},
    entries:[],
  })
  mock.backup.mockReset().mockResolvedValue(null)
  mock.server.mockReset().mockResolvedValue({
    planId:'go',recordedCipherBytes:12000,activeLogicalMediaFiles:125,
    enforcedByteCeiling:30000000000,asOfUtc:'2026-11-16T00:00:00Z',
  })
  mock.catalog.mockReset().mockResolvedValue([])
  mock.retry.mockReset()
})
afterEach(()=>{
  app?.unmount();app=undefined;host.remove()
  activeSession.value=null
})
describe('Data & Storage 1.2 verified file quota',()=>{
  it('never labels a failed catalog lookup as unlimited',async()=>{
    mock.catalog.mockRejectedValue(new Error('catalog unavailable'))
    await mount()
    expect(quotaText()).toContain('Лимит не подтверждён')
    expect(quotaText()).not.toContain('Без ограничения')
    expect(host.querySelector('[data-testid="storage-file-quota-progress"]'))
      .toBeNull()
    expect(host.querySelector('[data-testid="storage-file-quota-note"]')
      ?.textContent).toContain('Это не означает безлимит')
  })
  it('shows truly unlimited only with a matching verified Unlimited plan',async()=>{
    mock.server.mockResolvedValue({
      planId:'unlimited',recordedCipherBytes:12000,activeLogicalMediaFiles:125,
      enforcedByteCeiling:1000000000000,asOfUtc:'2026-11-16T00:00:00Z',
    })
    mock.catalog.mockResolvedValue([{
      planId:'unlimited',limits:{maxMediaFiles:null},
    }])
    await mount()
    expect(quotaText()).toContain('125 / Без ограничения')
    const bar=host.querySelector<HTMLProgressElement>(
      '[data-testid="storage-file-quota-progress"]')
    expect(bar?.value).toBe(0)
    expect(bar?.getAttribute('aria-label')).toContain('не ограничено')
  })
  it('shows the real limited-plan file count and percentage',async()=>{
    mock.catalog.mockResolvedValue([{
      planId:'go',limits:{maxMediaFiles:250},
    }])
    await mount()
    expect(quotaText()).toContain('125 / 250')
    expect(quotaText()).toContain('50%')
    expect(host.querySelector<HTMLProgressElement>(
      '[data-testid="storage-file-quota-progress"]')?.value).toBe(50)
  })
})
