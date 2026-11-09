<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeSession, reauthenticate } from '../features/identity/application/session'
import {
  flushOutbox, listLocalPhotos, listCloudPhotos,
  readLocalPhoto, readCloudPhoto,
} from '../features/photo-sync/application/p1-photo'
import type { StoredPhoto, CloudPhoto } from '../features/photo-sync/application/p1-photo'

const local=ref<StoredPhoto[]>([])
const cloud=ref<CloudPhoto[]>([])
const cursor=ref<string|null>(null)
const selectedUrl=ref('')
const busy=ref(false)
const status=ref('')
const error=ref('')

function revokePreview():void {
  if(selectedUrl.value){URL.revokeObjectURL(selectedUrl.value);selectedUrl.value=''}
}
async function refresh():Promise<void> {
  const s=activeSession.value
  if(!s){local.value=[];cloud.value=[];return}
  local.value=await listLocalPhotos()
  if(s.online){
    try{
      const list=await listCloudPhotos()
      cloud.value=list.items;cursor.value=list.nextCursor
    }catch{status.value='Не удалось получить список из облака'}
  }
}
async function sync():Promise<void> {
  busy.value=true;error.value=''
  try{
    if(!activeSession.value?.online)await reauthenticate()
    await flushOutbox()
    await refresh()
    status.value='Состояние синхронизации обновлено'
  }catch(e){error.value=e instanceof Error?e.message:'sync.unavailable'}
  finally{busy.value=false}
}
async function openLocal(photoId:string):Promise<void> {
  error.value=''
  try{revokePreview();selectedUrl.value=URL.createObjectURL(await readLocalPhoto(photoId))}
  catch(e){error.value=e instanceof Error?e.message:'photo.unavailable'}
}
async function openCloud(photoId:string):Promise<void> {
  error.value=''
  try{revokePreview();selectedUrl.value=URL.createObjectURL(await readCloudPhoto(photoId))}
  catch(e){error.value=e instanceof Error?e.message:'photo.unavailable'}
}
async function loadMore():Promise<void> {
  if(!cursor.value||busy.value)return
  busy.value=true
  try{
    const page=await listCloudPhotos(cursor.value)
    cloud.value.push(...page.items);cursor.value=page.nextCursor
  }catch(e){error.value=e instanceof Error?e.message:'photo.list_failed'}
  finally{busy.value=false}
}
watch(activeSession,()=>{revokePreview();void refresh()})
onMounted(()=>{void refresh()})
onUnmounted(revokePreview)
</script>

<template>
  <section class="foundation-content">
    <h1>Browser</h1>
    <p class="subtitle">P1 · зашифрованные личные фотографии</p>
    <div v-if="!activeSession" class="foundation-card">
      <p>Список файлов доступен после входа.</p>
      <RouterLink to="/settings">Открыть доступ</RouterLink>
    </div>
    <template v-else>
      <div class="action-row">
        <button type="button" :disabled="busy" @click="refresh">Обновить</button>
        <button type="button" :disabled="busy" @click="sync">Синхронизировать</button>
        <RouterLink to="/camera">Камера</RouterLink>
      </div>
      <div class="foundation-card">
        <h2>На этом устройстве</h2>
        <p v-if="!local.length" class="muted">Пока нет локально зашифрованных снимков.</p>
        <div v-for="p in local" :key="p.key" class="photo-row">
          <div><strong>{{ p.photoId.slice(0,8) }}</strong><small>{{ p.state }} · {{ new Date(p.createdAt).toLocaleString() }}</small><small v-if="p.lastError" class="muted">Синхронизация: {{ p.lastError }}</small></div>
          <button type="button" @click="openLocal(p.photoId)">Открыть</button>
        </div>
      </div>
      <div class="foundation-card">
        <h2>Подтверждено в облаке</h2>
        <p v-if="!activeSession.online" class="muted">Нет подтверждённой серверной сессии.</p>
        <p v-else-if="!cloud.length" class="muted">Файлов нет либо список ещё не загружен.</p>
        <div v-for="p in cloud" :key="p.photoId" class="photo-row">
          <div><strong>{{ p.photoId.slice(0,8) }}</strong><small>Хранение до {{ new Date(p.expiresAt).toLocaleDateString() }}</small></div>
          <button type="button" @click="openCloud(p.photoId)">Проверить из облака</button>
        </div>
        <button v-if="cursor" type="button" :disabled="busy" @click="loadMore">Ещё</button>
      </div>
      <div v-if="selectedUrl" class="foundation-card">
        <h2>Расшифровано на устройстве</h2>
        <img :src="selectedUrl" class="decrypted-preview" alt="Личный снимок"/>
        <button type="button" @click="revokePreview">Закрыть</button>
      </div>
    </template>
    <p v-if="status" role="status" class="status-text">{{ status }}</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
  </section>
</template>
