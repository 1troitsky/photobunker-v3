<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { displayedDock, dockDefinitions } from './ui/fieldwork/dock-preferences'
import type { DockDefinition } from './ui/fieldwork/dock-preferences'
import { brand } from './config/brand'
import {
  activeSession,identityBootstrapReady,identityBootstrapError,pendingPinUnlock,pinMutationPending,
} from './features/identity/application/session'
import PinShell from './features/security/ui/PinShell.vue'
import WelcomeView from './views/WelcomeView.vue'
import { readVerifiedGraceStatus } from './features/billing/application/grace-client'
import { notificationShellActions } from './features/notifications/application/notification-shell-actions'
import {contactsShellActions} from './features/people/application/contacts-shell-actions'
import {viewerShellActions} from './features/browser/application/viewer-shell-actions'
import {browserShellActions} from './features/browser/application/browser-shell-actions'
import {cameraShellActions} from './features/media/application/camera-shell-actions'
import {isDockSectionActive,resolveDockRetap} from './ui/fieldwork/dock-retap'
const route = useRoute()
const router = useRouter()
// Session proof alone does NOT mean a browser is online. A previously
// authenticated account can remain in encrypted Local-First mode after
// Wi-Fi/airplane-mode loss without any new server acknowledgment.
const networkOnline=ref(typeof navigator!=='undefined'&&navigator.onLine)
const sessionDisplayedOnline=computed(()=>
  !!activeSession.value?.online&&networkOnline.value)
function updateNetworkOnline():void{
  networkOnline.value=typeof navigator!=='undefined'&&navigator.onLine
}
onMounted(()=>{
  window.addEventListener('online',updateNetworkOnline)
  window.addEventListener('offline',updateNetworkOnline)
})
onUnmounted(()=>{
  window.removeEventListener('online',updateNetworkOnline)
  window.removeEventListener('offline',updateNetworkOnline)
})
const verifiedPlan=ref('')
let planRequest=0
const planLabels:Readonly<Record<string,string>>={
  free:'Free',go:'Go',pro:'Pro',unlimited:'Unlimited',unlimited_plus:'Unlimited+',
}
watch(activeSession,async session=>{
  const generation=++planRequest
  verifiedPlan.value=''
  if(!session?.online)return
  try{
    const response=await readVerifiedGraceStatus(session)
    if(generation===planRequest&&activeSession.value===session)
      verifiedPlan.value=planLabels[response.planId]??''
  }catch{ /* No stale paid rights or guessed plan displayed when unverified. */ }
},{immediate:true})
function isActive(to:string):boolean {
  return isDockSectionActive(route.path,to)
}

/**
 * Normal RouterLink navigation stays native (including ctrl/cmd-click).
 * Active re-taps never use arbitrary browser Back: only a verified
 * same-section logical parent is allowed; otherwise replace a safe route.
 * Existing editor/assignment before-leave guards still run through router.
 */
function onDockClick(
  event:MouseEvent,to:string,navigate:(event?:MouseEvent)=>Promise<unknown>,
):void {
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey
    ||event.shiftKey||event.altKey){
    // On modified clicks leave the anchor to the browser, don't pop history.
    return
  }
  const action=resolveDockRetap(route.path,to,window.history.state?.back)
  if(!action){void navigate(event);return}
  event.preventDefault()
  if(action.kind==='back'){router.back();return}
  if(action.kind==='replace')void router.replace(action.path)
  // 'none' at the section root intentionally does not push a duplicate.
}
// The Dock changes only through locally validated, user-confirmed Appearance
// preferences; Notifications and encrypted local-drafts Messages are real routes.
const dock = computed(() => displayedDock.value
  .map(id => dockDefinitions[id])
  .filter((entry): entry is DockDefinition & {to:string} => entry.to !== null))
</script>

