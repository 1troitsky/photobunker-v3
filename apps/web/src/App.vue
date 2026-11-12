<script setup lang="ts">
import { useRoute } from 'vue-router'
import { brand } from './config/brand'
import {viewerShellActions} from './features/browser/application/viewer-shell-actions'
const route = useRoute()
function isActive(to:string):boolean {
  return route.path===to
    ||to==='/assignments'&&route.path.startsWith('/assignments/')
    ||to==='/browser'&&route.path.startsWith('/browser/')
}
// Canonical default only. User-editable 3–6 Dock (with mandatory Settings)
// belongs to accepted App Appearance 1.3 and will be wired in P2.
const dock = [
  { to: '/assignments', name: 'Задания', icon: 'tasks' },
  { to: '/browser', name: 'Browser', icon: 'folder' },
  { to: '/camera', name: 'Камера', icon: 'camera' },
  { to: '/contacts', name: 'Контакты', icon: 'users' },
  { to: '/settings', name: 'Настройки', icon: 'settings' },
] as const
</script>

<template>
  <div class="shell">
    <header class="shell-header">
      <span class="brand-mark" aria-hidden="true">{{ brand.mark }}</span>
      <div class="brand-copy">
        <strong>{{ brand.name }}</strong>
        <small><span class="status-dot" aria-hidden="true"></span>Подготовка</small>
      </div>
      <div class="shell-header-actions viewer-header-actions"
        v-if="route.name==='browser-viewer'" data-testid="viewer-shell-actions"
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
      <div class="shell-header-actions" v-else-if="route.path==='/contacts'">
        <button type="button" disabled aria-label="Blacklist — пока недоступен"
          title="Требует настоящего серверного отзыва полномочий">Blacklist</button>
      </div>
    </header>

    <main class="shell-main" :class="{'shell-main-viewer':route.name==='browser-viewer'}" id="main">
      <RouterView />
    </main>

    <nav class="shell-dock" aria-label="Главная навигация">
      <RouterLink
        v-for="item in dock" :key="item.to" :to="item.to"
        :class="{ active: isActive(item.to) }"
        :aria-current="isActive(item.to) ? 'page' : undefined"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <template v-if="item.icon === 'tasks'"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></template>
          <template v-else-if="item.icon === 'folder'"><path d="M3 6h7l2 3h9v11H3z"/></template>
          <template v-else-if="item.icon === 'camera'"><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="14" r="3"/></template>
          <template v-else-if="item.icon === 'users'"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M18 8a3 3 0 0 1 0 6M21 20v-2a5 5 0 0 0-4-4"/></template>
          <template v-else><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></template>
        </svg>
        <small>{{ item.name }}</small>
      </RouterLink>
    </nav>
  </div>
</template>
