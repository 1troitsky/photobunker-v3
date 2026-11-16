<script setup lang="ts">
import {computed,onUnmounted,ref,watch} from 'vue'
import {RouterLink,useRoute} from 'vue-router'
import {brand} from '../config/brand'
import {readPublicCard} from '../features/media/application/public-card-crypto'
const route=useRoute(),image=ref(''),name=ref(''),description=ref(''),expiresAt=ref(0),allowDownload=ref(false),loading=ref(false),notice=ref('')
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
<div class="public-card-denied" :data-testid="image?'public-card-live':'public-card-unavailable'">
  <header class="site-head"><RouterLink class="site-logo" to="/welcome" :aria-label="brand.name+' — главная'"><span class="site-logo-mark" aria-hidden="true"><img :src="brand.iconUrl" alt=""></span><strong>{{brand.name}}</strong></RouterLink><RouterLink to="/install" class="install-link" data-testid="public-card-install">☆ Установить приложение</RouterLink></header>
  <main class="card-shell">
    <p v-if="loading&&!image" role="status">Загружаем карточку…</p>
    <article v-else-if="image" class="live-card">
      <header class="card-title"><div><h1>{{name}}</h1><span>#{{String(route.params.token).slice(0,8)}}</span></div><nav aria-label="Действия с публичной карточкой"><button type="button" aria-label="Копировать ссылку" @click="copy">C</button><button v-if="allowDownload" type="button" aria-label="Скачать безопасную копию" @click="download">D</button><button type="button" aria-label="Поделиться ссылкой" @click="share">S</button></nav></header>
      <button type="button" class="public-photo" :class="{zoomed}" aria-label="Изменить масштаб фото" :aria-pressed="zoomed" @click="zoomed=!zoomed"><img :src="image" :alt="name" data-testid="public-card-image"></button>
      <p v-if="description" class="card-description">{{description}}</p><p>Карточка доступна до {{new Date(expiresAt).toLocaleString('ru-RU')}} · осталось {{days}} дн.</p>
      <label>Ссылка на карточку <input :value="'Откройте адресную строку или нажмите C'" readonly @click="copy"></label><p v-if="notice" role="status">{{notice}}</p>
    </article>
    <section v-else class="expired-stage" aria-labelledby="public-unavailable-title"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="14"/><path d="M18 10v9l6 4"/></svg><h1 id="public-unavailable-title">Карточка недоступна</h1><p>Ссылка не найдена, срок действия истёк или доступ к файлу закрыт.</p><p>Никакие данные файла по этой ссылке не раскрываются.</p></section>
  </main>
  <footer class="site-footer"><span>Опубликовано через {{brand.name}}</span><RouterLink to="/install">Установка {{brand.name}}</RouterLink><span>© {{new Date().getFullYear()}} {{brand.name}}</span></footer>
</div>
</template>
<style scoped>
/* Expired/denied state geometry from approved docs/ux/public-card/style.css. */
.expired-stage{min-height:295px;border:1px solid #404040;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;padding:24px;background:#1c1c1c}.expired-stage svg{width:35px;height:35px;stroke:#c3c3c3;fill:none;stroke-width:1.4}.expired-stage h2{font-size:17px;margin:0}.expired-stage p{color:#b0b0b0;margin:0;max-width:280px;font-size:12px}.app-explain{max-width:525px;margin:auto;min-height:calc(100% - 68px);padding:34px 20px 40px;display:flex;align-items:center;flex-direction:column;justify-content:center;text-align:center}.app-icon{width:78px;height:78px;border-radius:20px;border:1px solid #415a46;background:linear-gradient(140deg,#2b4234,#1d261f);display:grid;place-items:center;margin-bottom:22px}.app-icon svg{height:49px;width:49px}.app-explain h1{font-size:27px;line-height:1.2;letter-spacing:-.06em;margin:0 0 12px}.app-explain>p{max-width:360px;color:#b9b9b9;font-size:13px;margin:0 0 26px}.install-choices{display:flex;gap:7px;background:#272727;padding:4px;border-radius:8px;margin-bottom:16px;flex-wrap:wrap}.install-choices button{background:none;color:#aaa;border:0;border-radius:6px;padding:8px 11px;font-size:11px}.install-choices button.selected{color:#f0f0f0;background:#494949}.install-guide{width:100%;text-align:left;background:#202020;padding:19px 21px;border-radius:10px}.install-guide h2{margin:0 0 13px;font-size:14px}.install-guide ol{margin:0;padding-left:18px;color:#d4d4d4;font-size:12px;line-height:1.8}.install-guide li+li{margin-top:6px}.install-guide p{font-size:11px;color:#9c9c9c;margin:11px 0 0}.back-to-file{margin:22px 0 0;border:0;background:transparent;text-decoration:underline;text-underline-offset:3px;color:#b9ebc5;padding:7px}

.public-card-denied{--green:#1ed760;--muted:#a3a3a3;background:#121212;color:#f2f2f2;
  min-height:100dvh;display:flex;flex-direction:column;font-size:13px}
.site-head{min-height:68px;padding:0 clamp(15px,3vw,34px);display:flex;align-items:center;
  justify-content:space-between;gap:10px;background:#181818;border-bottom:1px solid #292929}
.site-logo{display:flex;align-items:center;gap:10px;color:#f5f5f5;text-decoration:none}
.site-logo-mark{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;
  background:linear-gradient(135deg,#263a2c,#1b211d);border:1px solid #405043}
.site-logo-mark img{width:23px;height:23px;object-fit:contain}
.site-logo strong{font-weight:800;font-size:15px}
.install-link{white-space:nowrap;text-decoration:none;color:#bde9c7;font-size:11px;
  border:1px solid #367d4b;border-radius:8px;padding:9px 12px;background:#203a27}
.card-shell{width:min(100%,840px);margin:auto;padding:45px 15px}
.expired-stage{min-height:295px}
.expired-stage svg{width:35px;height:35px;fill:none}
.expired-stage h1{font-size:18px;margin:0}
.expired-stage p{color:#b0b0b0;font-size:12px;line-height:1.6;max-width:380px;margin:0}
.site-footer{display:flex;justify-content:center;gap:14px;align-items:center;flex-wrap:wrap;
  border-top:1px solid #303030;color:#9c9c9c;font-size:11px;padding:20px 14px}
.site-footer a{color:#a3d9b5;text-decoration:none}
.public-card-denied a:focus-visible{outline:2px solid #9beab2;outline-offset:2px}
@media(max-width:470px){.site-head{min-height:61px;padding:0 13px}
  .install-link{padding:8px;font-size:10px}.card-shell{padding:26px 13px}}
.live-card{display:grid;gap:18px}.card-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.card-title h1{font-size:21px;margin:0 0 6px}.card-title span{color:#aaa;font-size:12px}.card-title nav{display:flex;gap:8px}.card-title button{min-width:44px;min-height:44px;background:#202020;border:1px solid #444;border-radius:8px;color:#eee}.public-photo{width:100%;border:0;padding:0;background:#181818;overflow:auto;border-radius:10px}.public-photo img{display:block;width:100%;height:auto}.public-photo.zoomed img{width:auto;max-width:none}.card-description{white-space:pre-wrap;overflow-wrap:anywhere}.live-card p{line-height:1.6;color:#bbb}.live-card input{width:100%;min-height:44px;background:#202020;color:#ccc;border:1px solid #444;padding:8px;border-radius:8px}</style>