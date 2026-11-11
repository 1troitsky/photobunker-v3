import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import type {CryptoApi} from 'matrix-js-sdk/lib/crypto-api'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {getBoundMatrixCredentials} from './matrix-binding'
import {getMatrixContactMapping} from './matrix-peer-identity'
import {inspectVerifiedMatrixDevice} from './matrix-verified-device'

vi.mock('./matrix-binding',()=>({getBoundMatrixCredentials:vi.fn()}))
vi.mock('./matrix-peer-identity',()=>({getMatrixContactMapping:vi.fn()}))
const pinned=vi.mocked(getMatrixContactMapping)
const my=vi.mocked(getBoundMatrixCredentials)
const userid='@peer:matrix.example.test'
const own='@owner:matrix.example.test'
const edKey='a'.repeat(43)
const otherKey='b'.repeat(43)
const peerId='22222222-2222-4222-8222-222222222222'
const algos=['m.olm.v1.curve25519-aes-sha2','m.megolm.v1.aes-sha2']
let session:Session
const fake={
  userHasCrossSigningKeys:vi.fn(),
  getUserVerificationStatus:vi.fn(),
  getDeviceVerificationStatus:vi.fn(),
  getUserDeviceInfo:vi.fn(),
}
const crypto=fake as unknown as Pick<CryptoApi,
  'userHasCrossSigningKeys'|'getUserVerificationStatus'|
  'getDeviceVerificationStatus'|'getUserDeviceInfo'>
function device(id:string,key:string){
  return {
    deviceId:id,userId:userid,algorithms:algos,
    getFingerprint:()=>key,getIdentityKey:()=>otherKey,
  }
}
beforeEach(async()=>{
  const accountId=cryptoRandomId()
  const {pkg}=await freshPackage(accountId)
  session={accountId,deviceId:cryptoRandomId(),pkg,online:true} as Session
  activeSession.value=session
  vi.clearAllMocks()
  my.mockResolvedValue({contract:{
    version:1,operationId:cryptoRandomId(),
    accountId, pb3DeviceId:session.deviceId,
    homeserverUrl:'https://matrix.example.test',
    matrixUserId:own,matrixDeviceId:'OWN_DEVICE',
  },accessToken:'sealed-secret'})
  pinned.mockResolvedValue({
    matrixUserId:userid,matrixDeviceId:'MXDEVICE1',
    homeserverUrl:'https://matrix.example.test',
    verification:'pb3-account-signed-only',
  })
  fake.userHasCrossSigningKeys.mockResolvedValue(true)
  fake.getUserVerificationStatus.mockResolvedValue({
    known:true,needsUserApproval:false,
    isCrossSigningVerified:()=>true,
  })
  fake.getUserDeviceInfo.mockResolvedValue(new Map([[userid,new Map([
    ['MXDEVICE1',device('MXDEVICE1',edKey)],
    ['MXDEVICE2',device('MXDEVICE2',otherKey)],
  ])]]))
  fake.getDeviceVerificationStatus.mockResolvedValue({
    signedByOwner:true,crossSigningVerified:true,isVerified:()=>true,
  })
})
afterEach(()=>{activeSession.value=null})
function cryptoRandomId():string{return globalThis.crypto.randomUUID()}
const inspect=()=>inspectVerifiedMatrixDevice(peerId,edKey,crypto)

