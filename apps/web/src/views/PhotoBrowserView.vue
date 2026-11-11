<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {RouterLink} from 'vue-router'
import SharePanel from '../features/sharing/SharePanel.vue'
import MediaImportPanel from '../features/media/ui/MediaImportPanel.vue'
import {activeSession,reauthenticate} from '../features/identity/application/session'
import {
  flushOutbox,listLocalPhotos,listCloudPhotos,
  readLocalPhoto,readCloudPhoto,readLocalPhotoMetadata,readCloudPhotoMetadata,
} from '../features/photo-sync/application/p1-photo'
import type {StoredPhoto,CloudPhoto} from '../features/photo-sync/application/p1-photo'
import {
  listLocalMedia,listCloudMedia,readLocalMedia,readCloudMedia,
} from '../features/media/application/media-outbox'
import type {StoredMedia,CloudMedia} from '../features/media/application/media-outbox'
import {buildCatalog,filterCatalog} from '../features/browser/application/catalog'
import type {CatalogFilter,CatalogSort,CatalogView,CatalogItem} from '../features/browser/application/catalog'

const localPhotos=ref<StoredPhoto[]>([])
const cloudPhotos=ref<CloudPhoto[]>([])
const localMedia=ref<StoredMedia[]>([])
const cloudMedia=ref<CloudMedia[]>([])
const photoCursor=ref<string|null>(null)
const mediaCursor=ref<string|null>(null)
const filter=ref<CatalogFilter>('all')
const sort=ref<CatalogSort>('newest')
const view=ref<CatalogView>('list')
const search=ref('')
const busy=ref(false)
const previewBusy=ref(false)
const status=ref('')
const error=ref('')
const selectedUrl=ref('')
const selectedType=ref<CatalogItem['type']|null>(null)
const selectedName=ref('')
const selectedDescription=ref('')
const selectedCategory=ref('')
const selectedTags=ref<string[]>([])
const selectedGps=ref<{latitude:number;longitude:number;accuracyMeters:number}|null>(null)
const selectedCaptured=ref<number|null>(null)
const selectedExpiry=ref<number|null>(null)
let generation=0
let previewGeneration=0

const items=computed(()=>buildCatalog(
  localPhotos.value,cloudPhotos.value,localMedia.value,cloudMedia.value,
))
const visible=computed(()=>filterCatalog(items.value,{
  type:filter.value,query:search.value,sort:sort.value,
}))
const pendingCount=computed(()=>items.value.filter(x=>x.local
  &&x.state!=='synced').length)

function revokePreview():void{
  ++previewGeneration
  if(selectedUrl.value)URL.revokeObjectURL(selectedUrl.value)
  selectedUrl.value=''
  selectedType.value=null
  selectedName.value=''
  selectedDescription.value=''
  selectedCategory.value=''
  selectedTags.value=[]
  selectedGps.value=null
  selectedCaptured.value=null
  selectedExpiry.value=null
}
function clearCatalog():void{
  localPhotos.value=[];localMedia.value=[]
  cloudPhotos.value=[];cloudMedia.value=[]
  photoCursor.value=null;mediaCursor.value=null
}
function reason(e:unknown):string{
  return e instanceof Error?e.message:'browser.unavailable'
}

