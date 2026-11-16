// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {saveRecoveryKeyWithSystemDialog} from './recovery-key-save'

const key='SENSITIVE_TEST_RECOVERY_KEY'
function readBlob(blob:Blob):Promise<string>{
  // jsdom intentionally does not implement every browser Blob method.
  return new Promise((resolve,reject)=>{
    const reader=new FileReader()
    reader.onload=()=>resolve(String(reader.result))
    reader.onerror=()=>reject(reader.error)
    reader.readAsText(blob)
  })
}
afterEach(()=>{
  Reflect.deleteProperty(window,'showSaveFilePicker')
  Reflect.deleteProperty(navigator,'canShare')
  Reflect.deleteProperty(navigator,'share')
  vi.restoreAllMocks()
})
function picker(fn:()=>Promise<unknown>):void{
  Object.defineProperty(window,'showSaveFilePicker',{
    configurable:true,value:fn,
  })
}
describe('owner-confirmed OS Recovery Key export',()=>{
  it('saves exactly the Recovery Key through an explicitly selected File System picker',async()=>{
    const write=vi.fn().mockResolvedValue(undefined)
    const close=vi.fn().mockResolvedValue(undefined)
    const open=vi.fn().mockResolvedValue({createWritable:async()=>({write,close})})
    picker(open)
    expect(await saveRecoveryKeyWithSystemDialog(key,'photobunker')).toBe('saved')
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName:'photobunker-Recovery-Key.txt',
    }))
    expect(write).toHaveBeenCalledTimes(1)
    const content=write.mock.calls[0]![0] as Blob
    expect(await readBlob(content)).toBe(key+'\n')
    expect(close).toHaveBeenCalledOnce()
  })
  it('does not report success when the user cancels the chooser',async()=>{
    picker(vi.fn().mockRejectedValue(new DOMException('cancelled','AbortError')))
    expect(await saveRecoveryKeyWithSystemDialog(key,'photobunker')).toBe('cancelled')
  })
  it('never reports success after a failed write and aborts the incomplete file',async()=>{
    const abort=vi.fn().mockResolvedValue(undefined)
    picker(vi.fn().mockResolvedValue({
      createWritable:async()=>({
        write:async()=>{throw Error('disk full')},
        close:vi.fn(),
        abort,
      }),
    }))
    expect(await saveRecoveryKeyWithSystemDialog(key,'photobunker')).toBe('failed')
    expect(abort).toHaveBeenCalledOnce()
  })
  it('uses an explicitly selected OS share sheet on mobile without pretending save ACK',async()=>{
    const share=vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true})
    Object.defineProperty(navigator,'share',{configurable:true,value:share})
    expect(await saveRecoveryKeyWithSystemDialog(key,'photobunker')).toBe('shared')
    const data=share.mock.calls[0]![0] as {files:File[];title:string}
    expect(data.title).toBe('Recovery Key')
    expect(data.files).toHaveLength(1)
    expect(await readBlob(data.files[0]!)).toBe(key+'\n')
  })
  it('does not create an anchor download when neither supported OS dialog exists',async()=>{
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click')
    expect(await saveRecoveryKeyWithSystemDialog(key,'photobunker')).toBe('unsupported')
    expect(click).not.toHaveBeenCalled()
  })
  it('rejects unsafe filename values and never opens a picker',async()=>{
    const open=vi.fn()
    picker(open)
    expect(await saveRecoveryKeyWithSystemDialog(key,'../private')).toBe('failed')
    expect(open).not.toHaveBeenCalled()
  })
})
