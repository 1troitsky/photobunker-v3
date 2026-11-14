<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {
  identityBootstrapError,pendingPinUnlock,restoreAccount,unlockPinnedDevice,
} from '../../identity/application/session'

const mode=ref<'pin'|'recover'>('pin')
const entered=ref('')
const recoveryKey=ref('')
const busy=ref(false)
const feedback=ref('')
const length=computed(()=>pendingPinUnlock.value?.pinLength??4)
const numbers=['1','2','3','4','5','6','7','8','9','','0','delete'] as const

// A tab blur rotates pendingPinUnlock.sessionNonce and rejects any in-flight
// PBKDF2 admission. Discard partially entered digits and stale feedback so
// they cannot be reused across independently validated PIN contexts.
watch(pendingPinUnlock,()=>{
  entered.value=''
  feedback.value=''
  recoveryKey.value=''
},{flush:'sync'})

function clear():void{
  entered.value=''
  feedback.value=''
}
function toggleRecovery():void{
  if(busy.value)return
  clear()
  mode.value=mode.value==='pin'?'recover':'pin'
  recoveryKey.value=''
}
function digit(value:string):void{
  if(mode.value!=='pin'||busy.value||!/^[0-9]$/.test(value))return
  if(entered.value.length>=length.value)return
  entered.value+=value
  if(entered.value.length===length.value)void submitPin()
}
function erase():void {
  if(mode.value!=='pin'||busy.value)return
  entered.value=entered.value.slice(0,-1)
  feedback.value=''
}
async function submitPin():Promise<void>{
  if(busy.value||entered.value.length!==length.value)return
  const candidate=entered.value
  const attemptNonce=pendingPinUnlock.value?.sessionNonce
  entered.value='' // no PIN survives in reactive UI state across awaits
  busy.value=true
  feedback.value=''
  try{
    const result=await unlockPinnedDevice(candidate)
    if(pendingPinUnlock.value?.sessionNonce!==attemptNonce)return
    if(result.status==='invalid')feedback.value='Неверный PIN'
    else if(result.status==='locked')feedback.value='Вход временно заблокирован'
    else if(result.status==='clock-rollback')feedback.value='Проверка времени не пройдена'
    else if(result.status==='emergency-intent')
      feedback.value='Доступ не предоставлен'
  }catch{
    if(pendingPinUnlock.value?.sessionNonce===attemptNonce)
      feedback.value='Проверка недоступна. Используйте ключ восстановления.'
  }finally{
    busy.value=false
  }
}
async function recover():Promise<void>{
  if(busy.value||!recoveryKey.value.trim())return
  const key=recoveryKey.value.trim()
  recoveryKey.value=''
  busy.value=true
  feedback.value=''
  try{
    await restoreAccount(key)
  }catch{
    feedback.value='Восстановление не выполнено. Проверьте ключ и соединение.'
  }finally{
    busy.value=false
  }
}
function keydown(event:KeyboardEvent):void{
  if(event.ctrlKey||event.metaKey||event.altKey||event.repeat)return
  if(mode.value!=='pin')return
  if(/^[0-9]$/.test(event.key)){
    event.preventDefault()
    digit(event.key)
  }else if(event.key==='Backspace'){
    event.preventDefault()
    erase()
  }else if(event.key==='Escape'){
    event.preventDefault()
    clear()
  }
}
onMounted(()=>window.addEventListener('keydown',keydown))
onUnmounted(()=>{
  window.removeEventListener('keydown',keydown)
  entered.value=''
  recoveryKey.value=''
})
</script>

