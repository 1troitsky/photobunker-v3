<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { readPublicCatalog, type PublicPlan } from '../features/billing/application/catalog-client'
import { activeSession } from '../features/identity/application/session'
import { readBackupTechnicalStatus,type BackupTechnicalStatus }
  from '../features/storage/application/backup-technical-status'
import {
  filteredEncryptedQueue, readEncryptedLocalQueueDetails, readServerStorageUsage,
  retryPendingEncryptedQueue,
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
function filesNoun(count:number):string {
  const tail=count%100
  if(tail>=11&&tail<=14)return 'файлов'
  if(count%10===1)return 'файл'
  if(count%10>=2&&count%10<=4)return 'файла'
  return 'файлов'
}
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
const catalogPlan = shallowRef<PublicPlan | null>(null)
const backupStatus=shallowRef<BackupTechnicalStatus|null>(null)
const backupPhase=ref<Phase>('locked')
const cloudPercent = computed(() => server.value && server.value.enforcedByteCeiling>0
  ? Math.min(100,Math.round(server.value.recordedCipherBytes*100/server.value.enforcedByteCeiling))
  : null)
const fileMax = computed(()=>catalogPlan.value?.limits.maxMediaFiles??null)
// A missing/failed catalog is UNKNOWN, never an unlimited entitlement.
// Only the versioned, verified catalog's Unlimited plans may render it.
const unlimitedFileQuota = computed(()=>!!catalogPlan.value
  &&(catalogPlan.value.planId==='unlimited'
    ||catalogPlan.value.planId==='unlimited_plus')
  &&catalogPlan.value.limits.maxMediaFiles===null)
const fileQuotaConfirmed = computed(()=>fileMax.value!==null||unlimitedFileQuota.value)
const fileQuotaDenominator = computed(()=>{
  if(unlimitedFileQuota.value)return 'Без ограничения'
  if(fileMax.value===null)return 'Лимит не подтверждён'
  return String(fileMax.value)
})
const filePercent = computed(()=>fileMax.value!==null && fileMax.value>0 && server.value
  ? Math.min(100,Math.round(server.value.activeLogicalMediaFiles*100/fileMax.value))
  : null)
const estimatedCloudAfterQueue = computed(()=>server.value && local.value
  ? formatBytes(server.value.recordedCipherBytes+local.value.pendingCipherBytes)
  : null)
const localPhase = ref<Phase>('locked')
const serverPhase = ref<Phase>('locked')
const onlineNow = ref(typeof navigator !== 'undefined' && navigator.onLine)
const retryBusy = ref(false)
const retryNotice = ref('')
const retryError = ref('')
const canRetry = computed(() => !!activeSession.value?.online && onlineNow.value
  && localPhase.value === 'ready' && (local.value?.pendingCount ?? 0) > 0
  && !retryBusy.value)
let retryToken = 0
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
  catalogPlan.value = null
  backupStatus.value=null
  if (!session) {
    queueOpen.value = false
    queueFilter.value = 'all'
    retryNotice.value = ''
    retryError.value = ''
    localPhase.value = 'locked'
    serverPhase.value = 'locked'
    backupPhase.value='locked'
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
    backupPhase.value='offline'
    return
  }
  serverPhase.value = 'loading'
  backupPhase.value='loading'
  void readBackupTechnicalStatus()
    .then(value=>{
      if(requestId===id&&activeSession.value===session){
        backupStatus.value=value
        backupPhase.value='ready'
      }
    })
    .catch(()=>{
      if(requestId===id&&activeSession.value===session){
        backupStatus.value=null
        backupPhase.value='error'
      }
    })
  void readServerStorageUsage(session)
    .then(result => {
      if (requestId === id && activeSession.value === session) {
        server.value = result
        serverPhase.value = 'ready'
        // Public, versioned catalog supplies plan file limits; never fabricate
        // a denominator when the catalog is missing or not verified.
        void readPublicCatalog()
          .then(plans=>{
            if(requestId===id && activeSession.value===session)
              catalogPlan.value=plans.find(plan=>plan.planId===result.planId)??null
          })
          .catch(()=>{
            if(requestId===id&&activeSession.value===session)
              catalogPlan.value=null
          })
      }
    })
    .catch(() => {
      if (requestId === id && activeSession.value === session) {
        server.value = null
        serverPhase.value = 'error'
      }
    })
}

