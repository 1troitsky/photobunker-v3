<script setup lang="ts">
import {computed,onUnmounted,ref,watch} from 'vue'
import {activeSession} from '../../identity/application/session'
import {
  digest,hex,
} from '../../identity/infrastructure/crypto'
import {
  inspectFlattenedSafeJpeg,PUBLIC_JPEG_MAX_OUTPUT_BYTES,
} from '../application/public-card-safe-jpeg'
import type {PreparedSafePublicJpeg} from '../application/public-card-safe-jpeg'
import {
  listPreparedContributorConsents,prepareReviewedContributorConsent,
  withdrawPreparedContributorConsent,
} from '../application/public-card-consent-outbox'
import type {
  ConsentBinding,ConsentFields,
} from '../application/public-card-consent-outbox'

/**
 * Standalone private *reviewer* (not mounted in a shared route yet).
 * Receives already-flattened, already-decrypted local safe JPEG bytes.
 * NEVER downloads an original, transmits bytes, publishes a Card, or
 * persists any JPEG. Explicit user checkbox is an assertion, not a
 * cryptographic proof that a human inspected every sensitive pixel.
 */
const props=defineProps<{
  prepared:PreparedSafePublicJpeg|null
  binding:ConsentBinding|null
}>()
const emit=defineEmits<{
  prepared:[consentId:string]
  withdrawn:[submissionId:string]
}>()
const url=ref('')
const loaded=ref(false)
const acknowledged=ref(false)
const saving=ref(false)
const error=ref('')
const status=ref('')
const existing=ref(false)
const withdrawn=ref(false)
const description=ref(false)
const capturedAt=ref(false)
let serial=0
let context:{
  serial:number;session:NonNullable<typeof activeSession.value>
  binding:string;prepared:PreparedSafePublicJpeg;url:string
}|null=null

const validReview=computed(()=>loaded.value&&acknowledged.value
  &&!saving.value&&!existing.value&&!withdrawn.value
  &&!!context&&stillCurrent(context))
const canWithdraw=computed(()=>existing.value&&!saving.value
  &&!!context&&stillCurrent(context))
const fingerprint=computed(()=>props.prepared?.sha256?.slice(0,12)??'')

function forgetUrl():void{
  const previous=url.value
  url.value=''
  if(previous)URL.revokeObjectURL(previous)
}
function reset():void{
  ++serial
  context=null
  loaded.value=false
  acknowledged.value=false
  saving.value=false
  error.value=''
  status.value=''
  existing.value=false
  withdrawn.value=false
  description.value=false
  capturedAt.value=false
  forgetUrl()
}
function stillCurrent(item:NonNullable<typeof context>):boolean{
  return serial===item.serial
    &&url.value===item.url
    &&props.prepared===item.prepared
    &&JSON.stringify(props.binding)===item.binding
    &&activeSession.value===item.session
    &&props.prepared?.sha256===item.prepared.sha256
    &&props.prepared?.blob===item.prepared.blob
    &&props.binding!==null
    &&item.session.accountId.length>0
}

async function inspect(prepared:PreparedSafePublicJpeg):Promise<void>{
  if(prepared.published!==false
    ||prepared.humanReviewRequired!==true
    ||prepared.blob.type!=='image/jpeg'
    ||prepared.blob.size<32
    ||prepared.blob.size>PUBLIC_JPEG_MAX_OUTPUT_BYTES
    ||!/^[a-f0-9]{64}$/.test(prepared.sha256))
    throw Error('public_card.review_unsafe_input')
  const raw=new Uint8Array(await prepared.blob.arrayBuffer())
  const bytes=inspectFlattenedSafeJpeg(raw)
  if(bytes.width!==prepared.width||bytes.height!==prepared.height
    ||hex(await digest(new Uint8Array(raw)))!==prepared.sha256)
    throw Error('public_card.review_mismatched_bytes')
  if(typeof createImageBitmap!=='function')
    throw Error('public_card.review_browser_codec_missing')
  const bmp=await createImageBitmap(prepared.blob)
  try{
    if(bmp.width!==prepared.width||bmp.height!==prepared.height)
      throw Error('public_card.review_decoder_changed')
  }finally{bmp.close()}
}
watch([
  ()=>props.prepared,
  ()=>JSON.stringify(props.binding),
  activeSession,
],async()=>{
  reset()
  const next=serial
  const session=activeSession.value
  const prepared=props.prepared
  const binding=props.binding
  if(!session||!prepared||!binding)return
  const snapshot=JSON.stringify(binding)
  try{
    await inspect(prepared)
    if(next!==serial||session!==activeSession.value
      ||props.prepared!==prepared
      ||JSON.stringify(props.binding)!==snapshot)return
    // Only after strict byte validation do the pixels reach <img>.
    const objectUrl=URL.createObjectURL(prepared.blob)
    url.value=objectUrl
    context={serial:next,session,binding:snapshot,prepared,url:objectUrl}
    const saved=await listPreparedContributorConsents()
    if(!context||!stillCurrent(context))return
    existing.value=saved.some(item=>
      item.contract.submissionId===binding.submissionId)
    if(existing.value){
      status.value='Для этого отправления уже есть локальный подписанный черновик. Для повторной подготовки сначала нужен отдельный новый protocol.'
    }
  }catch(e){
    if(next!==serial||session!==activeSession.value)return
    // Corrupt local consent MUST NOT be treated as "no record".
    existing.value=true
    error.value=e instanceof Error?e.message:'public_card.review_unavailable'
    loaded.value=false
  }
},{immediate:true})