<template>
  <main class="pin-screen" aria-label="Блокировка PhotoBunker">
    <section class="pin-container">
      <div class="pin-brand" aria-label="PhotoBunker">
        <div class="brand-logo" aria-hidden="true">
          <svg viewBox="0 0 40 40" fill="none" stroke="currentColor"
            stroke-width="2.4" stroke-linejoin="round">
            <rect x="7" y="14" width="26" height="20" rx="5"/>
            <path d="M13 14V9a7 7 0 0 1 14 0v5"/>
            <circle cx="20" cy="23" r="3"/>
            <path d="M20 26v3"/>
          </svg>
        </div>
        <strong class="brand-title">PhotoBunker</strong>
      </div>
      <div v-if="mode==='pin' && !identityBootstrapError" class="pin-instructions">
        <h1>Введите PIN</h1>
        <div class="pin-indicators" aria-label="Введено цифр">
          <span v-for="index in length" :key="index"
            :class="{filled:index<=entered.length}"
            :aria-label="index<=entered.length?'Введено':'Пусто'"/>
        </div>
        <p class="pin-feedback" role="status" aria-live="polite">
          {{ busy?'Проверка…':feedback }}
        </p>
      </div>
      <div v-else class="pin-instructions pin-recovery">
        <h1>Восстановление доступа</h1>
        <p v-if="identityBootstrapError" class="pin-feedback">
          Локальное состояние недоступно. Доступен только Recovery Key.
        </p>
        <label for="pin-recovery-key">Account Recovery Key</label>
        <textarea id="pin-recovery-key" v-model="recoveryKey"
          rows="3" spellcheck="false" autocapitalize="off"
          autocomplete="off" autocorrect="off" :disabled="busy"
          placeholder="PB2.…"/>
        <button type="button" class="pin-recovery-submit"
          :disabled="busy||!recoveryKey.trim()" @click="recover">
          Восстановить аккаунт
        </button>
        <p class="pin-feedback" role="status" aria-live="polite">
          {{ busy?'Проверка…':feedback }}
        </p>
      </div>
      <div v-if="mode==='pin' && !identityBootstrapError" class="keypad"
        aria-label="Цифровая клавиатура">
        <template v-for="(entry,index) in numbers" :key="index">
          <div v-if="entry===''" class="keypad-spacer" aria-hidden="true"/>
          <button v-else-if="entry==='delete'" type="button"
            class="digit digit-aux" aria-label="Удалить последнюю цифру"
            :disabled="busy" @click="erase">⌫</button>
          <button v-else type="button" class="digit"
            :aria-label="'Цифра '+entry" :disabled="busy" @click="digit(entry)">
            {{ entry }}
          </button>
        </template>
      </div>
      <button v-if="!identityBootstrapError" type="button"
        class="pin-recovery-toggle" :disabled="busy" @click="toggleRecovery">
        {{ mode==='pin'?'Восстановить через Recovery Key':'Вернуться к PIN' }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.pin-screen{width:100%;height:100dvh;min-height:0;display:flex;align-items:center;
  justify-content:center;overflow:hidden;color:#f2f2f2;
  background:radial-gradient(ellipse 65% 38% at 50% 47%,#1733213a,transparent 72%),#121212}
.pin-container{height:100%;width:min(100%,390px);min-height:0;
  display:flex;flex-direction:column;align-items:center;justify-content:space-between;
  padding:clamp(24px,5.1vh,48px) 18px max(22px,env(safe-area-inset-bottom,0px))}
.pin-brand{display:flex;align-items:center;flex-direction:column;gap:7px;flex:0 0 auto}
.brand-logo{width:54px;height:54px;display:grid;place-items:center;
  border:1px solid #454e45;background:linear-gradient(140deg,#2b382b,#171e18);
  border-radius:16px;box-shadow:0 8px 24px #0003}
.brand-logo svg{width:37px;height:37px}
.brand-title{font-size:20px;line-height:1.2;font-weight:780;letter-spacing:-.055em}
.pin-instructions{display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:16px;min-height:120px;margin:auto 0}
.pin-instructions h1{font-size:21px;line-height:1.15;margin:0;font-weight:760;
  letter-spacing:-.04em;text-align:center}
.pin-feedback{min-height:20px;max-width:280px;margin:0;text-align:center;
  color:#c4c4c4;font-size:12px;line-height:1.4}
.pin-indicators{display:flex;align-items:center;justify-content:center;gap:15px;min-height:20px}
.pin-indicators span{width:11px;height:11px;border:1.5px solid #8d978f;
  border-radius:50%;transition:background .12s,border-color .12s,transform .12s}
.pin-indicators span.filled{background:#1ed760;border-color:#1ed760;transform:scale(1.04)}
.keypad{width:min(100%,248px);display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:6px 8px;flex:0 0 auto}
.digit{height:54px;min-width:0;border:1px solid #383838;background:#232323e8;
  border-radius:12px;display:flex;align-items:center;justify-content:center;
  font-size:26px;font-weight:430;line-height:1;color:inherit;cursor:pointer;
  touch-action:manipulation;user-select:none}
.digit:hover{background:#303330;border-color:#4e6453}
.digit:active{background:#32513b}
.digit:disabled{opacity:.5;cursor:not-allowed}
.digit-aux{background:transparent;border-color:transparent;color:#b8c0b9}
.keypad-spacer{min-height:54px}
.pin-recovery-toggle{flex:0 0 auto;border:0;background:transparent;
  padding:10px;color:#a7b6aa;font-size:11px;cursor:pointer}
.pin-recovery-toggle:hover{color:#1ed760}
.pin-recovery{width:100%;gap:11px}
.pin-recovery label{align-self:flex-start;font-size:12px;color:#d2d2d2}
.pin-recovery textarea{width:100%;min-height:85px;resize:vertical;
  background:#1b1b1b;color:inherit;border:1px solid #555;border-radius:8px;
  padding:12px;font:13px/1.45 ui-monospace,monospace}
.pin-recovery-submit{min-height:42px;padding:10px 16px;border-radius:8px;
  border:1px solid #4d725a;background:#25392b;color:inherit;cursor:pointer}
.pin-recovery-submit:disabled{opacity:.45;cursor:not-allowed}
.pin-screen button:focus-visible,.pin-screen textarea:focus-visible{
  outline:2px solid #a9eeba;outline-offset:3px}
@media(prefers-reduced-motion:reduce){.pin-screen *, .pin-screen *::before,
  .pin-screen *::after{transition:none!important;animation:none!important}}
</style>
