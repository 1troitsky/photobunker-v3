import {describe,expect,it,vi} from 'vitest'
import {
  MAX_HTTPS_IMPORT_BYTES,validateHttpsImportUrl,downloadHttpsMedia,
} from './https-link-import'

const source='https://assets.example.org/files/private-audio.wav?token=NEVER-PERSIST-ME'
const content=(bytes=2048,mime='audio/wav')=>{
  const data=new Uint8Array(bytes).fill(0x41)
  const response=new Response(data.buffer,{
    status:200,headers:{'content-type':mime,'content-length':String(bytes)},
  })
  Object.defineProperty(response,'url',{value:source})
  return response
}
const fetcher=(response:Response)=>{
  const mock=vi.fn(async()=>response)
  return {mock,fetch:mock as unknown as typeof fetch}
}

describe('P2 V-37 client-only HTTPS file import (no proxy / credential leak)',()=>{
  it('rejects local/private/ambiguous/unsafe schemes, URLs, credentials and ports BEFORE fetch',()=>{
    const invalid=[
      'http://assets.example.org/a.wav',
      'ftp://assets.example.org/a.wav',
      'data:audio/wav;base64,AAAA',
      'https://u:p@assets.example.org/a.wav',
      'https://assets.example.org:8443/a.wav',
      'https://localhost/a.wav','https://localhost.attacker.localhost/a.wav',
      'https://host.local/a.wav','https://internal.internal/a.wav',
      'https://127.0.0.1/a.wav','https://192.168.1.1/a.wav',
      'https://[::1]/a.wav','https://assets.example.org/a.wav#fragment',
      'https://assets.example.org/with spaces.wav',
      'https://assets.example.org\\@localhost/a.wav',
      'https://-evil.example.org/a.wav',
    ]
    for(const url of invalid)
      expect(()=>validateHttpsImportUrl(url)).toThrow()
    expect(validateHttpsImportUrl(source).href).toBe(source)
  })
  it('uses CORS/omit credentials/no-referrer/no redirects, keeps query outside encrypted filename',async()=>{
    const {mock,fetch}=fetcher(content())
    const progress:number[]=[]
    const result=await downloadHttpsMedia(source,new AbortController().signal,
      ()=>true,p=>progress.push(p.downloadedBytes),fetch)
    expect(result.name).toBe('private-audio.wav')
    expect(result.type).toBe('audio/wav')
    expect(result.size).toBe(2048)
    expect([...new Uint8Array(await result.arrayBuffer())].every(x=>x===0x41))
      .toBe(true)
    expect(result.name).not.toContain('NEVER-PERSIST')
    expect(progress.at(-1)).toBe(2048)
    expect(mock).toHaveBeenCalledOnce()
    expect(mock.mock.calls[0]?.[0]).toBe(source)
    expect(mock.mock.calls[0]?.[1]).toMatchObject({
      method:'GET',mode:'cors',credentials:'omit',redirect:'error',
      referrerPolicy:'no-referrer',cache:'no-store',
    })
  })
  it('fails closed on HTML response, non-200, redirects and mismatched actual URL',async()=>{
    const html=content(2048,'text/html')
    const partial=new Response(new Uint8Array(1024).buffer,{status:206,
      headers:{'content-type':'audio/wav'}})
    Object.defineProperty(partial,'url',{value:source})
    const moved=content()
    Object.defineProperty(moved,'redirected',{value:true})
    const different=content()
    Object.defineProperty(different,'url',{value:'https://other.example.org/file'})
    for(const response of [html,partial,moved,different])
      await expect(downloadHttpsMedia(source,new AbortController().signal,
        ()=>true,undefined,fetcher(response).fetch)).rejects.toThrow()
  })
  it('rejects missing or invalid content-length, too-small content and oversized length',async()=>{
    for(const length of ['1','0','33554433','not-a-number']){
      const res=content()
      res.headers.set('content-length',length)
      await expect(downloadHttpsMedia(source,new AbortController().signal,
        ()=>true,undefined,fetcher(res).fetch))
        .rejects.toThrow('media.link_size_limit')
    }
    const res=content(64)
    await expect(downloadHttpsMedia(source,new AbortController().signal,
      ()=>true,undefined,fetcher(res).fetch))
      .rejects.toThrow('media.link_size_limit')
  })
  it('stops a dishonest endless streaming response at the 32MiB decoded cap',async()=>{
    let read=0
    const stream=new ReadableStream<Uint8Array>({
      pull(controller){
        controller.enqueue(new Uint8Array(1024*1024))
        if(++read>40)controller.close()
      },
    })
    const fake={status:200,url:source,redirected:false,type:'cors',
      headers:new Headers({'content-type':'audio/wav'}),body:stream}
      as unknown as Response
    await expect(downloadHttpsMedia(source,new AbortController().signal,
      ()=>true,undefined,fetcher(fake).fetch))
      .rejects.toThrow('media.link_size_limit')
    expect(MAX_HTTPS_IMPORT_BYTES).toBe(32*1024*1024)
    expect(read).toBeLessThanOrEqual(35)
  })
  it('cancels on account change before download or between chunks',async()=>{
    const {mock,fetch}=fetcher(content())
    await expect(downloadHttpsMedia(source,new AbortController().signal,
      ()=>false,undefined,fetch))
      .rejects.toThrow('media.link_cancelled')
    expect(mock).not.toHaveBeenCalled()
    let same=true
    await expect(downloadHttpsMedia(source,new AbortController().signal,
      ()=>same,()=>{same=false},fetcher(content()).fetch))
      .rejects.toThrow('media.link_cancelled')
    const controller=new AbortController()
    controller.abort()
    await expect(downloadHttpsMedia(source,controller.signal,
      ()=>true,undefined,fetch))
      .rejects.toThrow('media.link_cancelled')
    expect(mock).not.toHaveBeenCalled()
  })
  it('rejects CORS/network failures without echoing sensitive URL parameters',async()=>{
    const error=await downloadHttpsMedia(source,new AbortController().signal,
      ()=>true,undefined,vi.fn(async()=>{throw Error('token=NEVER-PERSIST-ME')})
        as unknown as typeof fetch).catch(e=>e as Error)
    expect(error.message).toBe('media.link_cors_or_network')
    expect(error.message).not.toContain('NEVER-PERSIST-ME')
  })
})
