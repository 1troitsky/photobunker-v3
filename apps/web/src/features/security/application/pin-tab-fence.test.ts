import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {
  publishPinDeviceSealed,watchPinDeviceSealed,
} from './pin-tab-fence'

const channels=new Map<string,Set<FakeChannel>>()
class FakeChannel{
  onmessage:((event:MessageEvent<unknown>)=>void)|null=null
  closed=false
  readonly name:string
  constructor(name:string){
    this.name=name
    if(!channels.has(name))channels.set(name,new Set())
    channels.get(name)!.add(this)
  }
  postMessage(message:unknown):void {
    if(this.closed)throw Error('test.channel_closed')
    for(const peer of channels.get(this.name)??[]){
      if(peer===this||peer.closed)continue
      const payload=structuredClone(message)
      queueMicrotask(()=>{
        if(!peer.closed)peer.onmessage?.({data:payload} as MessageEvent<unknown>)
      })
    }
  }
  close():void{
    this.closed=true
    channels.get(this.name)?.delete(this)
  }
}
const original=globalThis.BroadcastChannel
beforeEach(()=>{
  channels.clear()
  vi.stubGlobal('BroadcastChannel',FakeChannel)
})
afterEach(()=>{
  vi.unstubAllGlobals()
  channels.clear()
})

describe('P3 #220 non-secret cross-tab notification (not an auth authority)',()=>{
  it('delivers a seal hint to a second tab, with no keys/PIN/PackageV2',async()=>{
    const consumer=vi.fn()
    const stop=watchPinDeviceSealed(consumer)
    expect(publishPinDeviceSealed({
      accountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      deviceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })).toBe(true)
    await Promise.resolve()
    expect(consumer).toHaveBeenCalledOnce()
    expect(consumer.mock.calls[0][0]).toEqual({
      v:1,kind:'pin-sealed',
      accountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      deviceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })
    const json=JSON.stringify(consumer.mock.calls[0][0])
    expect(json).not.toMatch(/ciphertext|signingKey|akek|secret|recoveryKey|accountPkcs8/i)
    stop()
  })

  it('discards invalid shapes, unexpected keys and malicious payloads',async()=>{
    const handler=vi.fn()
    const close=watchPinDeviceSealed(handler)
    const source=new FakeChannel('photobunker.identity.pin-seal.v1')
    for(const candidate of [
      null,{},'pin-sealed',{v:1,kind:'pin-sealed',accountId:'x',deviceId:'y'},
      {v:1,kind:'pin-sealed',accountId:'valid_account',deviceId:'valid_device',akek:'secret'},
      {v:2,kind:'pin-sealed',accountId:'valid_account',deviceId:'valid_device'},
      {v:1,kind:'unlock',accountId:'valid_account',deviceId:'valid_device'},
      {v:1,kind:'pin-sealed',accountId:'valid_account',deviceId:42},
    ])source.postMessage(candidate)
    await Promise.resolve()
    expect(handler).not.toHaveBeenCalled()
    source.close()
    close()
  })

  it('does not deliver after unsubscribe',async()=>{
    const handler=vi.fn()
    const close=watchPinDeviceSealed(handler)
    close()
    expect(publishPinDeviceSealed({
      accountId:'account-12345678',deviceId:'device-12345678',
    })).toBe(true)
    await Promise.resolve()
    expect(handler).not.toHaveBeenCalled()
  })

  it('fails benignly without BroadcastChannel, and does not fake revocation',()=>{
    vi.stubGlobal('BroadcastChannel',undefined)
    const handler=vi.fn()
    const stop=watchPinDeviceSealed(handler)
    expect(publishPinDeviceSealed({
      accountId:'account-12345678',deviceId:'device-12345678',
    })).toBe(false)
    stop()
    expect(handler).not.toHaveBeenCalled()
  })
})
