import 'fake-indexeddb/auto'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {activeSession} from './session'
import type {Session} from './session'
import {jsonApi} from '../infrastructure/api'
import {
  freshPackage,newSigning,exportSpki,importSpki,verify,
} from '../infrastructure/crypto'
import {stopMatrixCrypto} from '../../messages/application/matrix-rust-adapter'
import {clearLocalMatrixCredentials} from '../../messages/application/matrix-binding'
import {prepareOwnMatrixTokenLogout} from '../../messages/application/matrix-self-logout'
import {listPB3Devices,revokePB3Device} from './device-revocation'

vi.mock('../infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('./session',async orig=>({
  ...await orig(),logout:vi.fn(),
}))
vi.mock('../../messages/application/matrix-rust-adapter',
  ()=>({stopMatrixCrypto:vi.fn()}))
vi.mock('../../messages/application/matrix-binding',
  ()=>({clearLocalMatrixCredentials:vi.fn()}))
vi.mock('../../messages/application/matrix-self-logout',
  ()=>({prepareOwnMatrixTokenLogout:vi.fn()}))
import {logout} from './session'
const api=vi.mocked(jsonApi)
const localStop=vi.mocked(stopMatrixCrypto)
const localClear=vi.mocked(clearLocalMatrixCredentials)
const localLogout=vi.mocked(logout)
const prepareMatrixLogout=vi.mocked(prepareOwnMatrixTokenLogout)
let s:Session
const tokenStatus={
  pb3Revoked:true,unchanged:false,
  matrixRemoteRevoked:false,
  matrixRevocationStatus:'not_performed',
}
beforeEach(async()=>{
  vi.clearAllMocks()
  const accountId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  const signer=await newSigning(false)
  s={accountId,deviceId:crypto.randomUUID(),pkg,online:true,
    device:{
      deviceKey:signer.privateKey,
      deviceSpki:await exportSpki(signer.publicKey),
    },
  } as Session
  activeSession.value=s
  localStop.mockResolvedValue(undefined)
  localClear.mockResolvedValue(undefined)
  prepareMatrixLogout.mockResolvedValue(null)
  localLogout.mockImplementation(async()=>{activeSession.value=null})
  api.mockImplementation(async(path,method)=>{
    if(path==='/identity/v2/devices'&&method===undefined)
      return {devices:[{id:s.deviceId,
        created_at:'2026-11-11T01:00:00Z',revoked_at:null}]}
    if(path.startsWith('/identity/v2/devices/')
      &&path.endsWith('/revoke')&&method==='POST')
      return tokenStatus as never
    throw Error('test.unexpected_api')
  })
})
afterEach(()=>{activeSession.value=null})
describe('signed PB3 device revoke does not invent Matrix remote token revocation',()=>{
  it('sends real account-root+actor device P-256 signatures for only named target',async()=>{
    const target=crypto.randomUUID()
    const result=await revokePB3Device(target)
    expect(result).toMatchObject(tokenStatus)
    expect(result.localMatrixCredentialsCleared).toBe(false)
    expect(result.localMatrixShutdownComplete).toBe(false)
    expect(localStop).not.toHaveBeenCalled()
    expect(localClear).not.toHaveBeenCalled()
    expect(localLogout).not.toHaveBeenCalled()
    expect(prepareMatrixLogout).not.toHaveBeenCalled()
    const [url,method,payload]=api.mock.calls[0] as [
      string,string,{contract:string;accountSignature:string;deviceSignature:string},
    ]
    expect(url).toBe('/identity/v2/devices/'+target+'/revoke')
    expect(method).toBe('POST')
    const contract=JSON.parse(payload.contract)
    expect(contract).toMatchObject({
      version:1,accountId:s.accountId,
      actorDeviceId:s.deviceId,targetDeviceId:target,
      accountRevision:s.pkg.revision,
    })
    expect(contract.operationId).toMatch(/^[0-9a-f-]{36}$/)
    const msg='pb3.identity-device-revoke.v1\n'+payload.contract
    expect(await verify(await importSpki(s.pkg.accountSpki),
      msg,payload.accountSignature)).toBe(true)
    expect(await verify(await importSpki(s.device.deviceSpki),
      msg,payload.deviceSignature)).toBe(true)
    const raw=JSON.stringify(payload)
    expect(raw).not.toContain(s.pkg.accountPkcs8)
    expect(raw).not.toContain(s.pkg.akek)
    expect(raw).not.toContain('accessToken')
  })
  it('self revoke closes crypto, wipes local Matrix credential and locks PB3 even without bound Matrix',async()=>{
    const result=await revokePB3Device(s.deviceId)
    expect(result).toMatchObject(tokenStatus)
    expect(result.localMatrixCredentialsCleared).toBe(true)
    expect(result.localMatrixShutdownComplete).toBe(true)
    expect(result.matrixOwnTokenLogout).toBe('not_attempted')
    expect(prepareMatrixLogout).toHaveBeenCalledTimes(1)
    expect(localStop).toHaveBeenCalledTimes(1)
    expect(localClear).toHaveBeenCalledTimes(1)
    expect(localLogout).toHaveBeenCalledTimes(1)
    expect(activeSession.value).toBeNull()
  })
  it('never reports a false remote revoke or hides local crypto cleanup failures',async()=>{
    localStop.mockRejectedValue(Error('storage locked'))
    localClear.mockRejectedValue(Error('quota'))
    const result=await revokePB3Device(s.deviceId)
    expect(result.localMatrixShutdownComplete).toBe(false)
    expect(result.localMatrixCredentialsCleared).toBe(false)
    expect(result.matrixRemoteRevoked).toBe(false)
    expect(result.matrixOwnTokenLogout).toBe('not_attempted')
    expect(localLogout).toHaveBeenCalledTimes(1)
  })
  it('confirms only the CURRENT device Matrix bearer after signed PB3 self-revocation',async()=>{
    const matrixLogout=vi.fn().mockResolvedValue(true)
    prepareMatrixLogout.mockResolvedValue(matrixLogout)
    const result=await revokePB3Device(s.deviceId)
    expect(result.matrixOwnTokenLogout).toBe('confirmed')
    expect(result.matrixRemoteRevoked).toBe(false) // Server does not claim all Matrix sessions revoked.
    expect(matrixLogout).toHaveBeenCalledTimes(1)
    const paths=api.mock.calls.map(x=>x[0])
    expect(paths).toContain('/identity/v2/devices/'+s.deviceId+'/revoke')
    expect(localLogout).toHaveBeenCalledTimes(1)
  })
  it('remains locally revoked when remote Matrix logout or its preflight fails',async()=>{
    prepareMatrixLogout.mockResolvedValue(vi.fn().mockResolvedValue(false))
    const result=await revokePB3Device(s.deviceId)
    expect(result.matrixOwnTokenLogout).toBe('unconfirmed')
    expect(localClear).toHaveBeenCalledTimes(1)
    expect(localLogout).toHaveBeenCalledTimes(1)
  })
  it('does not block signed PB3 revoke when Matrix lookup is unavailable',async()=>{
    prepareMatrixLogout.mockRejectedValue(Error('homeserver unavailable'))
    const result=await revokePB3Device(s.deviceId)
    expect(result.matrixOwnTokenLogout).toBe('unconfirmed')
    expect(localLogout).toHaveBeenCalledTimes(1)
  })
  it('does NOT log out the Matrix bearer when the PB3 signed revoke fails',async()=>{
    const remoteLogout=vi.fn().mockResolvedValue(true)
    prepareMatrixLogout.mockResolvedValue(remoteLogout)
    api.mockRejectedValueOnce(Error('api.http_503'))
    await expect(revokePB3Device(s.deviceId))
      .rejects.toThrow('api.http_503')
    expect(remoteLogout).not.toHaveBeenCalled()
    expect(localClear).not.toHaveBeenCalled()
    expect(localLogout).not.toHaveBeenCalled()
  })
  it('refuses unsigned/offline and malicious server remote-revoked claim',async()=>{
    activeSession.value={...s,online:false}
    await expect(revokePB3Device(crypto.randomUUID()))
      .rejects.toThrow('identity.revoke_requires_online')
    expect(api).not.toHaveBeenCalled()
    activeSession.value=s
    api.mockResolvedValue({...tokenStatus,matrixRemoteRevoked:true} as never)
    await expect(revokePB3Device(crypto.randomUUID()))
      .rejects.toThrow('identity.revoke_ack_unverified')
    expect(localLogout).not.toHaveBeenCalled()
    await expect(revokePB3Device('not-a-uuid'))
      .rejects.toThrow('identity.revoke_bad_device_id')
  })
  it('refuses session switch during revocation without reporting success',async()=>{
    api.mockImplementation(async()=>{
      activeSession.value={...s,accountId:crypto.randomUUID()}
      return tokenStatus as never
    })
    await expect(revokePB3Device(crypto.randomUUID()))
      .rejects.toThrow('identity.revoke_session_changed')
    expect(localLogout).not.toHaveBeenCalled()
  })
  it('validates the authenticated PB3 device inventory',async()=>{
    expect(await listPB3Devices()).toEqual([{
      id:s.deviceId,created_at:'2026-11-11T01:00:00Z',
      revoked_at:null,
    }])
    api.mockResolvedValue({
      devices:[{id:'malicious-text',created_at:'',revoked_at:null}],
    } as never)
    await expect(listPB3Devices())
      .rejects.toThrow('identity.invalid_device_list')
  })
})
