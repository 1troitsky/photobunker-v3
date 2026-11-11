import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {getBoundMatrixCredentials} from './matrix-binding'
import {prepareOwnMatrixTokenLogout} from './matrix-self-logout'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('./matrix-binding',()=>({getBoundMatrixCredentials:vi.fn()}))
const remote=vi.mocked(jsonApi)
const bound=vi.mocked(getBoundMatrixCredentials)
const contract={
  version:1 as const,operationId:'c7d2c342-a3a0-49b5-8b83-4a2a7775bc41',
  accountId:'pb3-account',pb3DeviceId:'pb3-device',
  homeserverUrl:'https://synapse.example.org',
  matrixUserId:'@alice:synapse.example.org',matrixDeviceId:'MXDEVICE',
}
const token='this-is-a-disposable-matrix-token'
function response(body:unknown,status=200):Response{
  return new Response(JSON.stringify(body),{
    status,headers:{'Content-Type':'application/json'},
  })
}
beforeEach(()=>{
  vi.clearAllMocks()
  activeSession.value={
    accountId:contract.accountId,deviceId:contract.pb3DeviceId,online:true,
    pkg:{akek:'opaque-local-key',accountSpki:'spki',revision:1},
  } as Session
  bound.mockResolvedValue({contract,accessToken:token})
  remote.mockResolvedValue({
    bound:true,homeserverUrl:contract.homeserverUrl,
    matrixUserId:contract.matrixUserId,
    deviceBinding:{contract:JSON.stringify(contract)},
  } as never)
})
afterEach(()=>{
  activeSession.value=null
  vi.unstubAllGlobals()
})
describe('M-03B independently verified logout for own bound Matrix token',()=>{
  it('requires true whoami, posts to the pinned TLS origin, then proves the SAME bearer is invalid',async()=>{
    const mocked=vi.fn()
      .mockResolvedValueOnce(response({
        user_id:contract.matrixUserId,device_id:contract.matrixDeviceId,
      }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({errcode:'M_UNKNOWN_TOKEN'},401))
    vi.stubGlobal('fetch',mocked)
    const revoke=await prepareOwnMatrixTokenLogout()
    expect(revoke).not.toBeNull()
    expect(await revoke!()).toBe(true)
    expect(mocked).toHaveBeenCalledTimes(3)
    const calls=mocked.mock.calls
    const url=contract.homeserverUrl+'/_matrix/client/v3'
    expect(calls.map(x=>x[0])).toEqual([
      url+'/account/whoami',url+'/logout',url+'/account/whoami',
    ])
    expect(calls[1]?.[1]).toMatchObject({
      method:'POST',body:'{}',credentials:'omit',redirect:'error',
      headers:{Authorization:'Bearer '+token},
    })
    // No token in URL, body, PB3 API, analytics or persistence.
    expect(JSON.stringify(calls.map(x=>x[0]))).not.toContain(token)
    expect(JSON.stringify(calls[1]?.[1]?.body)).not.toContain(token)
    expect(remote).toHaveBeenCalledWith('/matrix/v1/me')
  })
  it('refuses cross-account Matrix bindings before any outgoing bearer request',async()=>{
    remote.mockResolvedValue({
      bound:true,homeserverUrl:contract.homeserverUrl,
      matrixUserId:'@mallory:synapse.example.org',
      deviceBinding:{contract:JSON.stringify(contract)},
    } as never)
    const mocked=vi.fn()
    vi.stubGlobal('fetch',mocked)
    await expect(prepareOwnMatrixTokenLogout())
      .rejects.toThrow('matrix.self_logout_binding_unverified')
    expect(mocked).not.toHaveBeenCalled()
  })
  it('never sends logout to an unexpected remote whoami identity',async()=>{
    const mocked=vi.fn().mockResolvedValueOnce(response({
      user_id:'@mallory:synapse.example.org',device_id:contract.matrixDeviceId,
    }))
    vi.stubGlobal('fetch',mocked)
    const revoke=await prepareOwnMatrixTokenLogout()
    expect(await revoke!()).toBe(false)
    expect(mocked).toHaveBeenCalledTimes(1)
  })
  it('does not claim success on mere logout 200 if token still authenticates',async()=>{
    const mocked=vi.fn()
      .mockResolvedValueOnce(response({
        user_id:contract.matrixUserId,device_id:contract.matrixDeviceId,
      }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({
        user_id:contract.matrixUserId,device_id:contract.matrixDeviceId,
      }))
    vi.stubGlobal('fetch',mocked)
    const revoke=await prepareOwnMatrixTokenLogout()
    expect(await revoke!()).toBe(false)
  })
  it('does not issue a network request after account/device switch',async()=>{
    const mocked=vi.fn()
    vi.stubGlobal('fetch',mocked)
    const revoke=await prepareOwnMatrixTokenLogout()
    activeSession.value={...activeSession.value!,deviceId:'different-device'}
    expect(await revoke!()).toBe(false)
    expect(mocked).not.toHaveBeenCalled()
  })
  it('does not pretend an absent bound local Matrix credential was revoked',async()=>{
    bound.mockResolvedValue(null)
    vi.stubGlobal('fetch',vi.fn())
    expect(await prepareOwnMatrixTokenLogout()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('remains unconfirmed after Matrix transport failure',async()=>{
    const mocked=vi.fn().mockRejectedValue(Error('offline Matrix'))
    vi.stubGlobal('fetch',mocked)
    const revoke=await prepareOwnMatrixTokenLogout()
    expect(await revoke!()).toBe(false)
  })
})
