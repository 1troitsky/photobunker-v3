<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import {
  readEncryptedLocalQueue, readServerStorageUsage,
  type LocalStorageSummary, type ServerStorageUsage,
} from '../features/storage/application/storage-status'

type Phase = 'locked' | 'loading' | 'ready' | 'error' | 'offline'
const local = shallowRef<LocalStorageSummary | null>(null)
const server = shallowRef<ServerStorageUsage | null>(null)
const localPhase = ref<Phase>('locked')
const serverPhase = ref<Phase>('locked')
let requestId = 0

function formatBytes(value: number): string {
  if (value < 1024) return value + ' Б'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' КиБ'
  if (value < 1024 ** 3) return (value / 1024 ** 2).toFixed(1) + ' МиБ'
  return (value / 1024 ** 3).toFixed(2) + ' ГиБ'
}

function refresh(): void {
  const id = ++requestId
  const session = activeSession.value
  local.value = null
  server.value = null
  if (!session) {
    localPhase.value = 'locked'
    serverPhase.value = 'locked'
    return
  }
  localPhase.value = 'loading'
  // The local encrypted queue remains visible without trusting the network.
  void readEncryptedLocalQueue()
    .then(result => {
      if (requestId === id && activeSession.value === session) {
        local.value = result
        localPhase.value = 'ready'
      }
    })
    .catch(() => {
      if (requestId === id && activeSession.value === session) {
        local.value = null
        localPhase.value = 'error'
      }
    })

  if (!session.online || !navigator.onLine) {
    serverPhase.value = 'offline'
    return
  }
  serverPhase.value = 'loading'
  void readServerStorageUsage(session)
    .then(result => {
      if (requestId === id && activeSession.value === session) {
        server.value = result
        serverPhase.value = 'ready'
      }
    })
    .catch(() => {
      if (requestId === id && activeSession.value === session) {
        server.value = null
        serverPhase.value = 'error'
      }
    })
}

