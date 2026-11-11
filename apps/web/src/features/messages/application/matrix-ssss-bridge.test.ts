import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import type {MatrixClient} from 'matrix-js-sdk'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage,random} from '../../identity/infrastructure/crypto'
import {getBoundMatrixCredentials} from './matrix-binding'
import {recoverMatrixSecretStorageKey} from './matrix-recovery-escrow'
import {getVerifiedPB3Matrix4SKey} from './matrix-ssss-bridge'

vi.mock('./matrix-binding',()=>({getBoundMatrixCredentials:vi.fn()}))
vi.mock('./matrix-recovery-escrow',()=>({recoverMatrixSecretStorageKey:vi.fn()}))
const credentials=vi.mocked(getBoundMatrixCredentials)
const escrow=vi.mocked(recoverMatrixSecretStorageKey)
const keyId='KCI_RECOVERY_KEY_V1'
const algorithm='m.secret_storage.v1.aes-hmac-sha2'
const home='https://matrix.example.test'
const matrixId='@owner:matrix.example.test'
const mxDevice='DEVICE_ONE'
let session:Session
let client:MatrixClient
const checkKey=vi.fn()
const remoteKey=vi.fn()
function offered(keys:Record<string,unknown>={[keyId]:{algorithm}}){
  return {keys} as Parameters<NonNullable<
    import('matrix-js-sdk/lib/crypto-api').CryptoCallbacks['getSecretStorageKey']>>[0]
}
const get=(name='m.cross_signing.master')=>
  getVerifiedPB3Matrix4SKey(client,offered(),name)

beforeEach(async()=>{
  const accountId=globalThis.crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  session={accountId,deviceId:globalThis.crypto.randomUUID(),
    pkg,online:true} as Session
  activeSession.value=session
  vi.clearAllMocks()
  credentials.mockResolvedValue({contract:{
    version:1,operationId:globalThis.crypto.randomUUID(),
    accountId:session.accountId,pb3DeviceId:session.deviceId,
    homeserverUrl:home,matrixUserId:matrixId,matrixDeviceId:mxDevice,
  },accessToken:'not-logged'})
  escrow.mockImplementation(async()=>random(32))
  remoteKey.mockResolvedValue([keyId,{algorithm,iv:'iv',mac:'mac'}])
  checkKey.mockResolvedValue(true)
  client={
    baseUrl:home,getUserId:()=>matrixId,getDeviceId:()=>mxDevice,
    secretStorage:{getKey:remoteKey,checkKey},
  } as unknown as MatrixClient
})
afterEach(()=>{activeSession.value=null})

describe('P2-02D3: AKEK-unsealed Matrix 4S key → official crypto callback',()=>{
  it('accepts only the actual Matrix default key with two independent MAC checks',async()=>{
    const result=await get()
    expect(result?.[0]).toBe(keyId)
    expect(result?.[1]).toHaveLength(32)
    expect(remoteKey).toHaveBeenCalledTimes(1)
    expect(checkKey).toHaveBeenCalledTimes(2)
    result?.[1].fill(0)
  })
  it('rejects non-whitelisted Matrix secrets and unexpected SSSS key IDs',async()=>{
    await expect(get('unreviewed.extension.secret')).resolves.toBeNull()
    expect(escrow).not.toHaveBeenCalled()
    await expect(getVerifiedPB3Matrix4SKey(
      client,offered({OTHER_KEY:{algorithm}}),'m.megolm_backup.v1'))
      .rejects.toThrow('matrix.ssss_key_id_not_authorized')
    expect(escrow).not.toHaveBeenCalled()
  })
  it('never uses PB3 key on foreign MXID, changed device or origin',async()=>{
    credentials.mockResolvedValue(null)
    await expect(get()).rejects.toThrow('matrix.ssss_device_binding_mismatch')
    credentials.mockResolvedValue({contract:{
      version:1,operationId:globalThis.crypto.randomUUID(),
      accountId:session.accountId,pb3DeviceId:session.deviceId,
      homeserverUrl:home,matrixUserId:'@foreign:matrix.example.test',
      matrixDeviceId:mxDevice,
    },accessToken:'unused'})
    await expect(get()).rejects.toThrow('matrix.ssss_device_binding_mismatch')
    expect(escrow).not.toHaveBeenCalled()
  })
  it('fail-closes on invalid current Matrix key and wipes rejected raw seed',async()=>{
    const key=random(32)
    escrow.mockResolvedValue(key)
    checkKey.mockResolvedValue(false)
    await expect(get()).rejects.toThrow('matrix.ssss_wrong_key')
    expect([...key]).toEqual(Array(32).fill(0))
  })
  it('clears key if PB3 session changes during asynchronous Matrix MAC check',async()=>{
    const key=random(32)
    escrow.mockResolvedValue(key)
    checkKey.mockImplementation(async()=>{
      activeSession.value=null
      return true
    })
    await expect(get()).rejects.toThrow('matrix.ssss_session_changed')
    expect([...key]).toEqual(Array(32).fill(0))
  })
  it('refuses Matrix metadata or account offline; never exports secret',async()=>{
    remoteKey.mockResolvedValue(null)
    await expect(get()).rejects.toThrow('matrix.ssss_default_key_missing')
    activeSession.value={...session,online:false}
    await expect(get()).rejects.toThrow('matrix.ssss_pb3_offline')
    expect(escrow).not.toHaveBeenCalled()
  })
})
