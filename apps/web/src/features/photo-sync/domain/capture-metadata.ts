import type { SignedCaptureBinding } from '../../assignments/application/assignment-outbox'

/** Client-only private fields. Never put these in signed photo contracts,
 * public manifests, API bodies, URLs, logs or unencrypted IndexedDB rows. */
export type GPSFix=Readonly<{
  latitude:number
  longitude:number
  accuracyMeters:number
  obtainedAt:number
}>
export type CaptureMetadataInput=Readonly<{
  category?:string
  description?:string
  gps?:GPSFix|null
}>
export type PhotoMetadata=Readonly<{
  version:1|2
  type:'image/jpeg'
  source:'camera'
  capturedAt:number
  assignmentCapture?:SignedCaptureBinding
  category?:string
  description?:string
  gps?:GPSFix
}>

function validMillis(ms:number):boolean{
  return Number.isSafeInteger(ms)&&ms>=1_500_000_000_000
    &&ms<=Date.now()+120_000
}
function cleanText(text:unknown,limit:number,field:string):string|undefined{
  if(text===undefined||text===null||text==='')return undefined
  if(typeof text!=='string')throw Error('capture.invalid_'+field)
  const value=text.trim()
  if(!value)return undefined
  if(value.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw Error('capture.invalid_'+field)
  return value
}
export function normalizeGPS(gps:GPSFix,capturedAt:number):GPSFix {
  if(!gps||!Number.isFinite(gps.latitude)||!Number.isFinite(gps.longitude)
    ||gps.latitude< -90||gps.latitude>90
    ||gps.longitude< -180||gps.longitude>180
    ||!Number.isFinite(gps.accuracyMeters)
    ||gps.accuracyMeters<0||gps.accuracyMeters>100_000
    ||!validMillis(gps.obtainedAt)
    ||gps.obtainedAt>capturedAt+2_000
    ||capturedAt-gps.obtainedAt>120_000)
    throw Error('capture.invalid_or_stale_gps')
  return {
    latitude:gps.latitude,longitude:gps.longitude,
    accuracyMeters:gps.accuracyMeters,obtainedAt:gps.obtainedAt,
  }
}
export function preparePhotoMetadata(
  capturedAt:number,assignmentCapture?:SignedCaptureBinding,
  privateInput:CaptureMetadataInput={},
):PhotoMetadata{
  if(!validMillis(capturedAt))throw Error('capture.invalid_time')
  const category=cleanText(privateInput.category,64,'category')
  const description=cleanText(privateInput.description,2_000,'description')
  const gps=privateInput.gps?normalizeGPS(privateInput.gps,capturedAt):undefined
  const anyPrivate=category!==undefined||description!==undefined||gps!==undefined
  return {
    version:anyPrivate?2:1,
    type:'image/jpeg',capturedAt,source:'camera',
    ...(assignmentCapture?{assignmentCapture}:{}),
    ...(category?{category}:{}),
    ...(description?{description}:{}),
    ...(gps?{gps}:{}),
  }
}
/** Parse only already decrypted metadata. Reject corrupt data, never persist it. */
export function parsePhotoMetadata(value:unknown):PhotoMetadata{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('capture.invalid_metadata')
  const row=value as Record<string,unknown>
  if((row.version!==1&&row.version!==2)||row.type!=='image/jpeg'
    ||row.source!=='camera'||!validMillis(row.capturedAt as number))
    throw Error('capture.invalid_metadata')
  const capture=row.assignmentCapture as SignedCaptureBinding|undefined
  if(capture!==undefined){
    if(!capture||typeof capture!=='object'
      ||!Number.isSafeInteger(capture.capturedAt)
      ||capture.capturedAt!==row.capturedAt
      ||typeof capture.assignmentId!=='string'
      ||typeof capture.ownerAccountId!=='string'
      ||!Number.isSafeInteger(capture.policyRevision)
      ||typeof capture.policyHash!=='string')
      throw Error('capture.invalid_metadata')
  }
  const allowed=['version','type','source','capturedAt','assignmentCapture']
  if(row.version===2)allowed.push('category','description','gps')
  if(Object.keys(row).some(k=>!allowed.includes(k)))
    throw Error('capture.invalid_metadata')
  const normalized=preparePhotoMetadata(
    row.capturedAt as number,capture,{
      category:row.category as string|undefined,
      description:row.description as string|undefined,
      gps:row.gps as GPSFix|undefined,
    },
  )
  if(normalized.version!==row.version)
    throw Error('capture.invalid_metadata')
  return normalized
}