async function refresh():Promise<void>{
  const identity=activeSession.value,token=++generation
  clearCatalog();error.value='';status.value=''
  if(!identity)return
  busy.value=true
  try{
    const [photos,media]=await Promise.all([listLocalPhotos(),listLocalMedia()])
    if(identity!==activeSession.value||token!==generation)return
    localPhotos.value=photos;localMedia.value=media
    if(!identity.online||(typeof navigator!=='undefined'&&navigator.onLine===false)){
      status.value='Офлайн: показаны только зашифрованные файлы этого устройства.'
      return
    }
    // Independent server endpoints: failure of one catalog cannot erase the
    // other. A cloud row is visible only after an authenticated server read.
    const [cloudP,cloudM]=await Promise.allSettled([
      listCloudPhotos(),listCloudMedia(),
    ])
    if(identity!==activeSession.value||token!==generation)return
    if(cloudP.status==='fulfilled'){
      cloudPhotos.value=cloudP.value.items
      photoCursor.value=cloudP.value.nextCursor
    }
    if(cloudM.status==='fulfilled'){
      cloudMedia.value=cloudM.value.items
      mediaCursor.value=cloudM.value.nextCursor
    }
    if(cloudP.status==='rejected'||cloudM.status==='rejected')
      status.value='Не все облачные списки доступны. Локальные файлы сохранены.'
  }catch(e){
    if(identity===activeSession.value&&token===generation)error.value=reason(e)
  }finally{
    if(token===generation)busy.value=false
  }
}
async function more():Promise<void>{
  const identity=activeSession.value
  if(!identity?.online||busy.value||(!photoCursor.value&&!mediaCursor.value))return
  const token=generation
  const previousPhotos=photoCursor.value,previousMedia=mediaCursor.value
  busy.value=true;error.value=''
  const [photos,media]=await Promise.allSettled([
    previousPhotos?listCloudPhotos(previousPhotos):Promise.resolve(null),
    previousMedia?listCloudMedia(previousMedia):Promise.resolve(null),
  ])
  if(identity===activeSession.value&&token===generation){
    if(photos.status==='fulfilled'&&photos.value){
      cloudPhotos.value=[...cloudPhotos.value,...photos.value.items]
      photoCursor.value=photos.value.nextCursor
    }
    if(media.status==='fulfilled'&&media.value){
      cloudMedia.value=[...cloudMedia.value,...media.value.items]
      mediaCursor.value=media.value.nextCursor
    }
    if(photos.status==='rejected'||media.status==='rejected')
      error.value='Не удалось загрузить часть облачного каталога.'
    busy.value=false
  }
}
async function sync():Promise<void>{
  if(busy.value)return
  busy.value=true;error.value='';status.value=''
  try{
    if(!activeSession.value?.online)await reauthenticate()
    await flushOutbox()
    await refresh()
    status.value='Очередь фотографий проверена. Импортированное медиа синхронизируется в блоке импорта.'
  }catch(e){error.value=reason(e)}
  finally{busy.value=false}
}
async function openItem(item:CatalogItem):Promise<void>{
  const identity=activeSession.value,token=++previewGeneration
  if(!identity)return
  previewBusy.value=true;error.value=''
  try{
    let blob:Blob,name='',description='',category=''
    let tags:string[]=[]
    let gps:{latitude:number;longitude:number;accuracyMeters:number}|null=null
    let captured:number|null=null
    if(item.source==='photo'){
      const [photo,metadata]=await Promise.all([
        item.local?readLocalPhoto(item.id):readCloudPhoto(item.id),
        item.local?readLocalPhotoMetadata(item.id):readCloudPhotoMetadata(item.id),
      ])
      blob=photo
      name=item.id.slice(0,8)
      description=metadata.description??''
      category=metadata.category??''
      tags=metadata.tags??[]
      gps=metadata.gps??null
      captured=metadata.capturedAt
    }else{
      const result=item.local
        ?await readLocalMedia(item.id):await readCloudMedia(item.id)
      blob=result.blob
      name=result.metadata.fileName
      description=result.metadata.description??''
      category=result.metadata.category??''
      tags=result.metadata.tags??[]
      gps=result.metadata.gps??null
      captured=result.metadata.createdAt
    }
    if(identity!==activeSession.value||token!==previewGeneration)return
    revokePreview()
    selectedUrl.value=URL.createObjectURL(blob)
    selectedType.value=item.type
    selectedName.value=name
    selectedDescription.value=description
    selectedCategory.value=category
    selectedTags.value=tags
    selectedGps.value=gps
    selectedCaptured.value=captured
    selectedExpiry.value=item.expiresAt
  }catch(e){
    if(identity===activeSession.value&&token===previewGeneration)
      error.value=reason(e)
  }finally{
    if(identity===activeSession.value)previewBusy.value=false
  }
}
function showReceived(blob:Blob):void{
  revokePreview()
  selectedUrl.value=URL.createObjectURL(blob)
  selectedType.value='photo'
  selectedName.value='Полученный снимок'
}
watch(activeSession,()=>{
  ++generation
  revokePreview()
  clearCatalog()
  void refresh()
})
onMounted(()=>{void refresh()})
onUnmounted(()=>{++generation;revokePreview()})
</script>

