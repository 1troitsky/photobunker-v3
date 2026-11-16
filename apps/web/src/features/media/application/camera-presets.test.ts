import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach,describe,expect,it} from 'vitest'
import {activeSession} from '../../identity/application/session'
import {b64,unb64} from '../../identity/infrastructure/crypto'
import type {Session} from '../../identity/application/session'
import {
  changeCameraPreset,defaultCameraPresetCatalog,
  loadCameraPresetCatalog,validateCameraPresetCatalog,validateCameraPresetSettings,
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

describe('Camera 1.2 backwards-compatible native preference settings',()=>{
  it('upgrades exactly-ten-key legacy catalogs in memory without dropping encrypted user profiles',()=>{
    const catalog=defaultCameraPresetCatalog()
    const legacy={...catalog.presets[0]!.settings} as Record<string,unknown>
    delete legacy.photoZoom
    delete legacy.torchEnabled
    delete legacy.gpsTrackingEnabled
    expect(Object.keys(legacy)).toHaveLength(10)
    expect(validateCameraPresetSettings(legacy)).toEqual({
      ...catalog.presets[0]!.settings,
      photoZoom:1,torchEnabled:false,gpsTrackingEnabled:false,
    })
    const old=validateCameraPresetCatalog({
      version:1,selectedId:'default',presets:[{
        id:'default',name:'По умолчанию',settings:legacy,
      }],
    })
    expect(old.presets[0]!.settings.photoZoom).toBe(1)
    for(const malformed of [
      {...legacy,photoZoom:2}, // partial migration, never accept.
      {...catalog.presets[0]!.settings,photoZoom:3.1},
      {...catalog.presets[0]!.settings,torchEnabled:'on'},
      {...catalog.presets[0]!.settings,gpsTrackingEnabled:'yes'},
    ])expect(()=>validateCameraPresetSettings(malformed)).toThrow('camera.preset_invalid')
    // Native MediaTrackCapabilities.zoom.step can be 0.05 or 0.125,
    // not necessarily 0.1. Preserve the exact actual hardware setting.
    const fractional={...catalog.presets[0]!.settings,photoZoom:1.125}
    expect(validateCameraPresetSettings(fractional).photoZoom).toBe(1.125)
  })
  it('decrypts a real legacy AES-GCM v1 catalog without rewriting or losing its ciphertext',async()=>{
    const s=await device();activeSession.value=s
    const oldSettings={...defaultCameraPresetCatalog().presets[0]!.settings} as Record<string,unknown>
    delete oldSettings.photoZoom
    delete oldSettings.torchEnabled
    delete oldSettings.gpsTrackingEnabled
    const catalog={version:1,selectedId:'default',presets:[{
      id:'default',name:'Previously sealed camera',settings:oldSettings,
    }]}
    const key=s.accountId+'/'+s.deviceId,revision=1
    const iv=crypto.getRandomValues(new Uint8Array(12))
    const additionalData=new TextEncoder().encode(JSON.stringify({
      domain:'pb3/camera/device-presets/v1',
      accountId:s.accountId,deviceId:s.deviceId,revision,
    }))
    const ciphertext=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData,tagLength:128,
    },s.device.encryptionKey,new TextEncoder().encode(JSON.stringify(catalog)))
    const peek=new Dexie('pb3-camera-encrypted-presets-v1')
    peek.version(1).stores({rows:'&key'})
    const original={key,version:1,revision,iv:b64(iv),ciphertext:b64(ciphertext)}
    try{
      await peek.table('rows').put(original)
      const loaded=await loadCameraPresetCatalog()
      expect(loaded.presets[0]!.name).toBe('Previously sealed camera')
      expect(loaded.presets[0]!.settings).toEqual({
        ...oldSettings,photoZoom:1,torchEnabled:false,gpsTrackingEnabled:false,
      })
      expect(await peek.table('rows').get(key)).toEqual(original)
      const updated={...loaded.presets[0]!.settings,photoZoom:2.2,torchEnabled:true}
      await changeCameraPreset({
        kind:'save',id:'default',name:'Previously sealed camera',settings:updated,
      })
      expect((await loadCameraPresetCatalog()).presets[0]!.settings).toEqual(updated)
      const sealed=await peek.table('rows').get(key)
      expect(sealed.revision).toBe(2)
      expect(sealed.ciphertext).not.toBe(original.ciphertext)
      expect(JSON.stringify(sealed)).not.toContain('Previously sealed camera')
    }finally{peek.close()}
  })
  it('persists optical zoom, torch and GPS intent only as device AEAD, without granting permissions',async()=>{
    const s=await device();activeSession.value=s
    const settings={...defaultCameraPresetCatalog().presets[0]!.settings,
      photoZoom:2.3,torchEnabled:true,gpsTrackingEnabled:true,
    }
    await changeCameraPreset({kind:'save',id:'default',
      name:'Private camera hardware',settings})
    expect((await loadCameraPresetCatalog()).presets[0]!.settings).toEqual(settings)
    const peek=new Dexie('pb3-camera-encrypted-presets-v1')
    peek.version(1).stores({rows:'&key'})
    try{
      const raw=await peek.table('rows').get(s.accountId+'/'+s.deviceId)
      expect(raw).toBeDefined()
      for(const secret of ['Private camera hardware','photoZoom','torchEnabled','gpsTrackingEnabled']){
        expect(JSON.stringify(raw)).not.toContain(secret)
      }
    }finally{peek.close()}
  })
})

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

  it('keeps encrypted presets available across same-crypto online hydration',async()=>{
    const s=await device()
    activeSession.value=s
    const settings={...defaultCameraPresetCatalog().presets[0]!.settings,
      photoZoom:1.125,torchEnabled:true,
    }
    await changeCameraPreset({kind:'save',id:'default',name:'Hydrated camera',settings})
    // The UI replaces the wrapper on network hydration but keeps the exact
    // cryptographic device. This is NOT a sign-out or a new key generation.
    const hydrated={...s,online:true,device:{...s.device}}
    activeSession.value=hydrated
    const catalog=await loadCameraPresetCatalog()
    expect(catalog.presets[0]!.name).toBe('Hydrated camera')
    expect(catalog.presets[0]!.settings).toEqual(settings)
    await changeCameraPreset({kind:'add',name:'Second preset',settings})
    expect((await loadCameraPresetCatalog()).presets).toHaveLength(2)
  })

  it('rejects A→B→A during a queued device preset write even when A is the same old wrapper',async()=>{
    const s=await device(),other=await device()
    activeSession.value=s
    const previous=Object.getOwnPropertyDescriptor(navigator,'locks')
    Object.defineProperty(navigator,'locks',{configurable:true,value:{
      request:async(_name:string,doWrite:()=>Promise<unknown>)=>{
        activeSession.value=other
        activeSession.value=s
        return doWrite()
      },
    }})
    try{
      await expect(changeCameraPreset({kind:'save',id:'default',
        name:'Must never commit',settings:defaultCameraPresetCatalog().presets[0]!.settings,
      })).rejects.toThrow('identity.account_changed')
      expect((await loadCameraPresetCatalog()).presets[0]!.name).toBe('По умолчанию')
    }finally{
      if(previous)Object.defineProperty(navigator,'locks',previous)
      else Reflect.deleteProperty(navigator,'locks')
    }
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
