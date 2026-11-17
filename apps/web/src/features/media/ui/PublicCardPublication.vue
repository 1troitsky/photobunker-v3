<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue'
import {activeSession} from '../../identity/application/session'
import {prepareSafePublicJpeg,preparePublication,sendPublication,listPublications,revokePublication} from '../application/public-card-publisher'
import type {PreparedSafePublicJpeg} from '../application/public-card-publisher'
const props=defineProps<{sourceKind:'photo'|'media';sourceId:string;source:Blob;name:string;expiresAt:number}>()
const emit=defineEmits<{close:[]}>()
const prepared=ref<PreparedSafePublicJpeg|null>(null),image=ref(''),loaded=ref(false)
const reviewed=ref(false),allowDownload=ref(false),description=ref(''),hours=ref(1),publicName=ref('Фотография')
const busy=ref(false),error=ref(''),link=ref(''),notice=ref('')
const dialog=ref<HTMLElement|null>(null)
const opener=typeof document==='undefined'?null:document.activeElement as HTMLElement|null
const rows=ref<Awaited<ReturnType<typeof listPublications>>>([])
let generation=0
function reset():void{generation++;if(image.value)URL.revokeObjectURL(image.value);image.value='';prepared.value=null;loaded.value=false;reviewed.value=false;link.value='';description.value=''}
async function refresh():Promise<void>{rows.value=await listPublications(props.sourceKind,props.sourceId)}
onMounted(async()=>{
  dialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
  const epoch=generation,session=activeSession.value;busy.value=true
  try{
    // Legacy Photo/v1 decrypts return an untyped Blob; Viewer has already
    // authenticated it as JPEG. Decode and marker validation remain mandatory.
    const safe=await prepareSafePublicJpeg(new Blob([props.source],{type:'image/jpeg'}))
    const latest=activeSession.value
    if(epoch!==generation||!session||!latest||latest.accountId!==session.accountId||latest.deviceId!==session.deviceId||latest.pkg.akek!==session.pkg.akek)return
    prepared.value=safe;image.value=URL.createObjectURL(safe.blob);await refresh().catch(()=>{notice.value='Список существующих публикаций не подтверждён. Проверьте связь.'})
  }catch{if(epoch===generation)error.value='Не удалось подготовить безопасную JPEG-копию. Оригинал не опубликован.'}
  finally{if(epoch===generation)busy.value=false}
})
async function publish():Promise<void>{
  const safe=prepared.value;if(!safe||!loaded.value||!reviewed.value||busy.value)return
  const epoch=generation;busy.value=true;error.value='';link.value=''
  try{
    const id=await preparePublication({sourceKind:props.sourceKind,sourceId:props.sourceId,prepared:safe,name:publicName.value,description:description.value,expiresAt:Math.min(Date.now()+hours.value*3600000,props.expiresAt),allowDownload:allowDownload.value,reviewedSha256:safe.sha256})
    if(epoch!==generation)return
    await refresh()
    const url=await sendPublication(id)
    if(epoch!==generation)return
    link.value=url;notice.value='Публикация подтверждена сервером. Оригинал и ключи аккаунта не переданы.';await refresh()
  }catch{if(epoch===generation){error.value='Публикация не подтверждена. Зашифрованный черновик сохранён, если подготовка завершилась. Повторите отправку ниже.';await refresh().catch(()=>{})}}
  finally{if(epoch===generation)busy.value=false}
}
async function retry(id:string):Promise<void>{
  if(busy.value)return;const epoch=generation;busy.value=true;error.value=''
  try{const value=await sendPublication(id);if(epoch!==generation)return;link.value=value;await refresh()}
  catch{if(epoch===generation)error.value='Сервер не подтвердил публикацию. Черновик сохранён.'}
  finally{if(epoch===generation)busy.value=false}
}
async function revoke(id:string):Promise<void>{
  if(busy.value)return;const epoch=generation;busy.value=true;error.value=''
  try{await revokePublication(id);if(epoch!==generation)return;link.value='';notice.value='Ссылка отозвана сервером. Уже сохранённую посетителем копию отозвать невозможно.';await refresh()}
  catch{if(epoch===generation)error.value='Отзыв не подтверждён. Ссылка может оставаться доступной; повторите попытку.'}
  finally{if(epoch===generation)busy.value=false}
}
function trapFocus(event:KeyboardEvent):void{
  if(event.key!=='Tab'||!dialog.value)return
  const controls=Array.from(dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')).filter(x=>x.getClientRects().length)
  const first=controls[0],last=controls.at(-1)
  if(!first||!last)return
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
watch(activeSession,(next,old)=>{if(next?.accountId!==old?.accountId||next?.deviceId!==old?.deviceId||next?.pkg.akek!==old?.pkg.akek||next?.pkg.accountSpki!==old?.pkg.accountSpki){reset();emit('close')}})
onUnmounted(()=>{reset();if(opener?.isConnected)opener.focus()})
</script>
<template>
  <div class="publication-backdrop" @click.self="emit('close')">
  <section ref="dialog" class="publication" role="dialog" aria-modal="true" aria-labelledby="publish-title" data-testid="public-card-publication" @keydown="trapFocus" @keydown.esc="emit('close')">
    <div class="publication-handle" aria-hidden="true"></div>
    <header><h2 id="publish-title">Публичная карточка</h2><button type="button" aria-label="Закрыть публикацию" @click="emit('close')">✕</button></header>
    <div class="publication-content">
    <p class="publication-note">Ссылка откроется без регистрации. Проверьте JPEG: видимые лица, текст и координаты внутри изображения не удаляются автоматически. EXIF, GPS и другие приватные поля не публикуются. Публикация доступна только для ваших личных фото.</p>
    <img v-if="image" :src="image" alt="Безопасная JPEG-копия для публикации" @load="loaded=true" @error="loaded=false;reviewed=false">
    <label>Название карточки <input v-model="publicName" maxlength="160" :disabled="busy" :placeholder="props.name"></label>
    <label>Публичное описание <textarea v-model="description" maxlength="2000" :disabled="busy"/></label>
    <label>Срок ссылки <select v-model.number="hours" :disabled="busy"><option :value="1">1 час</option><option :value="24">24 часа</option></select></label>
    <label><input v-model="allowDownload" type="checkbox" :disabled="busy">Разрешить скачивание безопасной копии</label>
    <label><input v-model="reviewed" type="checkbox" :disabled="!loaded||busy" data-testid="public-card-publish-review">Я просмотрел(а) именно эту копию и разрешаю её внешний просмотр по ссылке</label>
    <button type="button" :disabled="!reviewed||!loaded||busy" class="primary-action" data-testid="public-card-publish" @click="publish">Опубликовать безопасную копию</button>
    <p v-if="busy" role="status">Проверяем и сохраняем…</p><p v-if="error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
    <label v-if="link">Ссылка <input :value="link" readonly data-testid="public-card-published-url" @focus="($event.target as HTMLInputElement).select()"></label>
    <ul><li v-for="row in rows" :key="row.id">{{row.id.slice(0,8)}} · {{row.state}}
      <button v-if="row.state!=='revoked'" type="button" :disabled="busy" @click="retry(row.id)">{{row.state==='queued'?'Повторить отправку':'Показать ссылку'}}</button>
      <button v-if="row.state!=='revoked'" type="button" :disabled="busy" :data-testid="'public-card-revoke-'+row.id" @click="revoke(row.id)">Отозвать ссылку</button>
    </li></ul>
    </div>
  </section>
  </div>
</template>
<style scoped>
/* Approved Viewer bottom-sheet chrome. Publication consent remains real. */
.publication-backdrop{position:fixed;inset:0;z-index:100;background:#000b;display:flex;align-items:flex-end}
.publication{position:relative;width:100%;max-height:86dvh;overflow-y:auto;padding:9px 17px 25px;border:0;border-radius:13px 13px 0 0;background:#292929;color:#f2f2f2;font:16px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:normal}
.publication-handle{width:35px;height:4px;margin:0 auto 14px;border-radius:6px;background:#696969}
.publication header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:15px}
.publication h2{color:#fff;font-size:16px;font-weight:750;margin:0}
.publication header button{font:inherit;min-height:0;padding:6px;border:0;background:transparent;color:#eee}
.publication-content{display:grid;gap:10px}
.publication p{margin:0;font-size:12px;line-height:1.6}
.publication .publication-note{padding:13px;border-radius:7px;background:#383838;color:#e5e5e5}
.publication img{max-height:35dvh;object-fit:contain;width:100%;background:#111;border-radius:7px}
.publication label{display:grid;gap:6px;color:#ccc;font-size:12px}
.publication input:not([type=checkbox]),.publication textarea,.publication select{width:100%;min-width:0;padding:11px;background:#1d1d1d;border:1px solid #575757;border-radius:6px;color:#f3f3f3;font:13px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.publication textarea{min-height:85px;resize:vertical}
.publication label:has(input[type=checkbox]){display:flex;align-items:flex-start;gap:12px}
.publication input[type=checkbox]{width:18px;height:18px;flex:0 0 18px;accent-color:#1ed760}
.publication-content button{padding:12px;border:0;border-radius:6px;text-align:left;background:#3b3b3b;color:#f1f1f1;font-size:12px}
.publication-content button.primary-action{background:#1ed760;color:#122115;text-align:center;font-weight:750}
.publication ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.publication li{font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
@media(min-width:700px){.publication{max-width:520px;margin:0 auto}}
</style>
