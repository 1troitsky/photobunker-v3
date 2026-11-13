import {MAX_MEDIA_BYTES} from '../../media/domain/media-crypto'
import {safeDownloadName} from './viewer-navigation'

// Full-track decoding is bounded because codec decompression can amplify a
// small encrypted media file into very large in-memory floating PCM buffers.
export const MAX_AUDIO_DECODE_BYTES=32*1024*1024
const MAX_DECODED_SAMPLES=24_000_000
const MIN_CLIP_SECONDS=0.05
const MAX_CLIP_SECONDS=600

export type WavClip={
  blob:Blob;startMs:number;endMs:number
  sampleRate:number;channels:number;frames:number
}
// Use the broad typed-array contract: AudioBuffer returns ArrayBuffer-backed
// data, while pure tests may supply ordinary ArrayBufferLike float arrays.
type DecodedPCM=Pick<AudioBuffer,
  'sampleRate'|'numberOfChannels'|'length'> & {
  getChannelData(channel:number):Float32Array
}

function validRange(start:number,end:number,duration:number):void{
  if(!Number.isFinite(start)||!Number.isFinite(end)
    ||!Number.isFinite(duration)||duration<=0
    ||start<0||end<=start||end-start<MIN_CLIP_SECONDS
    ||end-start>MAX_CLIP_SECONDS
    ||start>duration||end>duration+0.035)
    throw Error('viewer.audio_range_invalid')
}
export function audioClipName(name:string,startMs:number,endMs:number):string{
  if(!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)
    ||startMs<0||endMs<=startMs||endMs>86_400_000)
    throw Error('viewer.audio_range_invalid')
  const stem=safeDownloadName(name,'audio')
    .replace(/\.[^.]+$/,'').slice(0,85)||'audio'
  return stem+'-clip-'+startMs+'-'+endMs+'ms.wav'
}
function ascii(view:DataView,offset:number,text:string):void{
  for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i))
}

/** Convert a bounded selected region to independent 16-bit PCM WAV bytes. */
export function encodePcm16Wav(
  pcm:DecodedPCM,startSeconds:number,endSeconds:number,
):Uint8Array<ArrayBuffer>{
  if(!Number.isSafeInteger(pcm.sampleRate)
    ||pcm.sampleRate<8000||pcm.sampleRate>96000
    ||!Number.isSafeInteger(pcm.numberOfChannels)
    ||pcm.numberOfChannels<1||pcm.numberOfChannels>2
    ||!Number.isSafeInteger(pcm.length)||pcm.length<=0
    ||pcm.length*pcm.numberOfChannels>MAX_DECODED_SAMPLES)
    throw Error('viewer.audio_decode_limit')
  validRange(startSeconds,endSeconds,pcm.length/pcm.sampleRate)
  const start=Math.floor(startSeconds*pcm.sampleRate)
  const end=Math.min(pcm.length,Math.ceil(endSeconds*pcm.sampleRate))
  const frames=end-start,channels=pcm.numberOfChannels
  const byteLength=44+frames*channels*2
  if(frames<1||!Number.isSafeInteger(byteLength)||byteLength<128
    ||byteLength>MAX_MEDIA_BYTES)
    throw Error('viewer.audio_output_limit')
  const samples=Array.from({length:channels},(_,channel)=>{
    const data=pcm.getChannelData(channel)
    if(data.length<pcm.length)throw Error('viewer.audio_invalid_pcm')
    return data
  })
  const data=new Uint8Array(byteLength)
  const header=new DataView(data.buffer)
  ascii(header,0,'RIFF');header.setUint32(4,byteLength-8,true)
  ascii(header,8,'WAVE');ascii(header,12,'fmt ')
  header.setUint32(16,16,true) // canonical PCM fmt header, no extension
  header.setUint16(20,1,true) // integer PCM
  header.setUint16(22,channels,true)
  header.setUint32(24,pcm.sampleRate,true)
  header.setUint32(28,pcm.sampleRate*channels*2,true)
  header.setUint16(32,channels*2,true)
  header.setUint16(34,16,true)
  ascii(header,36,'data')
  header.setUint32(40,byteLength-44,true)
  let index=44
  for(let frame=start;frame<end;frame++)
    for(let channel=0;channel<channels;channel++){
      const value=samples[channel]![frame]!
      const clamped=Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0
      const signed=Math.round(clamped<0?clamped*32768:clamped*32767)
      header.setInt16(index,signed,true);index+=2
    }
  return data
}

/** One explicitly invoked, bounded local decode. Never fetches a remote URL. */
export async function makeWavClip(
  source:Blob,startSeconds:number,endSeconds:number,
):Promise<WavClip>{
  if(source.size<128||source.size>MAX_AUDIO_DECODE_BYTES)
    throw Error('viewer.audio_source_limit')
  const AudioConstructor=typeof AudioContext!=='undefined'?AudioContext:
    (globalThis as typeof globalThis & {
      webkitAudioContext?:typeof AudioContext
    }).webkitAudioContext
  if(!AudioConstructor)throw Error('viewer.audio_decoder_unsupported')
  const context=new AudioConstructor()
  try{
    const encoded=await source.arrayBuffer()
    const decoded=await context.decodeAudioData(encoded)
    const wav=encodePcm16Wav(decoded,startSeconds,endSeconds)
    return {
      blob:new Blob([wav],{type:'audio/wav'}),
      startMs:Math.round(startSeconds*1000),
      endMs:Math.round(endSeconds*1000),
      sampleRate:decoded.sampleRate,channels:decoded.numberOfChannels,
      frames:(wav.length-44)/(decoded.numberOfChannels*2),
    }
  }finally{
    await context.close()
  }
}
