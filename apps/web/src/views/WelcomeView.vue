<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { activeSession, beginRegistration, finishRegistration, restoreAccount } from '../features/identity/application/session'
import { resolveStartRoute } from '../ui/fieldwork/appearance-preferences'
import { markInvalidRecoveryKey } from '../features/identity/application/authorization-failure'
const route=useRoute(),router=useRouter()
type Feature={title:string;desc:string;caption:string;accent:string;art:string}
const features:readonly Feature[]=[
 {title:'Снимайте — не оставляя фото в галерее.',
  desc:'Фото из PhotoBunker не сохраняются в стандартную медиатеку. Работайте с материалами внутри защищённого пространства.',
  caption:'Кадр остаётся в PhotoBunker',art:'gallery',accent:'#1ada62'},
 {title:'Сначала шифрование. Потом облако.',
  desc:'Модель PhotoBunker строится вокруг шифрования на устройстве и ключей под вашим контролем — не вокруг доверия к администратору сервера.',
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
const slide=ref(0),paused=ref(false),busy=ref(false),generated=ref(''),acknowledged=ref(false)
const recovery=ref(''),error=ref(''),notice=ref('')
const isCreate=computed(()=>route.path==='/welcome/create')
const isRecover=computed(()=>route.path==='/welcome/recover')
const isHome=computed(()=>!isCreate.value&&!isRecover.value)
const current=computed(()=>features[slide.value]!)
let interval:ReturnType<typeof setInterval>|null=null
let touchX:number|null=null
function choose(i:number):void{slide.value=(i+features.length)%features.length}
function onTouchStart(e:TouchEvent):void{touchX=e.changedTouches[0]?.clientX??null;paused.value=true}
function onTouchEnd(e:TouchEvent):void{
  const end=e.changedTouches[0]?.clientX??null
  if(touchX!==null&&end!==null&&Math.abs(end-touchX)>40)
    choose(slide.value+(end<touchX?1:-1))
  touchX=null;paused.value=false
}
watch(()=>route.path,()=>{error.value='';notice.value=''})
watch(activeSession,session=>{
  if(session)void router.replace(resolveStartRoute())
},{immediate:true})
onMounted(()=>{
 interval=setInterval(()=>{
   if(!isHome.value||paused.value||document.hidden
      ||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return
   choose(slide.value+1)
 },5500)
})
onUnmounted(()=>{if(interval!==null)clearInterval(interval)})
onBeforeRouteLeave(()=>{
 if(generated.value&&!acknowledged.value&&!activeSession.value)
   return window.confirm('Recovery Key ещё не подтверждён как сохранённый. Покинуть регистрацию?')
 return true
})
async function generate():Promise<void>{
 if(busy.value||generated.value)return
 busy.value=true;error.value='';notice.value=''
 try{generated.value=await beginRegistration()}
 catch(e){error.value=e instanceof Error?e.message:'Не удалось создать ключ'}
 finally{busy.value=false}
}
async function copyKey():Promise<void>{
 try{await navigator.clipboard.writeText(generated.value);notice.value='Recovery Key скопирован'}
 catch{error.value='Не удалось скопировать ключ'}
}
function saveKey():void{
 if(!generated.value)return
 const blob=new Blob([generated.value+'\n'],{type:'text/plain;charset=utf-8'})
 const url=URL.createObjectURL(blob)
 const a=document.createElement('a')
 a.href=url;a.download='PhotoBunker-Recovery-Key.txt'
 document.body.appendChild(a);a.click();a.remove()
 setTimeout(()=>URL.revokeObjectURL(url),1000)
 notice.value='Файл с ключом передан браузеру для сохранения'
}
async function createAccount():Promise<void>{
 if(busy.value||!generated.value||!acknowledged.value)return
 busy.value=true;error.value='';notice.value=''
 try{await finishRegistration(generated.value);generated.value='';await router.replace(resolveStartRoute())}
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
<div class="welcome-screen" data-testid="welcome-screen">
  <main class="welcome-content">
    <div v-if="isHome" class="welcome-view" data-testid="welcome-main">
      <div class="welcome-brand">
        <div class="welcome-logo" aria-hidden="true">
          <svg viewBox="0 0 72 72" fill="none"><rect x="9" y="17" width="54" height="39" rx="10" stroke="currentColor" stroke-width="3"/><path d="m19 17 5-7h24l5 7" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="36" cy="37" r="13" stroke="#18d65c" stroke-width="3"/><path d="M36 26c6 3 9 8 10 13M27 42c5 3 11 4 16 1M32 27c-6 4-8 10-7 15" stroke="#a9f2b9" stroke-width="2.6" stroke-linecap="round"/></svg>
        </div>
        <div class="welcome-brand-name">PhotoBunker</div>
      </div>
      <nav class="welcome-links" aria-label="Вход">
        <RouterLink class="welcome-link primary" to="/welcome/create">Создать аккаунт</RouterLink>
        <RouterLink class="welcome-link recover" to="/welcome/recover">Восстановить аккаунт</RouterLink>
      </nav>
      <section class="carousel" aria-label="Почему PhotoBunker" aria-roledescription="carousel"
        :style="{'--slide-accent':current.accent}"
        @mouseenter="paused=true" @mouseleave="paused=false" @focusin="paused=true" @focusout="paused=false"
        @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
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
        <span class="welcome-spinner" aria-hidden="true"></span>Входим в приложение...
      </div>
      <div v-else-if="isRecover" class="auth-panel">
        <label>Recovery Key<textarea v-model="recovery" spellcheck="false" autocomplete="off" autocorrect="off" placeholder="Recovery Key" data-testid="welcome-recovery-key"></textarea></label>
        <label>Выбрать файл с ключом<input type="file" accept=".txt,text/plain" @change="loadFile"></label>
        <button class="action primary" type="button" :disabled="!recovery.trim()" data-testid="welcome-restore" @click="restore">Продолжить</button>
      </div>
      <div v-else class="auth-panel">
        <template v-if="!generated">
          <p>Без телефона, email или пароля. Только Recovery Key.</p>
          <button class="action primary" type="button" @click="generate">Создать Recovery Key</button>
        </template>
        <template v-else>
          <label>Recovery Key<textarea :value="generated" readonly spellcheck="false" data-testid="welcome-generated-key"></textarea></label>
          <p>Храните ключ отдельно от устройства и не передавайте третьим лицам!</p>
          <div class="actions-inline">
            <button class="action" type="button" @click="copyKey">Скопировать</button>
            <button class="action" type="button" @click="saveKey">Сохранить на устройство</button>
          </div>
          <label class="auth-check"><input v-model="acknowledged" type="checkbox">Я сохранил Recovery Key отдельно от устройства.</label>
          <button class="action primary" type="button" data-testid="welcome-finish"
            :disabled="!acknowledged" @click="createAccount">Продолжить</button>
        </template>
      </div>
      <p v-if="notice" class="auth-feedback" role="status">{{notice}}</p>
      <p v-if="error" class="auth-feedback error" role="alert">{{error}}</p>
    </div>
  </main>
</div>
</template>
<style scoped>
/* Owner-approved Welcome 1.4 structure, six original SVGs and copy from docs/ux/welcome/.
   Only auth and persistent state are changed from prototype to actual Key-Only Identity. */
.welcome-view{max-width:570px;width:100%;margin:0 auto;min-height:0;display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:20px;padding:8px 0 18px}
.welcome-brand{display:flex;flex-direction:column;align-items:center;gap:5px;margin-bottom:4px}
.welcome-logo{width:68px;height:68px;border:1px solid #454e45;background:linear-gradient(140deg,#2b382b,#171e18);border-radius:17px;display:grid;place-items:center;box-shadow:0 9px 25px #0003}
.welcome-logo svg{width:46px;height:46px;stroke-width:2.5;color:#f3fff4}
.welcome-brand-name{font-size:25px;font-weight:800;letter-spacing:-.055em;line-height:1.2}
.welcome-links{display:grid;gap:9px}
.welcome-link{display:flex;align-items:center;justify-content:center;min-height:43px;padding:10px 16px;border:1px solid #4b4b4b;background:#303030;color:#f1f1f1;border-radius:9px;text-decoration:none;font-size:13px;font-weight:730;transition:background .14s,border-color .14s}
.welcome-link.primary{background:#1ed760;border-color:#1ed760;color:#0c2615}
.welcome-link:hover{background:#404040}
.welcome-link.primary:hover{background:#30e971}
.welcome-link:focus-visible{outline:2px solid #b3f0c2;outline-offset:3px}
.carousel{--slide-accent:#1ed760;border:1px solid #414641;border-radius:11px;background:linear-gradient(145deg,#242a24,#1e201e 72%);overflow:hidden;min-height:314px;}
.carousel-body{display:flex;flex-direction:column;gap:0;padding:16px 17px 22px;min-height:314px}
.carousel-art{height:146px;flex:none;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;border:1px solid #ffffff1a;border-radius:9px;background:radial-gradient(circle at 80% 17%,color-mix(in srgb,var(--slide-accent) 18%,transparent),transparent 46%),#151915}
.carousel-art:before{content:'';position:absolute;width:230px;height:230px;border-radius:50%;border:1px solid #ffffff12;transform:translate(70px,20px);box-shadow:0 0 0 40px #ffffff06,0 0 0 80px #ffffff05}
.carousel-art svg{width:156px;height:120px;stroke:var(--slide-accent);stroke-width:3.2;filter:drop-shadow(0 0 12px color-mix(in srgb,var(--slide-accent) 22%,transparent))}
.carousel-copy h2{margin:15px 0 8px;font-size:clamp(21px,3vw,29px);font-weight:800;line-height:1.14;letter-spacing:-.042em;color:#f3f4f1}
.carousel-copy p{color:#b8c1b9;font-size:12px;line-height:1.53;margin:0}
.carousel.fade .carousel-body{animation:slide-in .35s ease both}
@keyframes slide-in{from{opacity:.35;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.auth-view{max-width:590px;margin:0 auto;padding:8px 0 22px;display:grid;gap:20px}
.auth-header{display:flex;align-items:flex-start;gap:10px}
.auth-header h1{font-size:24px;line-height:1.15;letter-spacing:-.04em;margin:0}
.auth-header p{font-size:12px;color:#a9a9a9;margin:8px 0 0}
.auth-back{border:0;background:transparent;width:32px;height:32px;display:grid;place-items:center;padding:2px}
.auth-panel{border-radius:10px;background:#202020;padding:17px;display:grid;gap:13px}
.auth-panel label{display:block;font-size:12px;font-weight:650}
.auth-panel textarea{width:100%;min-height:117px;margin-top:7px;background:#303030;color:#eee;border:1px solid #4b4b4b;padding:11px;border-radius:8px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
.auth-panel .action{width:100%;min-height:40px}
.auth-panel p{margin:0;color:#aaa;font-size:11.5px}
.auth-panel input[type=file]{display:block;width:100%;margin-top:8px;color:#ccc;font-size:11px}
.auth-panel .auth-check{display:flex;gap:10px;align-items:flex-start;font-size:12px;font-weight:500;color:#ddd}
.auth-panel input[type=checkbox]{accent-color:#1ed760}
.auth-feedback{color:#a3e6b5;font-size:12px;min-height:18px}
@media(max-width:470px){.content{padding:18px 14px 27px}.welcome-view{gap:16px;padding:2px 0 24px}.welcome-logo{width:65px;height:65px}.welcome-logo svg{width:44px;height:44px}.welcome-brand-name{font-size:23px}.carousel-body{padding:14px;min-height:305px}.carousel{min-height:305px}.carousel-art{height:137px}.carousel-copy h2{font-size:22px}.carousel-copy p{font-size:11.5px}}
@media(max-width:350px){.welcome-view{gap:13px}.carousel-copy h2{font-size:20px}.carousel-copy p{font-size:11px}.carousel-art{height:124px}.carousel-body{min-height:292px}.carousel{min-height:292px}}
@media(prefers-reduced-motion:reduce){.carousel.fade .carousel-body{animation:none}.welcome-link{transition:none}}


/* Fieldwork Welcome 1.3: no application header/dock, transparent stable carousel. */
#content{min-height:100%;display:flex;align-items:center;justify-content:center;width:100%}
.welcome-view{flex:0 0 auto;max-width:540px;margin:auto;justify-content:center}
.carousel{background:transparent;border:0;border-radius:0;box-shadow:none;height:324px;min-height:324px;position:relative;overflow:hidden}
.carousel-body{height:294px;min-height:294px;display:grid;grid-template-rows:145px minmax(0,1fr);gap:8px;padding:0 12px;align-items:start}
.carousel-art{height:145px;border:0;background:transparent;border-radius:0;overflow:hidden;}
.carousel-art:before{display:none}
.carousel-art svg{width:162px;height:126px}
.carousel-copy{width:100%;min-height:0;text-align:center;margin:0 auto;max-width:490px}
.carousel-copy h2{margin:0 0 9px;text-align:center;font-size:23px;line-height:1.16}
.carousel-copy p{margin:0 auto;text-align:center;font-size:12px;line-height:1.5;max-width:450px}
.carousel-dots{display:flex;align-items:center;justify-content:center;gap:8px;position:absolute;bottom:6px;left:0;right:0;height:17px;pointer-events:none}
.carousel-dot{width:6px;height:6px;border-radius:50%;background:#616961;opacity:.75;transition:background .22s ease,transform .22s ease,opacity .22s ease}
.carousel-dot.active{background:#1ed760;opacity:1;transform:scale(1.25)}
@media(max-width:470px){
 .content{padding:12px 13px 16px}
 .welcome-view{gap:16px;padding:8px 0 12px}
 .carousel{height:322px;min-height:322px}
 .carousel-body{height:293px;min-height:293px;grid-template-rows:139px minmax(0,1fr);padding:0 5px}
 .carousel-art{height:139px}
 .carousel-art svg{width:154px;height:118px}
 .carousel-copy h2{font-size:22px;line-height:1.17}
 .carousel-copy p{font-size:11.6px;line-height:1.47}
}
@media(max-width:350px){
 .welcome-view{gap:13px;padding:4px 0 7px}
 .carousel{height:319px;min-height:319px}
 .carousel-body{height:292px;min-height:292px;grid-template-rows:125px minmax(0,1fr);padding:0 3px}
 .carousel-art{height:125px}
 .carousel-art svg{width:143px;height:108px}
 .carousel-copy h2{font-size:20px;line-height:1.16;margin-bottom:6px}
 .carousel-copy p{font-size:11.1px;line-height:1.43}
}
@media(prefers-reduced-motion:reduce){.carousel-dot{transition:none}}


/* Fieldwork Welcome 1.4 — compact actions, balanced whitespace and discreet center glow. */
#content{min-height:100%;display:flex;align-items:center;justify-content:center;width:100%;}
.welcome-view{flex:0 0 auto;width:100%;max-width:540px;margin:auto;display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:23px;padding:58px 0 26px;}
.welcome-brand{margin-bottom:8px;}
.welcome-links{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;}
.welcome-link.primary{width:min(252px,84%);max-width:100%;min-height:43px;}
.welcome-link.recover{min-height:40px;width:auto;max-width:100%;padding:9px 12px;border:0;background:transparent;color:#bde6c7;font-weight:600;}
.welcome-link.recover:hover{background:transparent;color:#fff;text-decoration:underline;text-underline-offset:4px;}
.carousel{isolation:isolate;background:transparent;border:0;border-radius:0;box-shadow:none;position:relative;overflow:visible;height:312px;min-height:312px;--slide-accent:#1ed760;touch-action:pan-y;}
.carousel::before{content:'';position:absolute;z-index:-1;inset:0 -11%;pointer-events:none;background:radial-gradient(ellipse 65% 67% at 50% 48%,color-mix(in srgb,var(--slide-accent) 12%,transparent),transparent 78%);filter:blur(17px);opacity:.82;}
.carousel-body{height:auto;min-height:0;display:flex;flex-direction:column;align-items:center;gap:0;padding:0 8px;position:relative;z-index:1;}
.carousel-art{height:136px;flex:0 0 136px;width:100%;border:0;border-radius:0;background:transparent;overflow:visible;}
.carousel-art:before{display:none;}
.carousel-art svg{width:160px;height:125px;}
.carousel-copy{max-width:500px;width:100%;text-align:center;min-height:0;margin:0 auto;}
.carousel-copy h2{margin:4px auto 8px;line-height:1.15;font-size:clamp(20px,3vw,23px);text-align:center;}
.carousel-copy p{font-size:12px;line-height:1.5;margin:0 auto;text-align:center;max-width:465px;}
.carousel-dots{position:relative;left:auto;right:auto;bottom:auto;z-index:2;width:100%;display:flex;justify-content:center;gap:1px;height:26px;margin-top:7px;pointer-events:auto;}
.carousel-dot{width:25px;height:26px;border:0;background:transparent;display:grid;place-items:center;padding:0;cursor:pointer;opacity:1;border-radius:6px;transition:none;}
.carousel-dot::after{content:'';display:block;width:6px;height:6px;border-radius:50%;background:#596259;transition:background .2s,transform .2s;}
.carousel-dot.active{background:transparent;transform:none;opacity:1;}
.carousel-dot.active::after{background:#1ed760;transform:scale(1.28);}
.carousel-dot:hover::after{background:#91d7a2;}
.carousel-dot:focus-visible{outline:2px solid #a0ecb2;outline-offset:1px;}
#content.is-leaving{animation:welcome-view-exit .18s ease-in both;pointer-events:none;}
#content.is-entering{animation:welcome-view-enter .3s cubic-bezier(.2,.7,.25,1) both;}
@keyframes welcome-view-exit{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(-12px)}}
@keyframes welcome-view-enter{from{opacity:0;transform:translateX(15px)}to{opacity:1;transform:translateX(0)}}
@media(max-width:470px){
 .content{padding:10px 13px 12px;}
 .welcome-view{gap:20px;padding:56px 0 22px;}
 .welcome-brand{margin-bottom:8px;}
 .carousel{height:314px;min-height:314px;}
 .carousel-art{height:132px;flex-basis:132px;}
 .carousel-art svg{width:151px;height:118px;}
 .carousel-copy h2{font-size:21px;margin-top:2px;margin-bottom:7px;}
 .carousel-copy p{font-size:11.5px;line-height:1.47;}
 .carousel-dots{margin-top:6px;}
}
@media(max-width:350px){
 .welcome-view{gap:17px;padding:50px 0 0;}
 .carousel{height:302px;min-height:302px;}
 .carousel-art{height:119px;flex-basis:119px;}
 .carousel-art svg{width:142px;height:108px;}
 .carousel-copy h2{font-size:19px;}
 .carousel-copy p{font-size:11px;line-height:1.42;}
 .carousel-dots{margin-top:4px;}
}
@media(prefers-reduced-motion:reduce){
 #content.is-leaving,#content.is-entering{animation:none!important;}
 .carousel-dot::after{transition:none;}
}


.welcome-screen{--green:#1ed760;position:fixed;inset:0;background:#121212;color:#f2f2f2;overflow-y:auto}
.welcome-content{min-height:100dvh;width:100%;padding:18px 16px;display:flex;justify-content:center;align-items:center;position:relative}
.welcome-view{flex:0 0 auto}
.welcome-logo svg{display:block}
.carousel{position:relative;--slide-accent:#1ada62;padding-bottom:4px;width:100%}
.carousel-art{background:radial-gradient(circle,color-mix(in srgb,var(--slide-accent) 12%,transparent),transparent 51%)}
.carousel-art svg{stroke:var(--slide-accent);stroke-width:3.2;filter:drop-shadow(0 0 10px color-mix(in srgb,var(--slide-accent) 22%,transparent))}
.carousel-copy{min-height:112px}
.auth-view{width:100%;max-width:540px}
.auth-back{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;color:#b6dfbf;font-size:25px}
.auth-feedback.error{color:#efaca5}
.auth-loading{display:flex;gap:14px;justify-content:center;align-items:center;color:#b6e9c2;min-height:125px;font-size:12px}
.welcome-spinner{width:26px;height:26px;border:3px solid #355e41;border-top-color:#1ed760;border-radius:50%;animation:welcome-spin .75s linear infinite}
@keyframes welcome-spin{to{transform:rotate(360deg)}}
@media(max-width:470px){.welcome-content{padding:6px 13px}.welcome-view{padding-top:40px}.carousel-copy{min-height:115px}}
@media(prefers-reduced-motion:reduce){.welcome-spinner{animation:none}}
</style>