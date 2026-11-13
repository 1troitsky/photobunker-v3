import {describe,expect,it} from 'vitest'
import {freshPackage} from '../../identity/infrastructure/crypto'
import type {Session} from '../../identity/application/session'
import {addFolder,moveFile,emptyWorkspace} from '../domain/folders'
import {
  createFolderSyncContract,parseFolderContract,verifyAndOpenFolderSync,
} from './folder-sync-crypto'

async function fixtures(){
  const {pkg}=await freshPackage(crypto.randomUUID())
  const first={
    accountId:pkg.accountId,
    deviceId:crypto.randomUUID(),pkg,
  } as Session
  const second={
    accountId:pkg.accountId,
    deviceId:crypto.randomUUID(),pkg,
  } as Session
  const folder=crypto.randomUUID()
  const file='media:'+crypto.randomUUID()
  const workspace=moveFile(addFolder(
    emptyWorkspace(),'PRIVATE-E2EE-FOLDER',null,folder,100,
  ),file,folder)
  return {first,second,workspace,file,folder}
}
describe('account signed E2EE folder snapshots',()=>{
  it('restores private nested folders on another recovered device with identical account package',async()=>{
    const {first,second,workspace,file,folder}=await fixtures()
    const signed=await createFolderSyncContract(first,workspace,0,crypto.randomUUID())
    const contract=parseFolderContract(signed.contract)
    expect(contract.accountId).toBe(first.accountId)
    expect(contract.writerDeviceId).toBe(first.deviceId)
    expect(contract.toRevision).toBe(1)
    for(const secret of ['PRIVATE-E2EE-FOLDER',file,folder])
      expect(JSON.stringify(signed)).not.toContain(secret)
    expect(await verifyAndOpenFolderSync(second,signed,1))
      .toEqual(workspace)
  })
  it('rejects altered ciphertext, revision rollback and forged signature',async()=>{
    const {first,workspace}=await fixtures()
    const signed=await createFolderSyncContract(first,workspace,4,crypto.randomUUID())
    await expect(verifyAndOpenFolderSync(first,signed,4))
      .rejects.toThrow('browser.sync_identity_mismatch')
    const corrupt=JSON.parse(signed.contract) as ReturnType<typeof parseFolderContract>
    corrupt.envelope.ciphertext=corrupt.envelope.ciphertext.slice(0,-2)+'AA'
    await expect(verifyAndOpenFolderSync(first,{
      contract:JSON.stringify(corrupt),signature:signed.signature,
    },5)).rejects.toThrow()
    await expect(verifyAndOpenFolderSync(first,{
      ...signed,signature:'garbage',
    },5)).rejects.toThrow()
  })
  it('fails closed on lost/rotated AKEK rather than replacing server content',async()=>{
    const {first,workspace}=await fixtures()
    const signed=await createFolderSyncContract(first,workspace,0,crypto.randomUUID())
    const otherPkg=(await freshPackage(first.accountId)).pkg
    const inconsistent={
      ...first,pkg:{...first.pkg,akek:otherPkg.akek},
    } as Session
    await expect(verifyAndOpenFolderSync(inconsistent,signed,1))
      .rejects.toThrow('browser.sync_key_or_cipher_unavailable')
  })
  it('supports snapshots larger than identity base64 8 KiB limit',async()=>{
    const {first,second,folder}=await fixtures()
    let workspace=addFolder(emptyWorkspace(),'Photo Labels',null,folder,1)
    for(let i=0;i<180;i++)
      workspace=moveFile(workspace,'photo:'+crypto.randomUUID(),folder)
    const signed=await createFolderSyncContract(first,workspace,2,crypto.randomUUID())
    const len=parseFolderContract(signed.contract).envelope.ciphertext.length
    expect(len).toBeGreaterThan(8192)
    expect((await verifyAndOpenFolderSync(second,signed,3)).placements)
      .toEqual(workspace.placements)
  })
  it('rejects unrecognized fields and non-canonical snapshot forms',async()=>{
    const {first,workspace}=await fixtures()
    const signed=await createFolderSyncContract(first,workspace,0,crypto.randomUUID())
    const data=JSON.parse(signed.contract)
    expect(()=>parseFolderContract(JSON.stringify({...data,unknown:1})))
      .toThrow('browser.sync_invalid_contract')
    expect(()=>parseFolderContract(JSON.stringify({...data,fromRevision:1,toRevision:1})))
      .toThrow('browser.sync_invalid_contract')
    expect(()=>parseFolderContract('invalid-json')).toThrow('browser.sync_invalid_contract')
  })
})
