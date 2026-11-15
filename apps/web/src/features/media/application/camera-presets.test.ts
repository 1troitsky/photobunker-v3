import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach,describe,expect,it} from 'vitest'
import {activeSession} from '../../identity/application/session'
import {b64,unb64} from '../../identity/infrastructure/crypto'
import type {Session} from '../../identity/application/session'
import {
  changeCameraPreset,defaultCameraPresetCatalog,
  loadCameraPresetCatalog,validateCameraPresetCatalog,
} from './camera-presets'

async function device(accountId:string=crypto.randomUUID(),
  deviceId:string=crypto.randomUUID()):Promise<Session>{
  const encryptionKey=await crypto.subtle.generateKey({
    name:'AES-GCM',length:256,
  },false,['encrypt','decrypt'])
  return {
    accountId,deviceId,
    device:{encryptionKey},
  } as Session
}
afterEach(()=>{activeSession.value=null})

describe('Camera 1.2 device-scoped encrypted Local-First presets',()=>{
  it('persists selected preset and never stores the private name or settings in plaintext',async()=>{
    const s=await device();activeSession.value=s
    const defaults=await loadCameraPresetCatalog()
    expect(defaults).toEqual(defaultCameraPresetCatalog())
    const settings={...defaults.presets[0]!.settings,
      videoQuality:'1080p' as const,videoMaxSeconds:70,
      audioTargetBitrate:192000 as const,
    }
    const c=await changeCameraPreset({kind:'add',
      name:'SECRET PRIVATE CAMERA PRESET',settings})
    expect(c.presets).toHaveLength(2)
    expect(c.selectedId).toMatch(/^custom-/)
    expect(await loadCameraPresetCatalog()).toEqual(c)

    const peek=new Dexie('pb3-camera-encrypted-presets-v1')
    peek.version(1).stores({rows:'&key'})
    try{
      const raw=await peek.table('rows').get(s.accountId+'/'+s.deviceId)
      expect(raw).toBeDefined()
      expect(raw.iv).toMatch(/^[A-Za-z0-9_-]+$/)
      for(const secret of ['SECRET PRIVATE CAMERA PRESET','1080p','192000']){
        expect(JSON.stringify(raw)).not.toContain(secret)
      }
    }finally{peek.close()}
    await expect(changeCameraPreset({kind:'add',name:'secret private camera preset',
      settings})).rejects.toThrow('camera.preset_duplicate')
  })

  it('binds ciphertext to device identity and refuses disclosure after changing account',async()=>{
    const s=await device(),other=await device(s.accountId)
    activeSession.value=s
    const original=await changeCameraPreset({kind:'save',id:'default',
      name:'Only original device',settings:defaultCameraPresetCatalog().presets[0]!.settings})
    expect(original.presets[0]!.name).toBe('Only original device')
    activeSession.value=other
    expect((await loadCameraPresetCatalog()).presets[0]!.name).toBe('По умолчанию')
    activeSession.value=s
    expect((await loadCameraPresetCatalog()).presets[0]!.name).toBe('Only original device')
  })

  it('fails closed on a changed authenticated ciphertext without erasing the encrypted row',async()=>{
    const s=await device();activeSession.value=s
    const original=defaultCameraPresetCatalog().presets[0]!.settings
    await changeCameraPreset({kind:'save',id:'default',
      name:'Important sealed profile',settings:original})
    const peek=new Dexie('pb3-camera-encrypted-presets-v1')
    peek.version(1).stores({rows:'&key'})
    const key=s.accountId+'/'+s.deviceId
    try{
      const row=await peek.table('rows').get(key)
      const cipher=unb64(row.ciphertext) 
      const altered=new Uint8Array(cipher)
      const index=Math.floor(altered.length/2)
      altered[index]=altered[index]! ^ 0x01
      await peek.table('rows').put({...row,ciphertext:b64(altered)})
      await expect(loadCameraPresetCatalog()).rejects.toThrow()
      const after=await peek.table('rows').get(key)
      expect(after.ciphertext).toBe(b64(altered))
      expect(JSON.stringify(after)).not.toContain('Important sealed profile')
    }finally{peek.close()}
  })

  it('bounds duration, quality, audio bitrate, names and preset count',async()=>{
    const settings=defaultCameraPresetCatalog().presets[0]!.settings
    for(const [key,value] of [
      ['audioMaxSeconds',3001],['videoMaxSeconds',301],
      ['videoMaxSeconds',4],['audioTargetBitrate',177000],
      ['photoQuality','fake'],['photoAspect','2:1'],
    ] as const){
      const malformed={...settings,[key]:value}
      expect(()=>validateCameraPresetCatalog({
        version:1,selectedId:'default',presets:[
          {id:'default',name:'Default',settings:malformed},
        ],
      })).toThrow('camera.preset_invalid')
    }
    const s=await device();activeSession.value=s
    for(let i=0;i<7;i++){
      await changeCameraPreset({kind:'add',name:'Preset '+i,settings})
    }
    expect((await loadCameraPresetCatalog()).presets).toHaveLength(8)
    await expect(changeCameraPreset({kind:'add',name:'Too many',settings}))
      .rejects.toThrow('camera.preset_limit')
  })

  it('serializes concurrent mutations without losing committed presets',async()=>{
    const s=await device();activeSession.value=s
    const settings=defaultCameraPresetCatalog().presets[0]!.settings
    const result=await Promise.allSettled([
      changeCameraPreset({kind:'add',name:'Alpha',settings}),
      changeCameraPreset({kind:'add',name:'Beta',settings}),
    ])
    expect(result.map(x=>x.status)).toEqual(['fulfilled','fulfilled'])
    const loaded=await loadCameraPresetCatalog()
    expect(loaded.presets.map(x=>x.name)).toEqual(expect.arrayContaining([
      'Alpha','Beta','По умолчанию',
    ]))
  })
})
