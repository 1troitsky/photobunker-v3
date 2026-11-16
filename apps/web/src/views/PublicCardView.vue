<script setup lang="ts">
import {computed,onUnmounted,ref,watch} from 'vue'
import {RouterLink,useRoute} from 'vue-router'
import {brand} from '../config/brand'
import {readPublicCard} from '../features/media/application/public-card-crypto'
const route=useRoute(),image=ref(''),name=ref(''),description=ref(''),expiresAt=ref(0),allowDownload=ref(false),loading=ref(false),notice=ref('')
const publicUrl=computed(()=>location.origin+route.fullPath)
const zoomed=ref(false),days=computed(()=>Math.max(0,Math.ceil((expiresAt.value-Date.now())/86400000)))
let generation=0,controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|null=null
function clear():void{if(image.value)URL.revokeObjectURL(image.value);image.value='';name.value='';description.value='';expiresAt.value=0;allowDownload.value=false;zoomed.value=false}
async function load():Promise<void>{
  const epoch=++generation;controller?.abort();controller=new AbortController();if(timer)clearTimeout(timer);loading.value=true
  try{
    const result=await readPublicCard(String(route.params.token??''),route.hash.slice(1),controller.signal)
    if(epoch!==generation)return
    clear();image.value=URL.createObjectURL(result.image);name.value=result.payload.name;description.value=result.payload.description;expiresAt.value=result.contract.expiresAt;allowDownload.value=result.contract.allowDownload
    timer=setTimeout(()=>{clear();void load()},Math.max(1,Math.min(15000,expiresAt.value-Date.now())))
  }catch{if(epoch===generation)clear()}
  finally{if(epoch===generation)loading.value=false}
}
async function copy():Promise<void>{try{await navigator.clipboard.writeText(location.href);notice.value='Ссылка скопирована'}catch{notice.value='Скопируйте ссылку из адресной строки'}}
async function share():Promise<void>{if(navigator.share){try{await navigator.share({url:location.href,title:name.value})}catch{}}else await copy()}
function download():void{if(!image.value||!allowDownload.value||expiresAt.value<=Date.now())return;const a=document.createElement('a');a.href=image.value;a.download='safe-photo.jpg';a.rel='noopener';a.click()}
watch(()=>route.fullPath,()=>{clear();void load()},{immediate:true})
onUnmounted(()=>{generation++;controller?.abort();if(timer)clearTimeout(timer);clear()})
</script>

<template>
<div class="public-page" :data-testid="image?'public-card-live':'public-card-unavailable'">
  <header class="site-head"><RouterLink class="site-logo" to="/welcome" :aria-label="brand.name+' — главная'"><span class="site-logo-mark" aria-hidden="true"><img :src="brand.iconUrl" alt=""></span><strong>{{brand.name}}</strong></RouterLink><RouterLink to="/install" class="install-link" data-testid="public-card-install"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2-4.5-4.4 6.2-.9Z"/><path d="m9.2 12 2 2 3.6-3.6"/></svg> Установить приложение</RouterLink></header>
  <main class="page">
    <p v-if="loading&&!image" role="status">Загружаем карточку…</p>
    <template v-else>
      <div class="card-title"><div class="name-wrap"><h1 class="file-name">{{image?name:'Карточка недоступна'}}</h1><p v-if="image" class="file-id">#<b>{{String(route.params.token).slice(0,8)}}</b></p></div><nav class="file-actions" aria-label="Действия с публичной карточкой"><button class="icon-button" type="button" :disabled="!image" aria-label="Копировать ссылку" @click="copy"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button><button class="icon-button" type="button" :disabled="!image||!allowDownload" aria-label="Скачать безопасную копию" @click="download"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/></svg></button><button class="icon-button" type="button" :disabled="!image" aria-label="Поделиться ссылкой" @click="share"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7"/></svg></button></nav></div>
      <div v-if="image" class="media" :class="{zoomed}"><img :src="image" :alt="name" class="safe-media" data-testid="public-card-image"><button type="button" aria-label="Изменить масштаб фото" :aria-pressed="zoomed" @click="zoomed=!zoomed"></button></div>
      <section v-else class="expired-stage"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4 20 20M12 3a9 9 0 1 1-9 9"/></svg><h2>Доступ закрыт</h2><p>Ссылка не найдена, срок действия истёк или доступ к файлу закрыт.</p></section>
      <div class="info">
        <section v-if="image&&description" class="info-section"><h2 class="section-label">Описание</h2><p class="description">{{description}}</p></section>
        <section class="info-section"><div class="availability"><div class="time-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div><div><div class="time-title">{{image?'Карточка действует до '+new Date(expiresAt).toLocaleDateString('ru-RU'):'Карточка недоступна'}}</div><div class="time-caption">{{image?'Публичный доступ завершится не позднее этой даты':'Ссылка не найдена, истекла или отозвана'}}</div></div><span class="time-pill" :class="{expired:!image}">{{image?days+' дн.':'Недоступна'}}</span></div></section>
        <section v-if="image" class="info-section"><h2 class="section-label">Ссылка на карточку</h2><div class="share-row"><span class="share-url">{{publicUrl}}</span><button type="button" class="share-copy" aria-label="Скопировать адрес карточки" @click="copy"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button></div></section>
      </div>
    </template>
    <footer class="bottom-brand">Опубликовано через <RouterLink to="/install">{{brand.name}}</RouterLink><span class="copyright">© {{new Date().getFullYear()}} {{brand.name}}</span></footer>
    <p v-if="notice" role="status">{{notice}}</p>
  </main>
</div>
</template>
<style scoped src="../features/media/ui/PublicCardFieldwork.css"></style>