describe('P2-02D3: no implicit Matrix trust from PB3 contact card',()=>{
  it('requires independently approved Ed25519 plus verified user and ALL cross-signed devices',async()=>{
    await expect(inspect()).resolves.toEqual({
      matrixUserId:userid,matrixDeviceId:'MXDEVICE1',matrixEd25519:edKey,
      crossSigningChecked:true,capability:'inspection-only-no-send',
    })
    expect(fake.userHasCrossSigningKeys).toHaveBeenCalledWith(userid,true)
    expect(fake.getUserDeviceInfo).toHaveBeenCalledWith([userid],true)
    expect(fake.getDeviceVerificationStatus)
      .toHaveBeenCalledWith(userid,'MXDEVICE2')
  })
  it('refuses missing or altered independently verified Ed25519',async()=>{
    await expect(inspectVerifiedMatrixDevice(peerId,'bad',crypto))
      .rejects.toThrow('matrix.trust_missing_independent_fingerprint')
    await expect(inspectVerifiedMatrixDevice(peerId,'c'.repeat(43),crypto))
      .rejects.toThrow('matrix.trust_ed25519_changed')
  })
  it('refuses PB3-only signed card, lost Matrix binding, foreign origin or same MXID',async()=>{
    pinned.mockResolvedValue(null)
    await expect(inspect()).rejects.toThrow('matrix.trust_contact_not_confirmed')
    pinned.mockResolvedValue({
      matrixUserId:userid,matrixDeviceId:'MXDEVICE1',
      homeserverUrl:'https://another.example.test',
      verification:'pb3-account-signed-only',
    })
    await expect(inspect()).rejects.toThrow('matrix.trust_binding_mismatch')
    my.mockResolvedValue(null)
    await expect(inspect()).rejects.toThrow('matrix.trust_binding_mismatch')
  })
  it('rejects TOFU, cross-signing key absent, changed identity and local-only verification',async()=>{
    fake.userHasCrossSigningKeys.mockResolvedValue(false)
    await expect(inspect()).rejects.toThrow('matrix.trust_no_cross_signing')
    fake.userHasCrossSigningKeys.mockResolvedValue(true)
    fake.getUserVerificationStatus.mockResolvedValue({
      known:true,needsUserApproval:true,
      isCrossSigningVerified:()=>true,
    })
    await expect(inspect()).rejects.toThrow('matrix.trust_unverified_user')
    fake.getUserVerificationStatus.mockResolvedValue({
      known:true,needsUserApproval:false,
      isCrossSigningVerified:()=>false,
    })
    await expect(inspect()).rejects.toThrow('matrix.trust_unverified_user')
    fake.getUserVerificationStatus.mockResolvedValue({
      known:true,needsUserApproval:false,
      isCrossSigningVerified:()=>true,
    })
    fake.getDeviceVerificationStatus.mockResolvedValue({
      signedByOwner:false,crossSigningVerified:false,
      localVerified:true,isVerified:()=>true,
    })
    await expect(inspect()).rejects.toThrow('matrix.trust_unverified_device')
  })
  it('rejects one unsigned/unknown second device even if chosen device is verified',async()=>{
    fake.getDeviceVerificationStatus.mockImplementation(async(_,id)=>
      id==='MXDEVICE1'
        ?{signedByOwner:true,crossSigningVerified:true,isVerified:()=>true}
        :{signedByOwner:false,crossSigningVerified:false,isVerified:()=>false})
    await expect(inspect()).rejects.toThrow('matrix.trust_unverified_device')
    fake.getDeviceVerificationStatus.mockResolvedValue(null)
    await expect(inspect()).rejects.toThrow('matrix.trust_unverified_device')
    fake.getUserDeviceInfo.mockResolvedValue(new Map([[userid,new Map([
      ['MALICIOUS',device('MXDEVICE1',edKey)],
    ])]]))
    await expect(inspect()).rejects.toThrow('matrix.trust_device_missing')
  })
  it('rejects absent Curve25519 or Olm/Megolm protocol support',async()=>{
    fake.getUserDeviceInfo.mockResolvedValue(new Map([[userid,new Map([
      ['MXDEVICE1',{...device('MXDEVICE1',edKey),
        getIdentityKey:()=>undefined}],
    ])]]))
    await expect(inspect()).rejects.toThrow('matrix.trust_device_missing_keys')
  })
  it('fails closed on network failure, offline and account change during key lookup',async()=>{
    fake.userHasCrossSigningKeys.mockRejectedValue(Error('network down'))
    await expect(inspect()).rejects.toThrow('matrix.trust_verification_unavailable')
    fake.userHasCrossSigningKeys.mockResolvedValue(true)
    activeSession.value={...session,online:false}
    await expect(inspect()).rejects.toThrow('matrix.trust_offline')
    activeSession.value=session
    fake.getUserDeviceInfo.mockImplementation(async()=>{
      activeSession.value=null
      return new Map()
    })
    await expect(inspect()).rejects.toThrow('matrix.trust_session_changed')
  })
})