<template>
  <!-- No protected Browser/Camera/Viewer or Header can mount until the
       device has been authenticated and any saved PIN has been entered.
       Even a public route must not render stale private Shell children. -->
  <!-- The external Public Card and public install guide are entirely
       anonymous, do not import Identity keys and must never require a PIN.
       All PRIVATE routes remain sealed until trusted device admission. -->
  <RouterView v-if="route.meta?.publicStandalone===true"/>
  <WelcomeView v-else-if="!identityBootstrapReady" bootstrap-only/>
  <PinShell v-else-if="pendingPinUnlock||identityBootstrapError" :mutation-pending="pinMutationPending"/>
  <!-- Welcome remains a standalone route once PIN and local bootstrap settle. -->
  <RouterView v-else-if="route.meta?.standalone"/>
  <div v-else class="shell">
    <header class="shell-header">
      <span class="brand-mark" aria-hidden="true">{{ brand.mark }}</span>
      <div class="brand-copy">
        <strong>{{ brand.name }}</strong>
        <!-- The accepted Shell status opens the currently implemented,
             owner-key-encrypted local event inbox. This is NOT a complete
             server-operation journal or a promise of push delivery. -->
        <RouterLink to="/notifications" class="shell-status-link"
          data-testid="shell-status-link" aria-label="Открыть локальные уведомления"
          title="Локальный журнал уведомлений; серверная доставка не подтверждена">
          <small><span class="status-dot"
            :class="{'session-online':sessionDisplayedOnline}"
            aria-hidden="true"></span>{{activeSession?(sessionDisplayedOnline?'Сессия подтверждена':'Локальный режим'):'Без аккаунта'}}</small>
        </RouterLink>
      </div>
      <RouterLink v-if="verifiedPlan&&route.path!=='/notifications'&&route.path!=='/browser'&&route.path!=='/camera'&&route.name!=='browser-viewer'&&route.name!=='browser-editor'"
        to="/settings/payments" class="shell-plan-pill" data-testid="verified-plan-link">
        Тариф: {{verifiedPlan}}
      </RouterLink>
      <div class="shell-header-actions notification-header-actions"
        v-if="route.path==='/notifications'" data-testid="notifications-header-actions">
        <button type="button" aria-label="Прочитать все" title="Прочитать все"
          data-testid="notifications-mark-all"
          :disabled="!notificationShellActions?.canMarkAll"
          @click="notificationShellActions?.markAll()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" aria-hidden="true"><path d="m3 12 5 5 7-8M13 16l3 3 5-7"/></svg>
        </button>
        <button type="button" aria-label="Настройки уведомлений"
          title="Настройки уведомлений"
          data-testid="notifications-settings" @click="router.push('/notifications/settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/>
            <path d="m19.4 15 .1.1 1.3 1.3-2 3.4-1.8-.5a8 8 0 0 1-2 .9l-.5 1.8h-4l-.5-1.8a8 8 0 0 1-2-.9l-1.8.5-2-3.4 1.3-1.3a8 8 0 0 1 0-2.2L4.2 11l2-3.4 1.8.5a8 8 0 0 1 2-.9L10.5 5h4l.5 2.2a8 8 0 0 1 2 .9l1.8-.5 2 3.4-1.3 1.3a8 8 0 0 1-.1 2.2"/></svg>
        </button>
      </div>
      <div class="shell-header-actions viewer-header-actions"
        v-else-if="route.name==='browser-viewer'" data-testid="viewer-shell-actions"
        aria-label="Действия с файлом">
        <button type="button" disabled aria-label="Избранное"
          title="Синхронизированная E2EE-коллекция Избранное ещё не реализована">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" aria-hidden="true">
            <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5-4.9 6.9-1z"/>
          </svg>
        </button>
        <button type="button" disabled aria-label="Копировать"
          title="Безопасное копирование во внешний буфер обмена ещё не проверено">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" aria-hidden="true">
            <rect x="8" y="8" width="12" height="12" rx="2"/>
            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
        <button type="button" aria-label="Скачать"
          :disabled="!viewerShellActions"
          title="Скачать исходный расшифрованный файл после подтверждения"
          @click="viewerShellActions?.download()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" aria-hidden="true">
            <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>
          </svg>
        </button>
        <button type="button" disabled aria-label="Удалить"
          title="Удаление требует принятой серверной политики архива, TTL и прав">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 10v8M14 10v8"/>
          </svg>
        </button>
      </div>
      <div class="shell-header-actions editor-header-actions"
        v-else-if="route.name==='browser-editor'" data-testid="editor-shell-actions"
        aria-label="Редактор файла">
        <button type="button" data-testid="editor-shell-cancel"
          @click="viewerShellActions?.editor?.cancel()">Отмена</button>
        <button class="editor-shell-save" type="button"
          data-testid="editor-shell-save"
          :disabled="!viewerShellActions?.editor?.canSave"
          @click="viewerShellActions?.editor?.save()">Сохранить</button>
      </div>
      <div class="shell-header-actions camera-header-actions"
        v-else-if="route.path==='/camera'" data-testid="camera-shell-actions"
        aria-label="Действия камеры">
        <button type="button" data-testid="camera-header-flip"
          aria-label="Перевернуть камеру" title="Переключить переднюю и заднюю камеры"
          :disabled="!cameraShellActions?.canFlip"
          @click="cameraShellActions?.flip()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            aria-hidden="true"><path d="M3 10a9 9 0 0 1 15.5-5L21 7m0-5v5h-5"/>
            <path d="M21 14a9 9 0 0 1-15.5 5L3 17m0 5v-5h5"/></svg>
        </button>
        <button type="button" data-testid="camera-header-torch"
          aria-label="Фонарик" title="Фонарик (если поддерживается камерой)"
          :aria-pressed="!!cameraShellActions?.torchOn"
          :disabled="!cameraShellActions?.canTorch"
          @click="cameraShellActions?.toggleTorch()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" aria-hidden="true">
            <path d="M7 2h10l-1 8-4 4-4-4zM10 14v7h4v-7"/>
            <path d="M9 2h6M9 6h6"/>
          </svg>
        </button>
        <button type="button" data-testid="camera-header-blind"
          aria-label="Слепой режим" title="Скрыть предпросмотр"
          :aria-pressed="!!cameraShellActions?.blind"
          :disabled="!cameraShellActions?.canBlind"
          @click="cameraShellActions?.toggleBlind()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/>
            <circle cx="12" cy="12" r="3"/><path d="m3 3 18 18"/></svg>
        </button>
      </div>
      <div class="shell-header-actions browser-header-actions"
        v-else-if="route.path==='/browser'" data-testid="browser-shell-actions"
        aria-label="Действия с каталогом">
        <button type="button" data-testid="browser-header-folder"
          aria-label="Новая папка" title="Новая папка"
          :disabled="!browserShellActions?.canCreateFolder"
          @click="browserShellActions?.createFolder()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            aria-hidden="true"><path d="M3 7h7l2 3h9v10H3z"/><path d="M16 12v6m-3-3h6"/></svg>
        </button>
        <button type="button" data-testid="browser-header-upload"
          aria-label="Загрузить файлы" title="Открыть импорт файлов"
          :disabled="!activeSession||!browserShellActions"
          @click="browserShellActions?.openUpload()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            aria-hidden="true"><path d="M12 17V3m-5 5 5-5 5 5M4 17v4h16v-4"/></svg>
        </button>
        <button type="button" data-testid="browser-header-select"
          :aria-label="browserShellActions?.selecting?'Отменить выбор':'Выбрать'"
          :title="browserShellActions?.selecting?'Отменить выбор файлов':'Выбрать файлы'"
          :aria-pressed="!!browserShellActions?.selecting"
          :disabled="!browserShellActions?.canSelect"
          @click="browserShellActions?.toggleSelection()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/>
            <path d="m7 12 3.5 3.5L17 8.5"/></svg>
        </button>
        <button type="button" data-testid="browser-header-search"
          aria-label="Поиск" title="Приватный поиск"
          :disabled="!activeSession||!browserShellActions"
          @click="browserShellActions?.focusSearch()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            aria-hidden="true"><circle cx="10.8" cy="10.8" r="7.2"/><path d="m16 16 5 5"/></svg>
        </button>
        <button type="button" data-testid="browser-header-settings"
          aria-label="Настройки Browser" title="Настройки Browser"
          :disabled="!activeSession||!browserShellActions"
          @click="browserShellActions?.openSettings()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            aria-hidden="true"><circle cx="12" cy="12" r="3"/>
            <path d="m19 12 2-1-2-4-2 1-2-1V5H9v2L7 8 5 7l-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h6v-2l2-1 2 1 2-4-2-1z"/></svg>
        </button>
      </div>
      <div class="shell-header-actions" v-else-if="route.path.startsWith('/settings')"
        data-testid="settings-shell-header-actions">
        <button v-if="route.path==='/settings/search'" type="button"
          aria-label="Закрыть поиск" title="Вернуться в настройки"
          @click="router.push('/settings')">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none"
            stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
        <button v-else type="button"
          aria-label="Поиск по настройкам" title="Поиск по настройкам"
          @click="router.push('/settings/search')">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none"
            stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="7.2"/>
            <path d="m16 16 5 5"/>
          </svg>
        </button>
      </div>
      <div class="shell-header-actions" v-else-if="route.path==='/contacts'"
        data-testid="contacts-shell-actions">
        <button type="button" data-testid="contacts-blacklist-toggle"
          aria-label="Blacklist" title="Локально заблокированные контакты — не отзыв серверных прав"
          :disabled="!activeSession||!contactsShellActions"
          :aria-expanded="contactsShellActions?.open?'true':'false'"
          aria-controls="contacts-local-blacklist"
          @click="contactsShellActions?.toggle()">
          <svg viewBox="0 0 24 24" width="19" height="19"
            fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <circle cx="9" cy="9" r="4"/>
            <path d="M2 21v-2a7 7 0 0 1 10-6.3M17 16l5 5M22 16l-5 5"/>
          </svg>
        </button>
      </div>
    </header>

    <main class="shell-main" :class="{'shell-main-viewer':route.name==='browser-viewer'||route.name==='browser-editor'}" id="main">
      <RouterView />
    </main>

    <nav class="shell-dock" aria-label="Главная навигация"
      :style="{gridTemplateColumns:'repeat('+dock.length+',minmax(0,1fr))'}">
      <RouterLink v-for="item in dock" :key="item.to" :to="item.to"
        custom v-slot="{ href, navigate }">
        <a :href="href" :class="{ active: isActive(item.to) }"
          :aria-current="isActive(item.to) ? 'page' : undefined"
          @click="onDockClick($event,item.to,navigate)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <template v-if="item.icon === 'tasks'"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></template>
          <template v-else-if="item.icon === 'folder'"><path d="M3 6h7l2 3h9v11H3z"/></template>
          <template v-else-if="item.icon === 'camera'"><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="14" r="3"/></template>
          <template v-else-if="item.icon === 'users'"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M18 8a3 3 0 0 1 0 6M21 20v-2a5 5 0 0 0-4-4"/></template>
          <template v-else-if="item.icon === 'bell'"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></template>
          <template v-else-if="item.icon === 'message'"><path d="M4 5h16v12H9l-5 4zM8 10h8M8 13h5"/></template>
          <template v-else><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></template>
        </svg>
        <small>{{ item.name }}</small>
        </a>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.pin-bootstrap{min-height:100dvh;display:grid;place-items:center;
  background:#121212;color:#aeb7af;font-size:14px;font-weight:650}
</style>
