<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {activeSession} from '../../identity/application/session'
import {
  attachMediaRevisionLifecycle,fetchVerifiedMediaHistory,
  flushMediaRevisionOutbox,listMediaRevisionOperations,
  queueMediaRevision,
} from '../application/media-revisions'
import type {MediaRevisionHistory,MediaRevisionOperation} from '../application/media-revisions'
import type {StoredMedia} from '../application/media-outbox'
const props=defineProps<{localMedia:StoredMedia[]}>()
const rootId=ref('')
const newId=ref('')
const history=ref<MediaRevisionHistory|null>(null)
const versions=ref<Array<{revision:number;mediaId:string;contractHash:string}>>([])
const operations=ref<MediaRevisionOperation[]>([])
const busy=ref(false)
const error=ref('')
const status=ref('')
let detach:()=>void=()=>{}
const available=computed(()=>props.localMedia.filter(x=>
  x.state==='synced'&&x.expiresAt>Date.now()))
const candidateVersions=computed(()=>{
  const root=available.value.find(x=>x.mediaId===rootId.value)
  if(!root)return []
  return available.value.filter(x=>
    x.mediaType===root.mediaType
    &&x.mediaId!==rootId.value
    &&!versions.value.some(v=>v.mediaId===x.mediaId))
})
async function action(fn:()=>Promise<void>):Promise<void>{
  if(busy.value)return
  busy.value=true;error.value='';status.value=''
  try{await fn()}
  catch(e){error.value=e instanceof Error?e.message:'media_revision.failed'}
  finally{busy.value=false}
}
async function readHistory():Promise<void>{
  if(!rootId.value)throw Error('media_revision.select_original')
  const result=await fetchVerifiedMediaHistory(rootId.value)
  history.value=result.history;versions.value=result.versions
  operations.value=await listMediaRevisionOperations()
}
function refresh():void{
  void action(async()=>{await readHistory()})
}
function create():void{
  void action(async()=>{
    if(!newId.value||!candidateVersions.value.some(x=>x.mediaId===newId.value))
      throw Error('media_revision.select_new_version')
    const id=await queueMediaRevision(rootId.value,newId.value)
    operations.value=await listMediaRevisionOperations()
    await flushMediaRevisionOutbox()
    operations.value=await listMediaRevisionOperations()
    // An offline locally signed operation is not yet a server revision.
    if(activeSession.value?.online&&navigator.onLine){
      await readHistory()
    }
    status.value='Подписанная связь сохранена в очереди: '+id.slice(0,8)
    newId.value=''
  })
}
watch(activeSession,()=>{
  rootId.value='';newId.value=''
  history.value=null;versions.value=[];operations.value=[]
})
watch(rootId,()=>{
  history.value=null;versions.value=[];newId.value=''
})
onMounted(()=>{detach=attachMediaRevisionLifecycle()})
onUnmounted(()=>detach())
</script>
<template>
  <section class="media-revisions" data-testid="media-revision-panel">
    <h3>Версии зашифрованных файлов · P1</h3>
    <p class="muted">
      Каждая версия — самостоятельный файл с отдельным ключом и сроком
      хранения. История подписывается владельцем; прежняя версия не
      изменяется и её разрешения не переходят на новую автоматически.
    </p>
    <label for="media-version-root">Оригинал</label>
    <select id="media-version-root" v-model="rootId" data-testid="media-version-root">
      <option value="">Выберите исходный файл</option>
      <option v-for="file in available" :key="file.mediaId"
        :value="file.mediaId">{{ file.mediaType }} · {{ file.mediaId.slice(0,8) }}</option>
    </select>
    <button type="button" :disabled="busy||!rootId"
      @click="refresh">Проверить историю версий</button>
    <template v-if="history">
      <p class="muted" data-testid="media-revision-count">
        Версий: <strong>{{ history.revision }}</strong>
      </p>
      <div v-for="v in versions" :key="v.mediaId" class="photo-row">
        <span><strong>Версия {{ v.revision }}</strong></span>
        <code>{{ v.mediaId.slice(0,8) }}</code>
      </div>
      <label for="media-version-next">Новая версия (уже синхронизированная)</label>
      <select id="media-version-next" v-model="newId" data-testid="media-version-next">
        <option value="">Выберите файл той же категории</option>
        <option v-for="file in candidateVersions" :key="file.mediaId"
          :value="file.mediaId">{{ file.mediaType }} · {{ file.mediaId.slice(0,8) }}</option>
      </select>
      <button type="button" :disabled="busy||!newId"
        @click="create">Связать как новую версию</button>
    </template>
    <h4>Очередь подписанных изменений</h4>
    <div v-for="op in operations.filter(x=>x.rootMediaId===rootId)"
      :key="op.id" class="photo-row">
      <code>{{ op.id.slice(0,8) }}</code>
      <small>{{ op.state }}<template v-if="op.lastError"> · {{ op.lastError }}</template></small>
    </div>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
<style scoped>
.media-revisions{margin-top:18px}
.media-revisions select{display:block;max-width:100%;margin:6px 0 10px}
</style>