function imageLoaded(event:Event):void{
  const item=context
  if(!item||!stillCurrent(item))return
  const image=event.target as HTMLImageElement
  if(image.src!==item.url)return
  loaded.value=true
}
function imageFailed():void{
  loaded.value=false
  acknowledged.value=false
  error.value='public_card.review_display_failed'
}
function changeAcknowledgement(event:Event):void{
  acknowledged.value=(event.target as HTMLInputElement).checked
    &&loaded.value&&!existing.value&&!withdrawn.value
}
function scopeChanged():void{acknowledged.value=false}
async function saveReview():Promise<void>{
  const item=context
  if(!item||!validReview.value||!props.binding)return
  const binding:ConsentBinding={...props.binding}
  const fields:ConsentFields={
    description:description.value,capturedAt:capturedAt.value,
    updatedAt:false,tags:false,authorTeam:false,gps:false,metadata:false,
  }
  // Prepared declarations are bounded to <=24h and all retention ceilings.
  const expiresAt=Math.min(Date.now()+15*60*1000,
    binding.sourceExpiresAt,binding.safeExpiresAt,
    binding.assignmentExpiresAt)
  saving.value=true;error.value='';status.value=''
  try{
    if(!stillCurrent(item)||!loaded.value)
      throw Error('public_card.review_changed')
    const consentId=await prepareReviewedContributorConsent(
      binding,item.prepared,{
        visiblePixelsReviewed:true,reviewedSha256:item.prepared.sha256,
      },fields,expiresAt,
      ()=>{if(!stillCurrent(item)||!loaded.value)
        throw Error('public_card.review_changed')},
    )
    if(!stillCurrent(item))return
    existing.value=true
    acknowledged.value=false
    status.value='Подписанный черновик подготовлен только на этом устройстве. Публикация выключена.'
    emit('prepared',consentId)
  }catch(e){
    if(stillCurrent(item))
      error.value=e instanceof Error?e.message:'public_card.review_failed'
  }finally{
    if(stillCurrent(item))saving.value=false
  }
}
async function withdrawReview():Promise<void>{
  const item=context
  if(!item||!canWithdraw.value||!props.binding)return
  saving.value=true;error.value='';status.value=''
  try{
    const res=await withdrawPreparedContributorConsent(
      props.binding.submissionId,
    )
    if(!stillCurrent(item))return
    if(res.publicGrantRevoked!==false||res.localOnly!==true)
      throw Error('public_card.review_unexpected_remote_state')
    existing.value=false
    withdrawn.value=true
    acknowledged.value=false
    status.value='Локальный черновик отозван. Серверных разрешений это не изменяет.'
    emit('withdrawn',props.binding.submissionId)
  }catch(e){
    if(stillCurrent(item))
      error.value=e instanceof Error?e.message:'public_card.review_withdraw_failed'
  }finally{
    if(stillCurrent(item))saving.value=false
  }
}
onUnmounted(reset)
</script>

<template>
  <section class="public-consent-review" data-testid="public-card-consent-review"
    aria-label="Проверка закрытой JPEG-копии">
    <h3>Проверка безопасной копии</h3>
    <p class="muted">Просмотрите именно этот JPEG. Убедитесь, что лица, адреса,
      координаты и другие чувствительные сведения не видны на самой картинке.</p>
    <p class="muted">Это только локальная подготовка согласия.
      <strong>Ничего не опубликовано и никакая ссылка не создана.</strong></p>
    <template v-if="url">
      <figure>
        <img :key="url" :src="url" alt="Безопасная копия для визуального просмотра"
          data-testid="public-card-review-image"
          @load="imageLoaded" @error="imageFailed">
        <figcaption>SHA-256 JPEG: <code data-testid="public-card-review-hash">{{ fingerprint }}</code>…</figcaption>
      </figure>
      <p v-if="!loaded" role="status">Проверка отображения JPEG…</p>
      <template v-if="loaded">
        <label class="review-field">
          <input type="checkbox" :checked="description" :disabled="saving||existing||withdrawn"
            data-testid="public-card-review-description"
            @change="e=>{description=(e.target as HTMLInputElement).checked;scopeChanged()}">
          Разрешить описание в будущем (только после отдельной публикации)
        </label>
        <label class="review-field">
          <input type="checkbox" :checked="capturedAt" :disabled="saving||existing||withdrawn"
            data-testid="public-card-review-date"
            @change="e=>{capturedAt=(e.target as HTMLInputElement).checked;scopeChanged()}">
          Разрешить дату съёмки в будущем
        </label>
        <label class="review-field">
          <input type="checkbox" :checked="acknowledged"
            :disabled="saving||existing||withdrawn" data-testid="public-card-review-confirm"
            @change="changeAcknowledgement">
          Я просмотрел(а) именно эту безопасную копию и подтверждаю её SHA-256
        </label>
      </template>
    </template>
    <button type="button" :disabled="!validReview"
      data-testid="public-card-review-prepare" @click="saveReview">
      Подготовить согласие локально
    </button>
    <button type="button" :disabled="!canWithdraw"
      data-testid="public-card-review-withdraw" @click="withdrawReview">
      Отозвать локальный черновик
    </button>
    <p v-if="status" role="status" data-testid="public-card-review-status">{{ status }}</p>
    <p v-if="error" role="alert" data-testid="public-card-review-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.public-consent-review{display:grid;gap:12px;max-width:680px}
.public-consent-review figure{margin:0;display:grid;gap:8px}
.public-consent-review img{max-width:100%;max-height:70vh;object-fit:contain;background:#161616}
.public-consent-review figcaption{font-size:12px;word-break:break-all}
.review-field{display:flex;align-items:flex-start;gap:8px}
.muted{opacity:.76}
</style>
