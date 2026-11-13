import {describe,expect,it} from 'vitest'
import {b64,freshPackage,importSigner,sign} from '../../identity/infrastructure/crypto'
import type {Session} from '../../identity/application/session'
import {addFolder,moveFile,emptyWorkspace} from '../domain/folders'
import {
  createFolderSyncContract,parseFolderContract,verifyAndOpenFolderSync,
} from './folder-sync-crypto'

/**
 * This test changes one actual decoded AES-GCM byte. Replacing a suffix of
 * unpadded Base64URL text can silently leave the decoded ciphertext equal.
 * Folder ciphertext may exceed identity's 8-KiB unb64() limit, so use a
 * full-length test-only decoder and the production b64() encoder.
 */
function tamperCipherBytes(encoded:string):string{
  const decode=(text:string)=>Uint8Array.from(
    atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))
  const original=decode(encoded)
  expect(original.length).toBeGreaterThan(16)
  const changed=new Uint8Array(original)
  const index=Math.floor(original.length/2)
  changed[index]=changed[index]! ^ 0x01
  expect(changed[index]).not.toBe(original[index])
  expect(changed).not.toEqual(original)
  const encodedChanged=b64(changed)
  expect(encodedChanged).not.toBe(encoded)
  expect(decode(encodedChanged)).toEqual(changed)
  return encodedChanged
}

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
    expect(await verifyAndOpenFolderSync(first,signed,5)).toEqual(workspace)
    const corrupt=JSON.parse(signed.contract) as ReturnType<typeof parseFolderContract>
    corrupt.envelope.ciphertext=tamperCipherBytes(corrupt.envelope.ciphertext)
    const changedContract=JSON.stringify(corrupt)
    expect(parseFolderContract(changedContract).envelope.ciphertext)
      .toBe(corrupt.envelope.ciphertext)
    // The original signature MUST reject the byte-changed canonical contract.
    await expect(verifyAndOpenFolderSync(first,{
      contract:changedContract,signature:signed.signature,
    },5)).rejects.toThrow('browser.sync_signature_invalid')
    // Re-sign with the genuine account key to reach actual GCM verification.
    // A valid signature must never make corrupted ciphertext readable.
    const resigned=await sign(await importSigner(first.pkg.accountPkcs8),
      'pb3.browser-folders.v1\n'+changedContract)
    await expect(verifyAndOpenFolderSync(first,{
      contract:changedContract,signature:resigned,
    },5)).rejects.toThrow('browser.sync_key_or_cipher_unavailable')
    await expect(verifyAndOpenFolderSync(first,{
      ...signed,signature:'garbage',
    },5)).rejects.toThrow()
  })
  it('rejects 128 independent newly signed Folder Sync ciphertext mutations at both gates',async()=>{
    const ivs=new Set<string>(),operations=new Set<string>()
    for(let i=0;i<128;i++){
      const {first,second,workspace}=await fixtures()
      const operation=crypto.randomUUID()
      const signed=await createFolderSyncContract(first,workspace,0,operation)
      const current=parseFolderContract(signed.contract)
      expect(ivs.has(current.envelope.iv)).toBe(false)
      expect(operations.has(current.operationId)).toBe(false)
      ivs.add(current.envelope.iv);operations.add(current.operationId)
      // Genuine contract must round-trip before it is attacked.
      expect(await verifyAndOpenFolderSync(second,signed,1)).toEqual(workspace)
      current.envelope.ciphertext=tamperCipherBytes(current.envelope.ciphertext)
      const altered=JSON.stringify(current)
      await expect(verifyAndOpenFolderSync(second,{
        contract:altered,signature:signed.signature,
      },1)).rejects.toThrow('browser.sync_signature_invalid')
      const validSignature=await sign(await importSigner(first.pkg.accountPkcs8),
        'pb3.browser-folders.v1\n'+altered)
      await expect(verifyAndOpenFolderSync(second,{
        contract:altered,signature:validSignature,
      },1)).rejects.toThrow('browser.sync_key_or_cipher_unavailable')
    }
    expect(ivs.size).toBe(128)
    expect(operations.size).toBe(128)
  },60_000)
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
