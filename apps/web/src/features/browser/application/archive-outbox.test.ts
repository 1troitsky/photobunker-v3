import 'fake-indexeddb/auto'
import {afterEach,describe,expect,it} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {
  getPendingArchiveAction,savePendingArchiveAction,
  clearAcknowledgedArchiveAction,
} from './archive-outbox'
import type {ArchivePending} from './archive-outbox'

afterEach(()=>{activeSession.value=null})
async function identity():Promise<Session>{
  const accountId=crypto.randomUUID(),deviceId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  const encryptionKey=await crypto.subtle.generateKey({
    name:'AES-GCM',length:256,
  },false,['encrypt','decrypt'])
  const s={accountId,deviceId,pkg,online:true,
    device:{encryptionKey}} as Session
  activeSession.value=s
  return s
}
function pending(s:Session):ArchivePending{
  const operationId=crypto.randomUUID(),assetId=crypto.randomUUID()
  return {
    operationId,assetId,kind:'media',action:'delete',expectedRevision:3,
    createdAt:Date.now(),signature:'SIGNED-ECDSA-IN-MEMORY',
    command:JSON.stringify({
      version:1,accountId:s.accountId,writerDeviceId:s.deviceId,
      operationId,kind:'media',assetId,action:'delete',expectedRevision:3,
    }),
  }
}
async function storedRaw():Promise<string>{
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('pb3-browser-device-archive-outbox-v1')
    req.onerror=()=>reject(req.error)
    req.onsuccess=()=>{
      const db=req.result
      const rows=db.transaction('rows','readonly').objectStore('rows').getAll()
      rows.onerror=()=>{db.close();reject(rows.error)}
      rows.onsuccess=()=>{db.close();resolve(JSON.stringify(rows.result))}
    }
  })
}
describe('archive signed durable outbox',()=>{
  it('stores only device-key AES-GCM, retries exactly signed bytes after reload',async()=>{
    const s=await identity(),intent=pending(s)
    await savePendingArchiveAction(intent)
    const raw=await storedRaw()
    for(const secret of [
      intent.command,intent.signature,intent.assetId,intent.operationId,
    ])expect(raw).not.toContain(secret)
    // Simulate Browser component unmount and same-device session restoration.
    activeSession.value=null
    activeSession.value=s
    expect(await getPendingArchiveAction()).toEqual(intent)
    await expect(clearAcknowledgedArchiveAction(crypto.randomUUID()))
      .rejects.toThrow('browser.archive_ack_mismatch')
    expect(await getPendingArchiveAction()).toEqual(intent)
    await clearAcknowledgedArchiveAction(intent.operationId)
    expect(await getPendingArchiveAction()).toBeNull()
  })
  it('does not discard one unknown destructive operation for a later request',async()=>{
    const s=await identity(),first=pending(s),second=pending(s)
    expect(await savePendingArchiveAction(first)).toEqual(first)
    expect(await savePendingArchiveAction(second)).toEqual(first)
    expect(await getPendingArchiveAction()).toEqual(first)
  })
  it('fails closed for another account and for corrupted encrypted storage',async()=>{
    const s=await identity(),first=pending(s)
    await savePendingArchiveAction(first)
    await identity()
    expect(await getPendingArchiveAction()).toBeNull()
    activeSession.value=s
    expect(await getPendingArchiveAction()).toEqual(first)
    await new Promise<void>((resolve,reject)=>{
      const req=indexedDB.open('pb3-browser-device-archive-outbox-v1')
      req.onerror=()=>reject(req.error)
      req.onsuccess=()=>{
        const db=req.result
        const tx=db.transaction('rows','readwrite')
        tx.oncomplete=()=>{db.close();resolve()}
        tx.onerror=()=>{db.close();reject(tx.error)}
        const rows=tx.objectStore('rows').getAll()
        rows.onerror=()=>tx.abort()
        rows.onsuccess=()=>{
          const row=rows.result.find((r:{scope:string})=>
            r.scope===s.accountId+'/'+s.deviceId)
          if(!row){tx.abort();return}
          row.ciphertext=(row.ciphertext[0]==='A'?'B':'A')
            +row.ciphertext.slice(1)
          tx.objectStore('rows').put(row)
        }
      }
    })
    await expect(getPendingArchiveAction()).rejects.toThrow()
    // A failed decrypt must not silently overwrite the stored bytes.
    expect(await storedRaw()).not.toContain(first.command)
    await expect(savePendingArchiveAction(pending(s))).rejects.toThrow()
    await expect(getPendingArchiveAction()).rejects.toThrow()
  })
  it('rejects wrong writer/intent before any queue mutation',async()=>{
    const s=await identity(),first=pending(s)
    const invalid={...first,assetId:crypto.randomUUID()}
    await expect(savePendingArchiveAction(invalid))
      .rejects.toThrow('browser.archive_pending_identity')
    expect(await getPendingArchiveAction()).toBeNull()
  })
})
