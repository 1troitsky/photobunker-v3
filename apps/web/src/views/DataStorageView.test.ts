// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,nextTick,type App} from 'vue'
import {activeSession,type Session} from '../features/identity/application/session'

const mock=vi.hoisted(()=>({
  catalog:vi.fn(),server:vi.fn(),queue:vi.fn(),
  backup:vi.fn(),retry:vi.fn(),
  route:{query:{field:undefined as string|undefined}},
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
// RouterLink is a UI boundary; quota validation doesn't need navigation.
// The real vue-router RouterLink requires an installed router and otherwise
// rejects during test mount, independently of storage state.
vi.mock('vue-router',()=>({
  RouterLink:{render:()=>null},
  useRoute:()=>mock.route,
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
  app.mount(host)
  await flush()
}
function quotaText():string{
  return host.querySelector('[data-testid="storage-file-quota-denominator"]')
    ?.textContent?.replace(/\s+/g,' ').trim()??''
}
beforeEach(()=>{
  host=document.createElement('div');document.body.append(host)
  activeSession.value=session()
  mock.route.query.field=undefined
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
  it('shows a conditional forecast for queued ciphertext and new files, not conflicts',async()=>{
    mock.queue.mockResolvedValue({
      summary:{pendingCount:1,conflictedCount:2,expiredPendingCount:3,
        pendingCipherBytes:1500,syncedLocalCount:0},
      entries:[],
    })
    await mount()
    const estimate=host.querySelector('[data-testid="storage-after-upload-estimate"]')
    expect(estimate?.textContent).toContain('13.2 КиБ')
    expect(estimate?.textContent).toContain('126 файлов')
    expect(estimate?.textContent).toContain('прогноз')
    expect(estimate?.textContent).toContain('Конфликты')
    expect(estimate?.textContent).not.toContain('131 файлов')
  })
  it('never projects a future upload without eligible pending files or safe integers',async()=>{
    mock.queue.mockResolvedValue({
      summary:{pendingCount:0,conflictedCount:1,expiredPendingCount:1,
        pendingCipherBytes:0,syncedLocalCount:0},
      entries:[],
    })
    await mount()
    expect(host.querySelector('[data-testid="storage-after-upload-estimate"]')).toBeNull()
  })
  it('does not show an unsafe overflow estimate as a verified byte total',async()=>{
    mock.server.mockResolvedValue({
      planId:'go',recordedCipherBytes:Number.MAX_SAFE_INTEGER,
      activeLogicalMediaFiles:125,enforcedByteCeiling:Number.MAX_SAFE_INTEGER,
      asOfUtc:'2026-11-16T00:00:00Z',
    })
    mock.queue.mockResolvedValue({
      summary:{pendingCount:1,conflictedCount:0,expiredPendingCount:0,
        pendingCipherBytes:100,syncedLocalCount:0},
      entries:[],
    })
    await mount()
    expect(host.querySelector('[data-testid="storage-after-upload-estimate"]')).toBeNull()
    expect(host.querySelector('[data-testid="storage-server-ready"]')).not.toBeNull()
  })
  it('does not infer a post-upload cloud total when server usage is unavailable',async()=>{
    mock.server.mockRejectedValue(new Error('offline API'))
    mock.queue.mockResolvedValue({
      summary:{pendingCount:1,conflictedCount:0,expiredPendingCount:0,
        pendingCipherBytes:128,syncedLocalCount:0},
      entries:[],
    })
    await mount()
    expect(host.querySelector('[data-testid="storage-local-ready"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="storage-after-upload-estimate"]')).toBeNull()
  })
  it('renders pending encrypted queue bytes as decimal MB rather than binary MiB',async()=>{
    mock.queue.mockResolvedValue({
      summary:{pendingCount:3,conflictedCount:0,expiredPendingCount:0,
        pendingCipherBytes:612_000_000,syncedLocalCount:0},
      entries:[],
    })
    await mount()
    expect(host.querySelector('[data-testid="storage-local-pending-bytes"]')?.textContent)
      .toContain('612 МБ')
    expect(host.querySelector('[data-testid="storage-queue-summary"]')?.textContent)
      .toContain('3 файла · 612 МБ')
  })
  it('renders decimal cloud tariff units and combined queue estimate as approved',async()=>{
    mock.server.mockResolvedValue({
      planId:'go',recordedCipherBytes:15_000_000_000,
      activeLogicalMediaFiles:125,enforcedByteCeiling:30_000_000_000,
      byteUnitPolicy:'DECIMAL_GB_TB_V1',asOfUtc:'2026-11-16T00:00:00Z',
    })
    mock.queue.mockResolvedValue({
      summary:{pendingCount:3,conflictedCount:0,expiredPendingCount:0,
        pendingCipherBytes:612_000_000,syncedLocalCount:0},
      entries:[],
    })
    await mount()
    expect(host.querySelector('[data-testid="storage-cloud-quota"]')?.textContent)
      .toContain('15 ГБ / 30 ГБ')
    expect(host.querySelector('[data-testid="storage-queue-summary"]')?.textContent)
      .toContain('3 файла')
    const estimate=host.querySelector('[data-testid="storage-after-upload-estimate"]')
    expect(estimate?.textContent).toContain('15,612 ГБ')
    expect(estimate?.textContent).toContain('128 файлов')
    expect(estimate?.textContent).toContain('прогноз')
  })
  it('keeps the visible pending count and bytes aligned, excluding conflicts and expiry',async()=>{
    mock.queue.mockResolvedValue({
      summary:{pendingCount:3,conflictedCount:2,expiredPendingCount:1,
        pendingCipherBytes:612_000_000,syncedLocalCount:0},
      entries:[],
    })
    await mount()
    const summary=host.querySelector('[data-testid="storage-queue-summary"]')
    expect(summary?.querySelector('.queue-amount')?.textContent).toContain('3 файла')
    expect(summary?.querySelector('.queue-amount')?.textContent).not.toContain('6 файлов')
    expect(host.querySelector('[data-testid="storage-queue-blocked"]')?.textContent)
      .toContain('2 конфликтных')
    expect(host.querySelector('[data-testid="storage-queue-blocked"]')?.textContent)
      .toContain('1 просроченных')
  })
  it.each([
    ['usage','storage-cloud-section'],
    ['backups','storage-backup-section'],
    ['cache','storage-cache-section'],
    ['queue','storage-open-queue'],
  ])('focuses exact Data & Storage search target %s after mount',async(field,id)=>{
    mock.route.query.field=field
    await mount()
    const target=host.querySelector('[data-testid="'+id+'"]')
    expect(target).not.toBeNull()
    expect(document.activeElement).toBe(target)
    if(field==='queue'){
      expect(target?.getAttribute('aria-expanded')).toBe('true')
      expect(host.querySelector('[data-testid="storage-queue-detail"]')).not.toBeNull()
    }
  })
  it('places the verified quota section ahead of the separate encrypted offline queue',async()=>{
    await mount()
    const quota=host.querySelector('[data-testid="storage-cloud-section"]')
    const queue=host.querySelector('[data-testid="storage-open-queue"]')
    expect(quota).not.toBeNull()
    expect(queue).not.toBeNull()
    expect(quota!.compareDocumentPosition(queue!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
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
