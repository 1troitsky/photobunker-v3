<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {brand} from '../../../config/brand'
import {
  identityBootstrapError,pendingPinUnlock,restoreAccount,unlockPinnedDevice,
} from '../../identity/application/session'

const props=withDefaults(defineProps<{mutationPending?:boolean}>(),{mutationPending:false})
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
  if(props.mutationPending||busy.value)return
  clear()
  mode.value=mode.value==='pin'?'recover':'pin'
  recoveryKey.value=''
}
function digit(value:string):void{
  if(mode.value!=='pin'||props.mutationPending||busy.value||!/^[0-9]$/.test(value))return
  if(entered.value.length>=length.value)return
  entered.value+=value
  if(entered.value.length===length.value)void submitPin()
}
function erase():void {
  if(mode.value!=='pin'||props.mutationPending||busy.value)return
  entered.value=entered.value.slice(0,-1)
  feedback.value=''
}
async function submitPin():Promise<void>{
  if(props.mutationPending||busy.value||entered.value.length!==length.value)return
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
  if(props.mutationPending||busy.value||!recoveryKey.value.trim())return
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
  <main class="pin-screen" :aria-label="'Блокировка '+brand.name">
    <section class="pin-container">
      <div class="pin-brand" :aria-label="brand.name">
        <div class="brand-logo" aria-hidden="true">
<svg viewBox="0 0 72 72" fill="none" aria-hidden="true"><rect x="9" y="17" width="54" height="39" rx="10" stroke="currentColor" stroke-width="3"/><path d="m19 17 5-7h24l5 7" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="36" cy="37" r="13" stroke="#18d65c" stroke-width="3"/><path d="M36 26c6 3 9 8 10 13M27 42c5 3 11 4 16 1M32 27c-6 4-8 10-7 15" stroke="#a9f2b9" stroke-width="2.6" stroke-linecap="round"/></svg>
        </div>
        <strong class="brand-title">{{brand.name}}</strong>
      </div>
      <div v-if="mode==='pin' && !identityBootstrapError" class="pin-instructions">
        <h1>Введите PIN</h1>
        <div class="pin-indicators" aria-label="Введено цифр">
          <span v-for="index in length" :key="index"
            :class="{filled:index<=entered.length}"
            :aria-label="index<=entered.length?'Введено':'Пусто'"/>
        </div>
        <p class="pin-feedback" role="status" aria-live="polite">
          {{ props.mutationPending?'Сохраняем защиту…':busy?'Проверка…':feedback }}
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
          autocomplete="off" autocorrect="off" :disabled="props.mutationPending||busy"
          placeholder="PB2.…"/>
        <button type="button" class="pin-recovery-submit"
          :disabled="props.mutationPending||busy||!recoveryKey.trim()" @click="recover">
          Восстановить аккаунт
        </button>
        <p class="pin-feedback" role="status" aria-live="polite">
          {{ props.mutationPending?'Сохраняем защиту…':busy?'Проверка…':feedback }}
        </p>
      </div>
      <div v-if="mode==='pin' && !identityBootstrapError" class="keypad"
        aria-label="Цифровая клавиатура">
        <template v-for="(entry,index) in numbers" :key="index">
          <div v-if="entry===''" class="keypad-spacer" aria-hidden="true"/>
          <button v-else-if="entry==='delete'" type="button"
            class="digit digit-aux aux" aria-label="Удалить последнюю цифру"
            :disabled="props.mutationPending||busy" @click="erase"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H21V19H10L3 12Z"/><path d="m13 9 5 6m0-6-5 6"/></svg></button>
          <button v-else type="button" class="digit"
            :aria-label="'Цифра '+entry" :disabled="props.mutationPending||busy" @click="digit(entry)">
            {{ entry }}
          </button>
        </template>
      </div>
      <footer class="pin-foot">
        <button v-if="!identityBootstrapError" type="button" class="pin-recovery-toggle"
          :aria-label="mode==='pin'?'Восстановить через Recovery Key':'Вернуться к PIN'"
          :disabled="props.mutationPending||busy" @click="toggleRecovery">
          <span>{{ mode==='pin'&&!feedback?'Защищённый вход':mode==='pin'?'Восстановить через Recovery Key':'Вернуться к PIN' }}</span>
        </button>
      </footer>
    </section>
  </main>
</template>

<style scoped src="./PinFieldwork.css"></style>