function onNetworkChange(): void { refresh() }
function onVisibilityChange(): void {
  if (!document.hidden) refresh()
}
watch(activeSession, () => refresh(), { immediate: true })
onMounted(() => {
  window.addEventListener('online', onNetworkChange)
  window.addEventListener('offline', onNetworkChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  ++requestId
  local.value = null
  server.value = null
  window.removeEventListener('online', onNetworkChange)
  window.removeEventListener('offline', onNetworkChange)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <section class="foundation-content storage-view" data-testid="data-storage-page">
    <header class="storage-heading">
      <RouterLink to="/settings" class="storage-back">Настройки</RouterLink>
      <h1>Данные и хранилище</h1>
      <p class="muted">Реальные локальные файлы и серверный учёт. Данные не расшифровываются для подсчёта.</p>
    </header>

    <template v-if="!activeSession">
      <div class="foundation-card" data-testid="storage-signed-out">
        <p>Для просмотра зашифрованной очереди требуется доступ к аккаунту.</p>
        <RouterLink to="/settings">Создать или восстановить аккаунт</RouterLink>
      </div>
    </template>
    <template v-else>
      <section class="foundation-card storage-section" aria-labelledby="storage-local-heading">
        <div class="storage-row">
          <h2 id="storage-local-heading">Файлы на устройстве</h2>
          <button type="button" data-testid="storage-refresh" @click="refresh">
            Обновить
          </button>
        </div>
        <p v-if="localPhase==='loading'" role="status" data-testid="storage-local-loading">
          Читаем зашифрованную очередь…
        </p>
        <p v-else-if="localPhase==='error'" role="alert" data-testid="storage-local-error">
          Не удалось проверить локальные зашифрованные файлы. Очередь не очищалась.
        </p>
        <div v-else-if="localPhase==='ready' && local"
          data-testid="storage-local-ready" class="storage-values">
          <div>
            <span>Ожидают отправки или повтора</span>
            <strong data-testid="storage-local-pending-count">{{ local.pendingCount }}</strong>
          </div>
          <div>
            <span>Объём ожидающего ciphertext</span>
            <strong data-testid="storage-local-pending-bytes">{{ formatBytes(local.pendingCipherBytes) }}</strong>
          </div>
          <div>
            <span>Требуют разрешения конфликта</span>
            <strong data-testid="storage-local-conflicts">{{ local.conflictedCount }}</strong>
          </div>
          <div>
            <span>Срок отправки истёк</span>
            <strong data-testid="storage-local-expired">{{ local.expiredPendingCount }}</strong>
          </div>
        </div>
        <p class="muted">Локальное сохранение не означает проверенную загрузку в облако.
          Не очищайте данные приложения до завершения синхронизации.</p>
        <RouterLink to="/browser" class="storage-link">Открыть Browser и очередь файлов</RouterLink>
      </section>

      <section class="foundation-card storage-section" aria-labelledby="storage-cloud-heading">
        <h2 id="storage-cloud-heading">Учёт облачных файлов</h2>
        <p v-if="serverPhase==='loading'" role="status" data-testid="storage-server-loading">
          Проверяем данные на сервере…
        </p>
        <p v-else-if="serverPhase==='offline'" role="status" data-testid="storage-server-offline">
          Нет подтверждённых онлайн-данных. Последний тариф и объём не показываются как актуальные.
        </p>
        <p v-else-if="serverPhase==='error'" role="alert" data-testid="storage-server-error">
          Серверный учёт недоступен; цифры не подтверждены.
        </p>
        <div v-else-if="serverPhase==='ready' && server"
          data-testid="storage-server-ready" class="storage-values">
          <div>
            <span>Тариф для новых операций</span>
            <strong data-testid="storage-effective-plan">{{ server.planId }}</strong>
          </div>
          <div>
            <span>Учтённые зашифрованные байты</span>
            <strong data-testid="storage-recorded-cipher-bytes">{{ formatBytes(server.recordedCipherBytes) }}</strong>
          </div>
          <div>
            <span>Учтённые активные файлы</span>
            <strong>{{ server.activeLogicalMediaFiles }}</strong>
          </div>
          <div>
            <span>Действующий серверный предел размера</span>
            <strong>{{ formatBytes(server.enforcedByteCeiling) }}</strong>
          </div>
          <p class="muted">Проверено: {{ server.asOfUtc }} (UTC). Учёт неатомарный;
            это не физический размер S3 и не разрешение на загрузку.</p>
        </div>
      </section>

      <section class="foundation-card storage-section" aria-labelledby="storage-backup-heading">
        <h2 id="storage-backup-heading">Резервные копии</h2>
        <p data-testid="storage-backup-unavailable">
          Восстановление из Recovery Vault ещё не принято. На этой странице
          резервные копии не создаются, не восстанавливаются и не удаляются.
        </p>
        <p class="muted">Очистка кэша не предлагается, пока нельзя безопасно отделить
          временные данные от несинхронизированных зашифрованных файлов.</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.storage-view{display:grid;gap:17px}
.storage-heading h1{margin:9px 0 4px;font-size:25px;letter-spacing:-.03em}
.storage-heading p{margin:0}
.storage-back,.storage-link{color:#bfeace;text-decoration:none;font-size:13px}
.storage-back:hover,.storage-link:hover{text-decoration:underline}
.storage-section{display:grid;gap:13px}
.storage-section h2{margin:0;font-size:17px}
.storage-section p{margin:0;line-height:1.55}
.storage-section .muted,.storage-heading .muted{color:#aab2ab;font-size:12px}
.storage-row{display:flex;justify-content:space-between;align-items:center;gap:12px}
.storage-row button{background:#293c2d;border:1px solid #477852;border-radius:7px;
  color:#d6f1dc;padding:9px 12px;cursor:pointer}
.storage-values{display:grid;gap:9px}
.storage-values>div{display:flex;justify-content:space-between;gap:12px;
  border-bottom:1px solid #303a32;padding-bottom:9px;align-items:baseline}
.storage-values span{font-size:12px;color:#b0beb2}
.storage-values strong{font-size:13px;text-align:right;word-break:break-word}
@media(max-width:410px){.storage-values>div{align-items:start;flex-direction:column;gap:3px}}
</style>
