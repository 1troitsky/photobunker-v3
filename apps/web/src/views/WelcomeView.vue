<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { activeSession, beginRegistration, finishRegistration, restoreAccount, sessionBootstrapPending } from '../features/identity/application/session'
import { resolveStartRoute } from '../ui/fieldwork/appearance-preferences'
import { markInvalidRecoveryKey } from '../features/identity/application/authorization-failure'
import { brand } from '../config/brand'
import {getPending} from '../features/identity/infrastructure/storage'
import { saveRecoveryKeyWithSystemDialog } from '../ui/fieldwork/recovery-key-save'
const props=withDefaults(defineProps<{bootstrapOnly?:boolean}>(),{bootstrapOnly:false})
const route=useRoute(),router=useRouter()
type Feature={title:string;desc:string;caption:string;accent:string;art:string}
const features:readonly Feature[]=[
 {title:'Снимайте — не оставляя фото в галерее.',
  desc:`Фото из ${brand.name} не сохраняются в стандартную медиатеку. Работайте с материалами внутри защищённого пространства.`, 
  caption:`Кадр остаётся в ${brand.name}`,art:'gallery',accent:'#1ada62'}, 
 {title:'Сначала шифрование. Потом облако.',
  desc:`Модель ${brand.name} строится вокруг шифрования на устройстве и ключей под вашим контролем — не вокруг доверия к администратору сервера.`, 
  caption:'Client-side encryption',art:'crypto',accent:'#c2ef8a'},
 {title:'От съёмки до результата. В одном месте.',
  desc:'Соберите людей в команду, выдайте задание и получайте материалы сразу в нужном контексте — без хаоса в переписках.',
  caption:'Работа по заданиям',art:'teams',accent:'#f0c27c'},
 {title:'У каждого файла — свои правила.',
  desc:'Решайте, кто может работать с материалами и как долго они доступны. Срок хранения — часть задания, а не забытая настройка.',
  caption:'Доступ • Срок • Действие',art:'expiry',accent:'#f2a38b'},
 {title:'Без телефона. Без почты. Без лишних вопросов.',
  desc:'Аккаунт основан на ключе восстановления. Сохраните его в безопасном месте — он нужен, чтобы вернуть доступ.',
  caption:'Recovery Key',art:'anonymous',accent:'#a7eda4'},
 {title:'Когда секунды имеют значение.',
  desc:'Отдельный экстренный PIN предназначен для немедленной блокировки доступа и запуска очистки. Удаление из облака зависит от связи.',
  caption:'Emergency PIN',art:'emergency',accent:'#f19d8d'},
]
const slide=ref(0),busy=ref(false),generated=ref(''),acknowledged=ref(false)
const keyExportBusy=ref(false)
const pendingRegistration=ref(false),pendingChecking=ref(false)
const savedPendingKey=ref('')
let pendingCheckToken=0
const recovery=ref(''),error=ref(''),notice=ref('')
const isCreate=computed(()=>!props.bootstrapOnly&&route.path==='/welcome/create')
const isRecover=computed(()=>!props.bootstrapOnly&&route.path==='/welcome/recover')
const isHome=computed(()=>!isCreate.value&&!isRecover.value)
const current=computed(()=>features[slide.value]!)
// One 5.5 s timer, reset after every manual interaction. A running interval
// can otherwise advance a slide immediately after the user selects it.
let timer:ReturnType<typeof setTimeout>|null=null
let motion:MediaQueryList|null=null
const hoverPause=ref(false),focusPause=ref(false),touchPause=ref(false)
let touchX:number|null=null
function stopAutoplay():void{
  if(timer!==null)clearTimeout(timer)
  timer=null
}
function canAutoplay():boolean{
  return isHome.value&&!hoverPause.value&&!focusPause.value&&!touchPause.value
    &&!document.hidden&&!motion?.matches
}
function resetAutoplay():void{
  stopAutoplay()
  if(!canAutoplay())return
  timer=setTimeout(()=>{
    timer=null
    if(!canAutoplay())return
    slide.value=(slide.value+1)%features.length
    resetAutoplay()
  },5500)
}
function choose(i:number):void{
  slide.value=(i+features.length)%features.length
  resetAutoplay()
}
function onTouchStart(e:TouchEvent):void{
  touchX=e.changedTouches[0]?.clientX??null
  touchPause.value=true
  resetAutoplay()
}
function onTouchEnd(e:TouchEvent):void{
  const end=e.changedTouches[0]?.clientX??null
  if(touchX!==null&&end!==null&&Math.abs(end-touchX)>40)
    slide.value=(slide.value+(end<touchX?1:-1)+features.length)%features.length
  touchX=null
  touchPause.value=false
  resetAutoplay()
}
function onTouchCancel():void{
  touchX=null
  touchPause.value=false
  resetAutoplay()
}
function onCarouselFocusOut(e:FocusEvent):void{
  const root=e.currentTarget
  if(root instanceof HTMLElement
    &&e.relatedTarget instanceof Node&&root.contains(e.relatedTarget))return
  focusPause.value=false
  resetAutoplay()
}
function onCarouselMouseEnter():void{hoverPause.value=true;resetAutoplay()}
function onCarouselMouseLeave():void{hoverPause.value=false;resetAutoplay()}
function onCarouselFocusIn():void{focusPause.value=true;resetAutoplay()}
async function checkPendingRegistration():Promise<void>{
  const token=++pendingCheckToken
  pendingChecking.value=true
  try{
    const row=await getPending()
    if(token===pendingCheckToken)pendingRegistration.value=!!row
  }catch{
    if(token===pendingCheckToken)
      error.value='Не удалось проверить незавершённую регистрацию на устройстве.'
  }finally{
    if(token===pendingCheckToken)pendingChecking.value=false
  }
}
function guardHardExit(event:BeforeUnloadEvent):void{
  if(!generated.value||activeSession.value)return
  event.preventDefault()
  event.returnValue=''
}
watch(()=>route.path,()=>{
  error.value='';notice.value='';resetAutoplay()
  if(!isCreate.value){
    // Welcome's home/create/recover routes reuse this component. Only clear
    // volatile plaintext after the corresponding navigation guard approves.
    generated.value=''
    savedPendingKey.value=''
    pendingRegistration.value=false
  }else if(!generated.value)void checkPendingRegistration()
})
watch(activeSession,session=>{
  // During pre-PIN device discovery this component is presentation-only.
  // Do not navigate to a private route before App's PIN gate has settled.
  if(session&&!props.bootstrapOnly)void router.replace(resolveStartRoute())
},{immediate:true})
onMounted(()=>{
  motion=typeof window.matchMedia==='function'
    ?window.matchMedia('(prefers-reduced-motion: reduce)'):null
  motion?.addEventListener?.('change',resetAutoplay)
  document.addEventListener('visibilitychange',resetAutoplay)
  window.addEventListener('beforeunload',guardHardExit)
  if(isCreate.value)void checkPendingRegistration()
  resetAutoplay()
})
onUnmounted(()=>{
  stopAutoplay()
  document.removeEventListener('visibilitychange',resetAutoplay)
  window.removeEventListener('beforeunload',guardHardExit)
  ++pendingCheckToken
  savedPendingKey.value=''
  recovery.value=''
  generated.value=''
  motion?.removeEventListener?.('change',resetAutoplay)
  motion=null
})
function confirmPendingKeyExit():boolean{
 if(generated.value&&!activeSession.value)
   return window.confirm(
     'Регистрация не завершена. Recovery Key исчезнет с этого экрана. '+
     'Если вы сохранили его отдельно, сможете продолжить позже. Выйти?'
   )
 return true
}
onBeforeRouteLeave(confirmPendingKeyExit)
// /welcome, /welcome/create and /welcome/recover map to the SAME Vue view;
// a reused component is updated rather than always being removed.
onBeforeRouteUpdate((to,from)=>{
 if(from.path==='/welcome/create'&&to.path!=='/welcome/create')
   return confirmPendingKeyExit()
 return true
})
async function generate():Promise<void>{
 if(busy.value||generated.value||pendingChecking.value||pendingRegistration.value)return
 busy.value=true;error.value='';notice.value=''
 try{
   generated.value=await beginRegistration()
   pendingRegistration.value=true
 }
 catch(e){error.value=e instanceof Error?e.message:'Не удалось создать ключ'}
 finally{busy.value=false}
}
async function copyKey():Promise<void>{
 try{await navigator.clipboard.writeText(generated.value);notice.value='Recovery Key скопирован'}
 catch{error.value='Не удалось скопировать ключ'}
}
async function saveKey():Promise<void>{
 if(!generated.value||keyExportBusy.value||busy.value)return
 // Opening multiple OS pickers can expose redundant plaintext copies.
 // Keep one in-flight export for this exact registration key.
 keyExportBusy.value=true
 const key=generated.value
 error.value='';notice.value=''
 try{
   const result=await saveRecoveryKeyWithSystemDialog(key,brand.slug)
   // A stale async chooser must never report success for a different key.
   if(key!==generated.value)return
   if(result==='saved')
     notice.value='Файл Recovery Key сохранён в выбранном вами месте. Проверьте его.'
   else if(result==='shared')
     notice.value='Системное меню закрыто. Проверьте сохранение в «Файлы». Не передавайте ключ другим людям.'
   else if(result==='unsupported')
     error.value='Этот браузер не умеет выбирать место для файла. Скопируйте Recovery Key и сохраните отдельно.'
   else if(result==='failed')
     error.value='Не удалось сохранить Recovery Key. Ключ остаётся на экране — скопируйте его.'
   // A cancelled chooser is not a successfully saved key.
 }catch{
   if(key===generated.value)error.value='Не удалось открыть системное сохранение. Скопируйте Recovery Key.'
 }finally{keyExportBusy.value=false}
}
async function resumePendingRegistration():Promise<void>{
 if(busy.value||!pendingRegistration.value||!savedPendingKey.value.trim())return
 busy.value=true;error.value='';notice.value=''
 try{
   await finishRegistration(savedPendingKey.value.trim())
   savedPendingKey.value=''
   pendingRegistration.value=false
   await router.replace(resolveStartRoute())
 }catch(e){
   error.value=e instanceof Error?e.message:'Не удалось завершить регистрацию'
 }finally{busy.value=false}
}
async function createAccount():Promise<void>{
 if(busy.value||!generated.value||!acknowledged.value)return
 busy.value=true;error.value='';notice.value=''
 try{
   await finishRegistration(generated.value)
   generated.value='';pendingRegistration.value=false
   await router.replace(resolveStartRoute())
 }
 catch(e){error.value=e instanceof Error?e.message:'Не удалось завершить создание аккаунта'}
 finally{busy.value=false}
}
async function restore():Promise<void>{
 if(busy.value||!recovery.value.trim())return
 busy.value=true;error.value=''
 try{await restoreAccount(recovery.value.trim());recovery.value='';await router.replace(resolveStartRoute())}
 catch(e){
   if(markInvalidRecoveryKey(e)){
     recovery.value=''
     await router.replace('/authorization-error')
   }else error.value=e instanceof Error?e.message:'Не удалось восстановить аккаунт'
 }
 finally{busy.value=false}
}
async function loadFile(e:Event):Promise<void>{
 const file=(e.target as HTMLInputElement).files?.[0]
 if(!file)return
 if(file.size>8192){error.value='Файл ключа слишком большой';return}
 try{recovery.value=(await file.text()).trim();error.value=''}
 catch{error.value='Не удалось прочитать файл'}
}
</script>
<template>
<div class="welcome-screen app" data-testid="welcome-screen">
  <main class="app-main"><div id="content" class="content welcome-content">
    <div v-if="isHome" class="welcome-view" data-testid="welcome-main">
      <div class="welcome-brand">
        <div class="welcome-logo" aria-hidden="true">
          <svg viewBox="0 0 72 72" fill="none"><rect x="9" y="17" width="54" height="39" rx="10" stroke="currentColor" stroke-width="3"/><path d="m19 17 5-7h24l5 7" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="36" cy="37" r="13" stroke="#18d65c" stroke-width="3"/><path d="M36 26c6 3 9 8 10 13M27 42c5 3 11 4 16 1M32 27c-6 4-8 10-7 15" stroke="#a9f2b9" stroke-width="2.6" stroke-linecap="round"/></svg>
        </div>
        <div class="welcome-brand-name">{{brand.name}}</div>
      </div>
      <div class="welcome-auth-slot">
        <div v-if="bootstrapOnly||sessionBootstrapPending" class="welcome-loading welcome-bootstrap-loading"
          role="status" aria-live="polite" data-testid="welcome-bootstrap-loading">
          <span class="welcome-loading-spinner welcome-spinner" aria-hidden="true"></span>
          <span class="welcome-loading-text">Входим в приложение...</span>
        </div>
        <nav v-else class="welcome-links" aria-label="Вход">
          <RouterLink class="welcome-link primary" to="/welcome/create">Создать аккаунт</RouterLink>
          <RouterLink class="welcome-link recover" to="/welcome/recover">Восстановить аккаунт</RouterLink>
        </nav>
      </div>
      <section class="carousel" :aria-label="'Почему '+brand.name" aria-roledescription="carousel"
        :style="{'--slide-accent':current.accent}"
        @mouseenter="onCarouselMouseEnter" @mouseleave="onCarouselMouseLeave"
        @focusin="onCarouselFocusIn" @focusout="onCarouselFocusOut"
        @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd"
        @touchcancel.passive="onTouchCancel">
        <div class="carousel-body" aria-live="off">
          <div class="carousel-art">
            <svg viewBox="0 0 180 135" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <template v-if="current.art==='gallery'"><rect x="46" y="12" width="76" height="88" rx="13"/><rect x="56" y="27" width="56" height="52" rx="6"/><circle cx="73" cy="45" r="7"/><path d="m61 73 13-13 10 9 9-12 14 16"/><path d="M131 41h15v41h-15"/><path d="m22 84 11 11 16-18"/></template>
              <template v-else-if="current.art==='crypto'"><path d="M91 10 44 29v34c0 31 18 49 47 60 29-11 47-29 47-60V29z"/><rect x="72" y="60" width="38" height="29" rx="6"/><path d="M80 60V50a11 11 0 0 1 22 0v10"/><circle cx="91" cy="74" r="2"/></template>
              <template v-else-if="current.art==='teams'"><rect x="31" y="19" width="125" height="94" rx="12"/><path d="M31 46h125"/><circle cx="55" cy="32" r="4"/><circle cx="72" cy="32" r="4"/><circle cx="89" cy="32" r="4"/><circle cx="73" cy="69" r="11"/><path d="M52 102c0-14 10-22 21-22s21 8 21 22M112 63h22m-22 14h22m-22 14h15"/></template>
              <template v-else-if="current.art==='expiry'"><circle cx="91" cy="65" r="46"/><path d="M91 30v35l24 16M62 9h58M91 9V3"/><path d="m137 106 9 9 18-21"/></template>
              <template v-else-if="current.art==='anonymous'"><path d="M51 46c0-23 16-36 40-36s40 13 40 36v29c0 30-15 47-40 47S51 105 51 75z"/><circle cx="74" cy="65" r="3"/><circle cx="109" cy="65" r="3"/><path d="M72 90c10 7 27 7 38 0M37 43h-18m144 0h-18"/></template>
              <template v-else><path d="M91 8 36 31v33c0 33 23 50 55 60 32-10 55-27 55-60V31z"/><path d="M91 39v36M91 89v3"/><path d="m38 103-13 13m119-13 13 13"/></template>
            </svg>
          </div>
          <div class="carousel-copy"><h2>{{current.title}}</h2><p>{{current.desc}}</p></div>
        </div>
        <div class="carousel-dots" role="group" aria-label="Выбор слайда">
          <button v-for="(feature,i) in features" :key="feature.art" type="button"
            class="carousel-dot" :class="{active:slide===i}" :aria-label="'Показать слайд '+(i+1)"
            :aria-current="slide===i?'true':undefined" @click="choose(i)"></button>
        </div>
      </section>
    </div>

    <div v-else class="auth-view" data-testid="welcome-auth">
      <header class="auth-header">
        <RouterLink class="auth-back" to="/welcome" aria-label="Назад">‹</RouterLink>
        <div><h1>{{isRecover?'Восстановить аккаунт':'Создать аккаунт'}}</h1>
          <p>{{isRecover?'Введите Recovery Key или выберите сохранённый файл.':'Создайте ключ для входа и восстановления доступа.'}}</p>
        </div>
      </header>
      <div v-if="busy" class="auth-loading" role="status" data-testid="welcome-loading">
        <span class="welcome-loading-spinner welcome-spinner" aria-hidden="true"></span>Входим в приложение...
      </div>
      <div v-else-if="isRecover" class="auth-panel">
        <label>Recovery Key<textarea v-model="recovery" spellcheck="false" autocomplete="off" autocorrect="off" placeholder="Recovery Key" data-testid="welcome-recovery-key"></textarea></label>
        <label>Выбрать файл с ключом<input type="file" accept=".txt,text/plain" @change="loadFile"></label>
        <button class="action primary" type="button" :disabled="!recovery.trim()" data-testid="welcome-restore" @click="restore">Продолжить</button>
      </div>
      <div v-else class="auth-panel">
        <template v-if="!generated">
          <p>Без телефона, email или пароля. Только Recovery Key.</p>
          <button class="action primary" type="button" @click="generate"
            :disabled="pendingChecking||pendingRegistration">Создать Recovery Key</button>
          <p v-if="pendingChecking" role="status">Проверяем незавершённую регистрацию…</p>
          <div v-if="pendingRegistration" data-testid="welcome-pending-registration">
            <p>На этом устройстве уже начата регистрация. Введите ранее сохранённый Recovery Key, чтобы завершить её.</p>
            <label>Сохранённый Recovery Key
              <textarea v-model="savedPendingKey" spellcheck="false"
                autocorrect="off" autocomplete="off"
                data-testid="welcome-pending-key"></textarea>
            </label>
            <button class="action primary" type="button"
              data-testid="welcome-resume-registration"
              :disabled="!savedPendingKey.trim()" @click="resumePendingRegistration">
              Завершить незавершённую регистрацию
            </button>
          </div>
        </template>
        <template v-else>
          <label>Recovery Key<textarea :value="generated" readonly spellcheck="false" data-testid="welcome-generated-key"></textarea></label>
          <p>Храните ключ отдельно от устройства и не передавайте третьим лицам!</p>
          <div class="actions-inline">
            <button class="action" type="button" @click="copyKey">Скопировать</button>
            <button class="action" type="button" data-testid="welcome-save-key"
              :disabled="keyExportBusy||busy" @click="saveKey">Сохранить на устройство</button>
          </div>
          <label class="auth-check"><input v-model="acknowledged" type="checkbox">Я сохранил Recovery Key отдельно от устройства.</label>
          <button class="action primary" type="button" data-testid="welcome-finish"
            :disabled="!acknowledged" @click="createAccount">Продолжить</button>
        </template>
      </div>
      <p v-if="notice" class="auth-feedback" role="status">{{notice}}</p>
      <p v-if="error" class="auth-feedback error" role="alert">{{error}}</p>
    </div>
  </div></main>
</div>
</template>

<style scoped src="../features/identity/ui/WelcomeFieldwork.css"></style>
