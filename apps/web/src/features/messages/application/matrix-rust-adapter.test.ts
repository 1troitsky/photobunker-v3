import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {jsonApi} from '../../identity/infrastructure/api'
import {getBoundMatrixCredentials} from './matrix-binding'
import {acquireMatrixCryptoLease} from './matrix-crypto-lease'
import {getVerifiedPB3Matrix4SKey} from './matrix-ssss-bridge'
import {
  matrixCryptoStatus,startMatrixCrypto,stopMatrixCrypto,
} from './matrix-rust-adapter'

const mocks=vi.hoisted(()=>({
  create:vi.fn(),whoami:vi.fn(),init:vi.fn(),
  getCrypto:vi.fn(),isolation:vi.fn(),stop:vi.fn(),start:vi.fn(),release:vi.fn(),
}))
vi.mock('matrix-js-sdk',()=>({createClient:mocks.create}))
vi.mock('matrix-js-sdk/lib/crypto-api',()=>({
  OnlySignedDevicesIsolationMode:class OnlySignedDevicesIsolationMode{},
}))
vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('./matrix-binding',()=>({getBoundMatrixCredentials:vi.fn()}))
vi.mock('./matrix-crypto-lease',()=>({acquireMatrixCryptoLease:vi.fn()}))
vi.mock('./matrix-ssss-bridge',()=>({getVerifiedPB3Matrix4SKey:vi.fn()}))

const config={
  version:1 as const,
  operationId:'11111111-1111-4111-8111-111111111111',
  accountId:'',pb3DeviceId:'',
  homeserverUrl:'https://matrix.example.test',
  matrixUserId:'@alice:matrix.example.test',
  matrixDeviceId:'MXDEVICE',
}
const accessToken='test-matrix-token-never-log'
let session:Session

beforeEach(async()=>{
  const accountId=crypto.randomUUID(),{pkg}=await freshPackage(accountId)
  session={accountId,deviceId:crypto.randomUUID(),pkg,online:true} as Session
  activeSession.value=session
  config.accountId=accountId;config.pb3DeviceId=session.deviceId
  vi.clearAllMocks()
  mocks.create.mockReturnValue({
    whoami:mocks.whoami,initRustCrypto:mocks.init,getCrypto:mocks.getCrypto,
    stopClient:mocks.stop,startClient:mocks.start,
  })
  mocks.whoami.mockResolvedValue({
    user_id:config.matrixUserId,device_id:config.matrixDeviceId,
    is_guest:false,
  })
  mocks.init.mockResolvedValue(undefined)
  mocks.getCrypto.mockReturnValue({setDeviceIsolationMode:mocks.isolation})
  vi.mocked(getBoundMatrixCredentials).mockResolvedValue({
    contract:{...config},accessToken,
  })
  vi.mocked(jsonApi).mockResolvedValue({
    bound:true,homeserverUrl:config.homeserverUrl,
    deviceBinding:{contract:JSON.stringify(config)},
  } as never)
  vi.mocked(acquireMatrixCryptoLease).mockResolvedValue({
    release:mocks.release,
  })
  vi.mocked(getVerifiedPB3Matrix4SKey).mockResolvedValue(null)
})
afterEach(async()=>{
  await stopMatrixCrypto()
  activeSession.value=null
})

describe('P2 RustCrypto bootstrap has no unverified message send path',()=>{
  it('checks PB3 and Matrix whoami before encrypted Rust IDB initialization',async()=>{
    await startMatrixCrypto()
    expect(matrixCryptoStatus.value).toBe('crypto_initialized_only')
    expect(mocks.create).toHaveBeenCalledWith({
      baseUrl:config.homeserverUrl,userId:config.matrixUserId,
      deviceId:config.matrixDeviceId,accessToken,
      cryptoCallbacks:{getSecretStorageKey:expect.any(Function)},
    })
    const createOptions=mocks.create.mock.calls[0]?.[0] as {
      cryptoCallbacks:{getSecretStorageKey:(args:unknown,name:string)=>Promise<unknown>}
    }
    const options={keys:{SSSS_KEY:{algorithm:'m.secret_storage.v1.aes-hmac-sha2'}}}
    await expect(createOptions.cryptoCallbacks.getSecretStorageKey(
      options,'m.cross_signing.master')).resolves.toBeNull()
    expect(getVerifiedPB3Matrix4SKey).toHaveBeenCalledWith(
      mocks.create.mock.results[0]?.value,options,'m.cross_signing.master')
    const args=mocks.init.mock.calls[0]?.[0] as {
      useIndexedDB:boolean;cryptoDatabasePrefix:string;storageKey:Uint8Array
    }
    expect(args.useIndexedDB).toBe(true)
    expect(args.cryptoDatabasePrefix).toMatch(/^pb3-matrix-crypto-[a-f0-9]{64}$/)
    expect(args.storageKey).toHaveLength(32)
    expect([...args.storageKey]).toEqual(Array(32).fill(0)) // no lingering raw key
    expect(mocks.isolation).toHaveBeenCalledTimes(1)
    expect(mocks.isolation.mock.calls[0]?.[0]?.constructor?.name)
      .toBe('OnlySignedDevicesIsolationMode')
    expect(mocks.start).not.toHaveBeenCalled()
    await expect(startMatrixCrypto()).rejects.toThrow('matrix.client_already_active')
    await stopMatrixCrypto()
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(mocks.release).toHaveBeenCalledTimes(1)
    expect(matrixCryptoStatus.value).toBe('inactive')
  })
  it('rejects mismatched signed PB3 binding before creating Matrix client',async()=>{
    vi.mocked(jsonApi).mockResolvedValue({
      bound:true,homeserverUrl:config.homeserverUrl,
      deviceBinding:{contract:'not-the-signed-contract'},
    } as never)
    await expect(startMatrixCrypto()).rejects.toThrow('matrix.server_binding_mismatch')
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.init).not.toHaveBeenCalled()
  })
  it('refuses foreign Matrix device identity and closes before crypto initialization',async()=>{
    mocks.whoami.mockResolvedValue({
      user_id:config.matrixUserId,device_id:'IMPERSONATOR',
    })
    await expect(startMatrixCrypto()).rejects.toThrow('matrix.remote_identity_mismatch')
    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
  it('fails closed without Web Locks and never calls Matrix SDK',async()=>{
    vi.mocked(acquireMatrixCryptoLease).mockRejectedValue(Error('matrix.web_locks_unavailable'))
    await expect(startMatrixCrypto()).rejects.toThrow('matrix.web_locks_unavailable')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('stops and releases exclusive ownership when PB3 account locks',async()=>{
    await startMatrixCrypto()
    activeSession.value=null
    await vi.waitFor(()=>expect(mocks.release).toHaveBeenCalledTimes(1))
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(matrixCryptoStatus.value).toBe('inactive')
  })
})
