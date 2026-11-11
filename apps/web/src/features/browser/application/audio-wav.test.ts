import {describe,it,expect} from 'vitest'
import {audioClipName,encodePcm16Wav} from './audio-wav'

function pcm(samples:Float32Array[],rate=8000){
  const size=samples[0]?.length??0
  return {
    sampleRate:rate,numberOfChannels:samples.length,length:size,
    duration:size/rate,getChannelData:(channel:number)=>samples[channel]!,
  }
}
describe('Viewer on-device WAV trim safety',()=>{
  it('writes a valid mono PCM header, clips samples and uses exact segment bounds',()=>{
    const samples=new Float32Array(8000).fill(0)
    samples[2000]=1;samples[2001]=-1;samples[2002]=NaN
    const raw=encodePcm16Wav(pcm([samples]),0.25,0.5)
    const view=new DataView(raw.buffer)
    const ascii=(start:number,n:number)=>String.fromCharCode(...raw.slice(start,start+n))
    expect(ascii(0,4)).toBe('RIFF')
    expect(ascii(8,4)).toBe('WAVE')
    expect(ascii(12,4)).toBe('fmt ')
    expect(ascii(36,4)).toBe('data')
    expect(view.getUint32(4,true)).toBe(raw.length-8)
    expect(view.getUint16(20,true)).toBe(1)
    expect(view.getUint16(22,true)).toBe(1)
    expect(view.getUint32(24,true)).toBe(8000)
    expect(view.getUint16(34,true)).toBe(16)
    expect(view.getUint32(40,true)).toBe(2000*2)
    expect(view.getInt16(44,true)).toBe(32767)
    expect(view.getInt16(46,true)).toBe(-32768)
    expect(view.getInt16(48,true)).toBe(0)
  })
  it('interleaves real stereo channels in signed little-endian PCM',()=>{
    const first=new Float32Array(8000).fill(0)
    const second=new Float32Array(8000).fill(0)
    first[0]=0.5;second[0]=-0.5
    const wav=encodePcm16Wav(pcm([first,second]),0,0.1)
    const view=new DataView(wav.buffer)
    expect(view.getUint16(22,true)).toBe(2)
    expect(view.getUint16(32,true)).toBe(4)
    expect(view.getInt16(44,true)).toBe(16384)
    expect(view.getInt16(46,true)).toBe(-16384)
  })
  it('rejects oversized decode, unsupported channels and invalid ranges',()=>{
    const normal=pcm([new Float32Array(16000)])
    for(const [start,end] of [[-1,1],[0,0],[0,0.01],[0,3],[1.9,1.99],
      [NaN,1],[0,Infinity]])
      expect(()=>encodePcm16Wav(normal,start,end))
        .toThrow('viewer.audio_range_invalid')
    expect(()=>encodePcm16Wav({...normal,numberOfChannels:3},0,1))
      .toThrow('viewer.audio_decode_limit')
    expect(()=>encodePcm16Wav({...normal,sampleRate:200000},0,1))
      .toThrow('viewer.audio_decode_limit')
    expect(()=>encodePcm16Wav({...normal,length:30_000_000},0,1))
      .toThrow('viewer.audio_decode_limit')
  })
  it('makes filesystem-safe, time-bounded private output names',()=>{
    expect(audioClipName('../SECRET\\notes.wav',250,750))
      .toBe('SECRET_notes-clip-250-750ms.wav')
    expect(audioClipName('голос.webm',0,1000))
      .toBe('голос-clip-0-1000ms.wav')
    for(const [a,b] of [[-1,2],[4,3],[0,86_400_001],[0,NaN]])
      expect(()=>audioClipName('recording.wav',a,b))
        .toThrow('viewer.audio_range_invalid')
  })
})