<template>
  <section class="foundation-content browser-v3" data-testid="browser-v3">
    <div class="browser-title">
      <div>
        <h1>Browser</h1>
        <p class="subtitle">Файлы и локальная очередь · без ожидания облака</p>
      </div>
      <RouterLink to="/camera">Камера</RouterLink>
    </div>
    <div v-if="!activeSession" class="foundation-card">
      <p>Список файлов доступен после входа.</p>
      <RouterLink to="/settings">Открыть доступ</RouterLink>
    </div>
    <template v-else>
      <nav class="browser-filters" aria-label="Тип файла">
        <button v-for="tab in (['all','photo','video','audio'] as const)" :key="tab"
          type="button" :aria-pressed="filter===tab"
          :class="{selected:filter===tab}" :data-testid="'browser-filter-'+tab"
          @click="filter=tab">
          {{ tab==='all'?'Все':tab==='photo'?'Фото':tab==='video'?'Видео':'Аудио' }}
        </button>
      </nav>
      <div class="browser-toolbar">
        <label class="browser-search">
          <span class="browser-sr-only">Поиск по ID файла</span>
          <input v-model="search" type="search" autocomplete="off"
            placeholder="Поиск по ID файла" data-testid="browser-search">
        </label>
        <label>
          <span class="browser-sr-only">Сортировка</span>
          <select v-model="sort" data-testid="browser-sort">
            <option value="newest">Новые сначала</option>
            <option value="oldest">Старые сначала</option>
            <option value="expiry">Ближайшее удаление</option>
          </select>
        </label>
        <div class="browser-view-switch" aria-label="Вид каталога">
          <button type="button" :aria-pressed="view==='list'"
            @click="view='list'">Список</button>
          <button type="button" :aria-pressed="view==='grid'"
            @click="view='grid'">Сетка</button>
        </div>
        <button type="button" :disabled="busy" @click="refresh">Обновить</button>
      </div>
      <p class="muted" data-testid="browser-summary">
        {{ visible.length }} файлов в загруженном каталоге
        · {{ pendingCount }} локальных не подтверждены облаком
      </p>
      <p class="muted">Приватные имена, теги и GPS не входят в серверный индекс.
        Поиск пока работает по ID; метаданные открываются после локальной расшифровки.</p>
      <div :class="['browser-items',view==='grid'?'browser-grid':'browser-list']"
        data-testid="browser-catalog">
        <div v-for="item in visible" :key="item.key" class="browser-item"
          :data-testid="'browser-row-'+item.key">
          <div class="browser-item-kind" aria-hidden="true">
            {{ item.type==='photo'?'▧':item.type==='video'?'▷':'♫' }}
          </div>
          <div class="browser-item-detail">
            <strong>{{ item.id.slice(0,8) }}</strong>
            <small>{{ item.type==='photo'?'Фото':item.type==='video'?'Видео':'Аудио' }}
              · {{ item.local?'На устройстве':'Только в облаке' }}
              <template v-if="item.cloud"> · Подтверждено в облаке</template>
            </small>
            <small v-if="item.state&&item.state!=='synced'">
              Очередь: {{ item.state }}
            </small>
            <small>Хранение до {{ new Date(item.expiresAt).toLocaleDateString('ru-RU') }}</small>
          </div>
          <button type="button" :disabled="previewBusy||busy"
            :aria-label="'Открыть файл '+item.id"
            @click="openItem(item)">Открыть</button>
        </div>
      </div>
      <p v-if="!visible.length" class="muted">Нет файлов для выбранного фильтра.</p>
      <button v-if="photoCursor||mediaCursor" type="button"
        :disabled="busy" @click="more">Загрузить ещё</button>
      <div class="action-row">
        <button type="button" :disabled="busy" @click="sync">Синхронизировать фото</button>
      </div>
      <div v-if="selectedUrl" class="foundation-card browser-preview"
        data-testid="browser-preview">
        <h2>{{ selectedName }}</h2>
        <img v-if="selectedType==='photo'" :src="selectedUrl"
          alt="Личный снимок" class="decrypted-preview">
        <video v-else-if="selectedType==='video'" :src="selectedUrl"
          controls playsinline preload="metadata" class="decrypted-preview"/>
        <audio v-else-if="selectedType==='audio'" :src="selectedUrl"
          controls preload="metadata"/>
        <p v-if="selectedDescription">{{ selectedDescription }}</p>
        <p v-if="selectedCaptured">Дата: {{ new Date(selectedCaptured).toLocaleString('ru-RU') }}</p>
        <p v-if="selectedCategory">Категория: {{ selectedCategory }}</p>
        <p v-if="selectedTags.length">Теги: {{ selectedTags.join(', ') }}</p>
        <p v-if="selectedGps">GPS: {{ selectedGps.latitude }}, {{ selectedGps.longitude }} · точность ±{{ Math.round(selectedGps.accuracyMeters) }} м</p>
        <p v-if="selectedExpiry">Хранение до {{ new Date(selectedExpiry).toLocaleDateString('ru-RU') }}</p>
        <p class="muted">Файл расшифрован на этом устройстве. Экспорт в системную галерею не выполнялся.</p>
        <button type="button" @click="revokePreview">Закрыть просмотр</button>
      </div>
      <section class="browser-operations">
        <h2>Импорт и операции</h2>
        <p class="muted">Загрузка, выдача доступа и версии используют действующий защищённый pipeline.</p>
        <MediaImportPanel @catalog-change="refresh"/>
        <SharePanel :local-photos="localPhotos" @open-photo="showReceived"/>
      </section>
    </template>
    <p v-if="status" role="status" class="status-text">{{ status }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