async function retryQueue(): Promise<void> {
  const session = activeSession.value
  if (!session || !canRetry.value) return
  const token = ++retryToken
  retryBusy.value = true
  retryNotice.value = ''
  retryError.value = ''
  try {
    const result = await retryPendingEncryptedQueue(session)
    if (token !== retryToken || activeSession.value !== session) return
    if (result.blockedPhoto) {
      retryError.value = 'Есть просроченные фото. Повтор для фото не запускался: старый загрузчик не умеет исключать отдельные записи. Остальные допустимые файлы обработаны.'
    } else if (!result.attempted) {
      retryNotice.value = 'Нет допустимых файлов для повтора.'
    } else if (result.failed || result.details.summary.pendingCount > 0) {
      retryNotice.value = 'Повтор завершён, но часть файлов ещё ожидает отправки. Данные остались зашифрованными на устройстве.'
    } else {
      retryNotice.value = 'Повтор завершён. В локальной очереди больше нет ожидающих файлов. Серверный учёт проверяется отдельно.'
    }
  } catch {
    if (token === retryToken && activeSession.value === session)
      retryError.value = 'Не удалось завершить повтор. Зашифрованные файлы не удалены.'
  } finally {
    if (token === retryToken && activeSession.value === session) {
      retryBusy.value = false
      refresh()
    }
  }
}
function onNetworkChange(): void {
  onlineNow.value = typeof navigator !== 'undefined' && navigator.onLine
  refresh()
}
function onVisibilityChange(): void {
  if (!document.hidden) refresh()
}
watch(activeSession, () => {
  ++retryToken
  retryBusy.value = false
  retryNotice.value = ''
  retryError.value = ''
  refresh()
}, { immediate: true })
onMounted(() => {
  window.addEventListener('online', onNetworkChange)
  window.addEventListener('offline', onNetworkChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  ++requestId
  ++retryToken
  retryBusy.value = false
  retryNotice.value = ''
  retryError.value = ''
  local.value = null
  queueEntries.value = []
  queueOpen.value = false
  server.value = null
  backupStatus.value=null
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

        <div v-if="localPhase==='ready'" class="queue-summary" data-testid="storage-queue-summary">
          <div class="queue-quick">
            <button type="button" class="storage-queue-open" data-testid="storage-open-queue"
              :aria-expanded="queueOpen" aria-controls="storage-queue-detail"
              @click="queueOpen=!queueOpen">
              {{queueOpen?'Скрыть очередь':'Открыть очередь'}}
            </button>
            <strong class="queue-amount">{{pendingQueueTotal}} {{filesNoun(pendingQueueTotal)}} · {{formatBytes(local?.pendingCipherBytes??0)}}</strong>
          </div>
          <p class="queue-footnote">Очередь состоит из локальных зашифрованных файлов и пока не учтена как занятое место в облаке.</p>
          <p v-if="estimatedCloudAfterQueue" class="queue-footnote">
            При успешной отправке всех ожидающих материалов общий объём составит примерно {{estimatedCloudAfterQueue}}.
            Это оценка, не подтверждённая сервером квота и не обещание загрузки.
          </p>
        </div>
        <section v-if="queueOpen && localPhase==='ready'" id="storage-queue-detail"
          class="storage-queue-detail" data-testid="storage-queue-detail"
          aria-label="Очередь зашифрованных файлов">
          <div class="storage-row storage-retry-row">
            <button type="button" data-testid="storage-retry-queue"
              :disabled="!canRetry" @click="retryQueue">
              {{ retryBusy ? 'Повторяем отправку…' : 'Повторить отправку ожидающих' }}
            </button>
          </div>
          <p v-if="retryNotice" role="status" data-testid="storage-retry-notice" class="muted">
            {{ retryNotice }}
          </p>
          <p v-if="retryError" role="alert" data-testid="storage-retry-error">
            {{ retryError }}
          </p>
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
        <h2 id="storage-cloud-heading">Используемые лимиты</h2>
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
          <div class="quota-block" data-testid="storage-cloud-quota">
            <div class="quota-metric">
              <strong>Зашифрованное облако</strong>
              <span>{{formatBytes(server.recordedCipherBytes)}} / {{formatBytes(server.enforcedByteCeiling)}} · {{cloudPercent}}%</span>
            </div>
            <progress class="bar" :value="cloudPercent??0" max="100"
              aria-label="Использованный объём зашифрованного облака"></progress>
            <p class="quota-note">Предел подтверждён сервером. Кэш и ожидающая отправки очередь не входят в использованный объём облака.</p>
          </div>
          <div class="quota-block" data-testid="storage-files-quota">
            <div class="quota-metric">
              <strong>Файлы</strong>
              <span data-testid="storage-file-quota-denominator">
                {{server.activeLogicalMediaFiles}} / {{fileQuotaDenominator}}
                <template v-if="filePercent!==null"> · {{filePercent}}%</template>
              </span>
            </div>
            <progress v-if="fileQuotaConfirmed" class="bar"
              data-testid="storage-file-quota-progress"
              :value="filePercent??0" max="100"
              :aria-label="unlimitedFileQuota
                ?'Количество файлов не ограничено подтверждённым тарифом'
                :'Использованный лимит количества файлов'"></progress>
            <p class="quota-note" data-testid="storage-file-quota-note">
              {{unlimitedFileQuota
                ?'Количество файлов не ограничено подтверждённым тарифом; ограничения на облачное хранение действуют.'
                :fileMax===null
                  ?'Не удалось подтвердить квоту файлов по тарифному каталогу. Это не означает безлимит.'
                  :'Доля от лимита количества файлов по действующему тарифному каталогу.'}}
            </p>
          </div>
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
        <div class="backup-cards">
          <div v-if="backupPhase==='loading'" class="backup-technical"
            role="status" data-testid="storage-backup-technical-loading">
            Проверяем технические лимиты на сервере…
          </div>
          <div v-else-if="backupPhase==='ready'&&backupStatus"
            class="backup-technical" data-testid="storage-backup-technical-ready">
            <strong>Техническая проверка запуска резервной копии</strong>
            <span v-if="backupStatus.technicalGate==='clear'">
              Ограничение частоты запуска сейчас не препятствует запросу.
            </span>
            <span v-else-if="backupStatus.technicalGate==='cooldown'">
              Действует техническая пауза между запусками.
            </span>
            <span v-else>На сервере зарегистрирована активная техническая операция.</span>
            <span v-if="backupStatus.nextTechnicalStartAt">
              Следующая возможная попытка: {{backupStatus.nextTechnicalStartAt}} (UTC).
            </span>
            <small>Это только проверка технических ограничений. Она не подтверждает
              существование копии, право на запуск или работоспособность восстановления.</small>
          </div>
          <p v-else-if="backupPhase==='error'" class="muted"
            role="alert" data-testid="storage-backup-technical-error">
            Технические ограничения резервных копий не подтверждены сервером.
          </p>
          <p v-else-if="backupPhase==='offline'" class="muted" role="status">
            Офлайн: статус технических ограничений резервных копий неизвестен.
          </p>
          <div class="backup-empty" data-testid="storage-backup-unavailable">
            Нет проверенных копий для отображения. До завершения безопасного
            восстановления отсюда нельзя создавать, заменять или удалять резервные копии.
          </div>
        </div>
        <button type="button" disabled class="storage-backup-manage">Управление копиями и автообновлением</button>
      </section>
      <section class="foundation-card storage-section" aria-labelledby="storage-cache-heading">
        <h2 id="storage-cache-heading">Зашифрованный кэш</h2>
        <p class="muted">Миниатюры и временные данные для быстрого просмотра.</p>
        <div class="cache-usage"><span>Объём: не измерен</span>
          <button type="button" disabled title="Очистка будет доступна после подтверждения границ кэша">
            Очистить кэш
          </button>
        </div>
        <label for="storage-cache-range" class="muted">Размер кэша</label>
        <input id="storage-cache-range" type="range" min="0" max="2" value="1" disabled
          class="cache-range" aria-label="Размер зашифрованного кэша">
        <p class="muted">Очистка не должна удалять несинхронизированные файлы,
          Recovery Key или локальные оригиналы. Пока разделение не проверено,
          разрушительные действия недоступны.</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.storage-view{display:grid;gap:17px}
.storage-view .quota-block{display:block;text-align:left;width:100%;padding:12px 0}
.storage-view .quota-block+.quota-block{border-top:1px solid #363636}
.storage-view .quota-metric{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.storage-view .quota-metric strong{font-size:13px;font-weight:750;text-align:left}
.storage-view .quota-metric span{font-size:11px;color:#b2bdb3}
.storage-view .bar{display:block;width:100%;height:9px;margin:10px 0;border-radius:5px;accent-color:var(--accent)}
.storage-view .quota-note{font-size:11px;color:#9da9a0;line-height:1.5;margin:8px 0 0}
.storage-view .queue-summary{border-top:1px solid #363636;margin-top:13px;padding-top:13px}
.storage-view .queue-quick{display:flex;align-items:center;justify-content:space-between;gap:10px}
.storage-view .queue-amount{font-size:12px;font-weight:710;color:#e8ece8;text-align:right}
.storage-view .queue-footnote{font-size:11px;color:#a5b0a8;line-height:1.5;margin:8px 0 0}
.storage-view .backup-cards{display:grid;gap:9px}
.storage-view .backup-technical{display:grid;gap:8px;padding:14px;
  border:1px solid #3e5944;background:#233126;border-radius:9px;color:#d6e6d9;font-size:12px}
.storage-view .backup-technical strong{font-size:12px;color:#ddf5e2}
.storage-view .backup-technical small{color:#a5b4a8;line-height:1.6}
.storage-view .backup-empty{padding:15px;background:#252525;border:1px solid #383838;border-radius:9px;font-size:12px;color:#b7c2b9}
.storage-view .storage-backup-manage,.storage-view .cache-usage button{background:#2c332d;border:1px solid #494f49;border-radius:8px;color:#b5c0b6;padding:10px}
.storage-view .cache-usage{display:flex;gap:12px;align-items:center;justify-content:space-between}
.storage-view .cache-range{accent-color:var(--accent);width:100%}
.storage-heading h1{margin:9px 0 4px;font-size:25px;letter-spacing:-.03em}
.storage-heading p{margin:0}
.storage-back,.storage-link{color:#bfeace;text-decoration:none;font-size:13px}
.storage-back:hover,.storage-link:hover{text-decoration:underline}
.storage-section{display:grid;gap:13px}
.storage-section h2{margin:0;font-size:17px}
.storage-retry-row button{background:#293c2d;border:1px solid #477852;border-radius:7px;
  color:#d6f1dc;padding:9px 12px;cursor:pointer}
.storage-retry-row button:disabled{opacity:.45;cursor:not-allowed}
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
