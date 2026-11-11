import {describe,expect,it} from 'vitest'
import type {CatalogItem} from './catalog'
import {
  adjacentFiles,parseViewerTarget,safeDownloadName,viewerKey,
} from './viewer-navigation'

const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const c='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
function row(protocol:'photo'|'media',id:string,time:number):CatalogItem{
  return {
    key:protocol+':'+id,id,type:protocol==='photo'?'photo':'video',
    local:true,cloud:false,state:'queued',createdAt:time,
    expiresAt:time+86400000,bytes:1024,source:protocol,
  }
}
describe('P2 Viewer route and navigation isolation',()=>{
  it('only accepts opaque UUIDs and known protocols',()=>{
    expect(parseViewerTarget('photo',a)).toEqual({protocol:'photo',id:a})
    expect(parseViewerTarget('media',b.toUpperCase())).toEqual({
      protocol:'media',id:b,
    })
    for(const [protocol,id] of [
      ['photo','../settings'],['media','../../account'],
      ['bad',a],['photo','not-a-uuid'],['photo',a+'?key=secret'],
    ])expect(parseViewerTarget(protocol,id)).toBeNull()
    expect(parseViewerTarget(['media'],a)).toBeNull()
  })
  it('never conflates an imported photo with camera photo protocol',()=>{
    expect(viewerKey({protocol:'photo',id:a})).toBe('photo:'+a)
    expect(viewerKey({protocol:'media',id:a})).toBe('media:'+a)
  })
  it('navigates only within the already authenticated loaded index',()=>{
    const rows=[row('photo',a,100),row('media',b,300),row('media',c,200)]
    const around=adjacentFiles(rows,{protocol:'media',id:c})
    expect(around).toMatchObject({position:2,total:3})
    expect(around.previous?.id).toBe(b)
    expect(around.next?.id).toBe(a)
    expect(adjacentFiles(rows,{protocol:'photo',id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}))
      .toMatchObject({previous:null,next:null,position:0,total:3})
  })
  it('removes directory traversal and OS path delimiters from export names',()=>{
    expect(safeDownloadName('../pictures\\private/video.webm','file'))
      .toBe('pictures_private_video.webm')
    expect(safeDownloadName('...  ','fallback')).toBe('fallback')
    expect(safeDownloadName('report\u0000.mp4','file')).toBe('report_.mp4')
    expect(safeDownloadName('  имя-файла.wav  ','file')).toBe('имя-файла.wav')
  })
})
