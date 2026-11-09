import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { activeSession } from '../../identity/application/session'
import { freshPackage } from '../../identity/infrastructure/crypto'
import type { Session } from '../../identity/application/session'
import {
  captureEncrypted,listLocalPhotos,readLocalPhoto,readLocalPhotoMetadata,
  signedPhotoContract,
} from './p1-photo'

afterEach(()=>{activeSession.value=null})

async function offlineIdentity():Promise<void>{
  const accountId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  activeSession.value={
    accountId,deviceId:crypto.randomUUID(),pkg,online:false,
  } as Session
}

describe('P1-06 encrypted photo metadata assets',()=>{
  it('encrypts private category, description and GPS before writing the durable outbox',async()=>{
    await offlineIdentity()
    const marker='PRIVATE-GPS-DESCRIPTION-NEVER-CLEAR-IN-DB'
    const now=Date.now()
    const photo=await captureEncrypted(
      new Blob([new Uint8Array(1024).fill(223)],{type:'image/jpeg'}),
      undefined,{
        category:'Репортаж',
        description:marker,
        gps:{latitude:41.6461,longitude:41.6413,accuracyMeters:8,
          recordedAt:now-2500},
      },
    )
    expect(photo.state).toBe('queued')
    expect(photo.assets.map(a=>a.kind)).toEqual(['master','metadata'])
    expect(JSON.stringify(photo)).not.toContain(marker)
    expect(JSON.stringify(photo)).not.toContain('41.6461')
    expect(signedPhotoContract(photo)).not.toContain(marker)
    expect(signedPhotoContract(photo)).not.toContain('41.6461')
    const encryptedMetadata=photo.assets.find(a=>a.kind==='metadata')!
    const storedBytes=new TextDecoder().decode(await encryptedMetadata.blob.arrayBuffer())
    expect(storedBytes).not.toContain(marker)
    expect(storedBytes).not.toContain('41.6461')
    const [row]=await listLocalPhotos()
    expect(row.photoId).toBe(photo.photoId)
    expect(row.capture).toBeUndefined()
    expect(JSON.stringify(row)).not.toContain(marker)
    const decoded=await readLocalPhotoMetadata(photo.photoId)
    expect(decoded).toMatchObject({
      version:2,category:'Репортаж',description:marker,
      gps:{latitude:41.6461,longitude:41.6413,accuracyMeters:8},
    })
    const jpeg=await readLocalPhoto(photo.photoId)
    expect(jpeg.size).toBe(1024)
  })
  it('rejects stale GPS without enqueuing the photo',async()=>{
    await offlineIdentity()
    const before=(await listLocalPhotos()).length
    await expect(captureEncrypted(
      new Blob([new Uint8Array(1024)],{type:'image/jpeg'}),undefined,{
        category:'Репортаж',
        gps:{latitude:41.64,longitude:41.66,accuracyMeters:5,
          recordedAt:Date.now()-240000},
      },
    )).rejects.toThrow('capture.invalid_or_stale_gps')
    expect((await listLocalPhotos()).length).toBe(before)
  })
})
