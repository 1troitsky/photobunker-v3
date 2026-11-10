<script setup lang="ts">
import {computed,watch} from 'vue'
import {useRoute} from 'vue-router'
import {brand} from './config/brand'
import {activeSession} from './features/identity/application/session'
import {
  DOCK_CATALOG,visibleDock,loadDock,
} from './features/appearance/application/dock-preferences'
const route=useRoute()
const dock=computed(()=>visibleDock.value.map(id=>DOCK_CATALOG.find(x=>x.id===id)!))
// Local-only bootstrap. Neither Fieldwork Shell nor camera waits for network.
watch(()=>{const s=activeSession.value
  return s?[s.accountId,s.deviceId,s.pkg.akek,s.pkg.accountSpki,s.pkg.revision].join('|'):''
},()=>{void loadDock().catch(()=>{/* error exposed in Appearance settings */})},
{immediate:true})
</script>

<template>
  <div class="shell">
    <header class="shell-header">
      <span class="brand-mark" aria-hidden="true">{{ brand.mark }}</span>
      <div class="brand-copy">
        <strong>{{ brand.name }}</strong>
        <small><span class="status-dot" aria-hidden="true"></span>Подготовка</small>
      </div>
      <div class="shell-header-actions" v-if="route.path==='/contacts'">
        <button type="button" disabled aria-label="Blacklist — пока недоступен"
          title="Требует настоящего серверного отзыва полномочий">Blacklist</button>
      </div>
    </header>

    <main class="shell-main" id="main">
      <RouterView />
    </main>

    <nav class="shell-dock" aria-label="Главная навигация"
      :style="{gridTemplateColumns:'repeat('+dock.length+',minmax(0,1fr))'}">
      <RouterLink
        v-for="item in dock" :key="item.to" :to="item.to"
        :class="{ active: (route.path === item.to || (item.to === '/assignments' && route.path.startsWith('/assignments/')) || (item.to === '/settings' && route.path.startsWith('/settings/'))) }"
        :aria-current="(route.path === item.to || (item.to === '/assignments' && route.path.startsWith('/assignments/'))) ? 'page' : undefined"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <template v-if="item.icon === 'tasks'"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></template>
          <template v-else-if="item.icon === 'folder'"><path d="M3 6h7l2 3h9v11H3z"/></template>
          <template v-else-if="item.icon === 'camera'"><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="14" r="3"/></template>
          <template v-else-if="item.icon === 'users'"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M18 8a3 3 0 0 1 0 6M21 20v-2a5 5 0 0 0-4-4"/></template>
          <template v-else-if="item.icon === 'message'"><path d="M4 5h16v12H9l-5 4zM8 10h8M8 13h5"/></template>
          <template v-else><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></template>
        </svg>
        <small>{{ item.label }}</small>
      </RouterLink>
    </nav>
  </div>
</template>
