<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeSession } from '../features/identity/application/session'
import {
  filteredEncryptedQueue, readEncryptedLocalQueueDetails, readServerStorageUsage,
  type EncryptedQueueEntry, type QueueDisplayFilter,
  type LocalStorageSummary, type ServerStorageUsage,
} from '../features/storage/application/storage-status'

type Phase = 'locked' | 'loading' | 'ready' | 'error' | 'offline'
const local = shallowRef<LocalStorageSummary | null>(null)
const queueEntries = shallowRef<readonly EncryptedQueueEntry[]>([])
const queueOpen = ref(false)
const queueFilter = ref<QueueDisplayFilter>('all')
const queueFilters: readonly { id: QueueDisplayFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'Ожидают' },
  { id: 'conflict', label: 'Конфликты' },
  { id: 'expired', label: 'Истекли' },
]
const matchingEntries = computed(() => filteredEncryptedQueue(queueEntries.value, queueFilter.value))
const visibleEntries = computed(() => matchingEntries.value.slice(0, 50))
const pendingQueueTotal = computed(() => local.value
  ? local.value.pendingCount + local.value.conflictedCount + local.value.expiredPendingCount : 0)
const fileKind = (kind: EncryptedQueueEntry['kind']): string => ({
  photo: 'Фото', video: 'Видео', audio: 'Аудио',
})[kind]
const fileStatus = (status: EncryptedQueueEntry['status']): string => ({
  queued: 'Ожидает отправки', retry: 'Ожидает повтора',
  conflict: 'Требует внимания', expired: 'Срок истёк',
  synced: 'Синхронизирован',
})[status]
function safeLocalDate(value: number): string {
  return new Date(value).toLocaleString('ru-RU')
}
function opaqueSuffix(key: string): string {
  return key.slice(-8)
}
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
  queueEntries.value = []
  server.value = null
  if (!session) {
    queueOpen.value = false
    queueFilter.value = 'all'
    localPhase.value = 'locked'
    serverPhase.value = 'locked'
    return
  }
  localPhase.value = 'loading'
  // The local encrypted queue remains visible without trusting the network.
  void readEncryptedLocalQueueDetails()
    .then(result => {
      if (requestId === id && activeSession.value === session) {
        local.value = result.summary
        queueEntries.value = result.entries
        localPhase.value = 'ready'
      }
    })
    .catch(() => {
      if (requestId === id && activeSession.value === session) {
        local.value = null
        queueEntries.value = []
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
  queueEntries.value = []
  queueOpen.value = false
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

        <button v-if="localPhase==='ready'" type="button"
          class="storage-queue-open" data-testid="storage-open-queue"
          :aria-expanded="queueOpen" aria-controls="storage-queue-detail"
          @click="queueOpen=!queueOpen">
          {{ queueOpen ? 'Скрыть очередь' : 'Открыть очередь' }} ({{ pendingQueueTotal }})
        </button>
        <section v-if="queueOpen && localPhase==='ready'" id="storage-queue-detail"
          class="storage-queue-detail" data-testid="storage-queue-detail"
          aria-label="Очередь зашифрованных файлов">
          <div class="storage-queue-filters" role="group" aria-label="Фильтр очереди">
            <button v-for="filter in queueFilters" :key="filter.id" type="button"
              :data-testid="'storage-queue-filter-'+filter.id"
              :aria-pressed="queueFilter===filter.id"
              @click="queueFilter=filter.id">{{ filter.label }}</button>
          </div>
          <p v-if="matchingEntries.length===0" data-testid="storage-queue-empty" class="muted">
            В этом разделе нет ожидающих зашифрованных файлов.
          </p>
          <ul v-else class="storage-queue-list" data-testid="storage-queue-list">
            <li v-for="entry in visibleEntries" :key="entry.key"
              class="storage-queue-item" data-testid="storage-queue-item">
              <div class="storage-queue-identity">
                <strong>{{ fileKind(entry.kind) }} · {{ opaqueSuffix(entry.key) }}</strong>
                <small>{{ safeLocalDate(entry.createdAt) }}</small>
              </div>
              <div class="storage-queue-state">
                <strong data-testid="storage-queue-state">{{ fileStatus(entry.status) }}</strong>
                <small>{{ formatBytes(entry.ciphertextBytes) }} шифротекста</small>
              </div>
            </li>
          </ul>
          <p v-if="matchingEntries.length>visibleEntries.length" class="muted"
            data-testid="storage-queue-bounded">
            Показаны 50 из {{ matchingEntries.length }} записей. Полный каталог доступен в Browser.
          </p>
          <p class="muted">В списке нет имён файлов, GPS, комментариев и других
            приватных метаданных. Показаны только локальные зашифрованные записи;
            состояние облака проверяется отдельно.</p>
        </section>
        <RouterLink to="/browser" class="storage-link">Открыть Browser</RouterLink>
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
.storage-queue-open{background:#293c2d;border:1px solid #477852;border-radius:7px;
  color:#d6f1dc;padding:11px 13px;text-align:left;cursor:pointer}
.storage-queue-detail{display:grid;gap:12px}
.storage-queue-filters{display:flex;flex-wrap:wrap;gap:6px}
.storage-queue-filters button{border:1px solid #434e44;border-radius:7px;
  color:#d3ded4;background:transparent;padding:6px 10px;cursor:pointer}
.storage-queue-filters button[aria-pressed='true']{background:#293c2d;
  border-color:#477852;color:#e3f4e6}
.storage-queue-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.storage-queue-item{display:flex;justify-content:space-between;align-items:center;gap:12px;
  border:1px solid #343c35;border-radius:8px;padding:11px}
.storage-queue-identity,.storage-queue-state{display:grid;gap:5px}
.storage-queue-item strong{font-size:12px}
.storage-queue-item small{font-size:11px;color:#aab7ab}
.storage-queue-state{text-align:right}
.storage-values{display:grid;gap:9px}
.storage-values>div{display:flex;justify-content:space-between;gap:12px;
  border-bottom:1px solid #303a32;padding-bottom:9px;align-items:baseline}
.storage-values span{font-size:12px;color:#b0beb2}
.storage-values strong{font-size:13px;text-align:right;word-break:break-word}
@media(max-width:410px){.storage-values>div{align-items:start;flex-direction:column;gap:3px}}
</style>
