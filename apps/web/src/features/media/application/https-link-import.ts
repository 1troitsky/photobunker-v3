/**
 * Browser-only, explicit HTTPS direct-file import. No backend proxy, API
 * credential, referrer, redirect, plaintext URL persistence or OS gallery.
 * The caller must E2EE-encrypt the returned File into its durable outbox.
 *
 * This is NOT an SSRF-proof remote fetch: browser DNS resolution is outside
 * the app's trust boundary. Block local/opaque destinations and redirects,
 * rely on browser CORS/PNA, and never grant an external URL server-side.
 */
const MAX_REMOTE_BYTES=32*1024*1024
export const MAX_HTTPS_IMPORT_BYTES=MAX_REMOTE_BYTES

const mimes:Readonly<Record<string,string>>={
  'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp',
  'video/mp4':'.mp4','video/webm':'.webm',
  'video/quicktime':'.mov',
  'audio/mp4':'.m4a','audio/mpeg':'.mp3',
  'audio/webm':'.webm','audio/wav':'.wav',
  'audio/x-wav':'.wav','audio/aac':'.aac','audio/ogg':'.ogg',
}
export type HttpsImportProgress={
  downloadedBytes:number;expectedBytes:number|null
}
export function validateHttpsImportUrl(raw:string):URL{
  if(typeof raw!=='string'||raw.length===0||raw.length>4096
    ||/\s|\\|[\u0000-\u001f\u007f]/.test(raw))
    throw Error('media.link_invalid_https_url')
  let url:URL
  try{url=new URL(raw)}catch{throw Error('media.link_invalid_https_url')}
  if(url.protocol!=='https:'||url.username||url.password||url.hash
    ||(url.port!==''&&url.port!=='443')
    ||url.hostname.length>253
    ||url.hostname.endsWith('.'))
    throw Error('media.link_invalid_https_url')
  const hostname=url.hostname.toLowerCase()
  // No IPv4/IPv6/localhost or internal/rebinding-friendly local TLD
  // literals. A DNS hostname can still be rebound: no SSRF-proof claim.
  if(hostname==='localhost'||hostname.endsWith('.localhost')
    ||hostname.endsWith('.local')||hostname.endsWith('.internal')
    ||hostname.endsWith('.test')||hostname.endsWith('.invalid')
    ||hostname.endsWith('.example')||hostname.includes(':')
    ||/^[\d.]+$/.test(hostname)
    ||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(hostname)
    ||hostname.split('.').some(part=>part.length>63
      ||part.startsWith('-')||part.endsWith('-')))
    throw Error('media.link_private_host')
  return url
}
function safeFileName(url:URL,mime:string):string{
  let tail=url.pathname.split('/').pop()||''
  try{tail=decodeURIComponent(tail)}catch{tail=''}
  const base=tail.replace(/[\\/\u0000-\u001f\u007f]/g,'_')
    .replace(/\.[a-zA-Z0-9]{1,12}$/,'').trim()
    .replace(/^\.+/,'').slice(0,120)
  return (base||'external-media')+mimes[mime]
}

/**
 * Maximum 32 MiB decoded plaintext in memory; Content-Length pre-check is
 * only an optimization (the decoded stream is always counted independently).
 * Ignore Content-Disposition, remote path/query outside the encrypted
 * per-file name; never persist source URL or grant the remote host an app key.
 */
export async function downloadHttpsMedia(
  rawUrl:string,
  signal:AbortSignal,
  stillCurrent:()=>boolean,
  onProgress?:(progress:HttpsImportProgress)=>void,
  fetcher:typeof fetch=fetch,
):Promise<File>{
  const url=validateHttpsImportUrl(rawUrl)
  if(!stillCurrent()||signal.aborted)throw Error('media.link_cancelled')
  let response:Response
  try{
    response=await fetcher(url.href,{
      method:'GET',mode:'cors',credentials:'omit',redirect:'error',
      referrerPolicy:'no-referrer',cache:'no-store',signal,
    })
  }catch{
    if(!stillCurrent()||signal.aborted)throw Error('media.link_cancelled')
    throw Error('media.link_cors_or_network')
  }
  if(!stillCurrent()||signal.aborted)throw Error('media.link_cancelled')
  if(response.status!==200||response.type==='opaque'
    ||response.redirected||response.url!==url.href)
    throw Error('media.link_direct_response_required')
  const mime=(response.headers.get('content-type')??'')
    .split(';')[0]!.trim().toLowerCase()
  if(!Object.hasOwn(mimes,mime))throw Error('media.link_unsupported_mime')
  const header=response.headers.get('content-length')
  const expectedBytes=header===null?null:
    (/^\d+$/.test(header)?Number(header):NaN)
  if(expectedBytes!==null&&(!Number.isSafeInteger(expectedBytes)
    ||expectedBytes<128||expectedBytes>MAX_REMOTE_BYTES))
    throw Error('media.link_size_limit')
  if(!response.body)throw Error('media.link_stream_required')
  const reader=response.body.getReader()
  const chunks:Uint8Array<ArrayBuffer>[]=[]
  let downloadedBytes=0
  let complete=false
  try{
    while(true){
      if(signal.aborted||!stillCurrent())throw Error('media.link_cancelled')
      const {done,value}=await reader.read()
      if(signal.aborted||!stillCurrent())throw Error('media.link_cancelled')
      if(done){complete=true;break}
      if(!value||!value.byteLength)continue
      downloadedBytes+=value.byteLength
      if(downloadedBytes>MAX_REMOTE_BYTES)
        throw Error('media.link_size_limit')
      chunks.push(new Uint8Array(value))
      onProgress?.({downloadedBytes,expectedBytes})
    }
  }catch(e){
    if(signal.aborted||!stillCurrent())
      throw Error('media.link_cancelled')
    if(e instanceof Error
      &&['media.link_size_limit','media.link_cancelled'].includes(e.message))
      throw e
    throw Error('media.link_stream_failure')
  }finally{
    if(!complete)void reader.cancel().catch(()=>{})
    reader.releaseLock()
  }
  if(downloadedBytes<128
    ||expectedBytes!==null&&downloadedBytes!==expectedBytes)
    throw Error('media.link_size_limit')
  if(signal.aborted||!stillCurrent())throw Error('media.link_cancelled')
  const name=safeFileName(url,mime)
  // No FileReader/data URL, no persistent plaintext blob, no direct S3 API
  // call. The calling UI immediately passes this volatile File to AES-GCM.
  return new File(chunks,name,{type:mime,lastModified:Date.now()})
}
