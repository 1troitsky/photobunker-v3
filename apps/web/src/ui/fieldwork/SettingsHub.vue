<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { settingsGroups } from './settings-navigation'

defineProps<{ online: boolean }>()
</script>

<template>
  <section class="fieldwork-settings" data-testid="fieldwork-settings"
    aria-labelledby="settings-main-title">
    <header class="settings-head">
      <h1 id="settings-main-title">Настройки</h1>
      <p>Профиль, приложение и управление аккаунтом</p>
    </header>

    <div class="account-summary">
      <span class="account-symbol" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="12" cy="8" r="3.5"/>
          <path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2"/>
        </svg>
      </span>
      <span class="account-copy">
        <strong>Мой аккаунт</strong>
        <small>{{ online ? 'Доступ активен' : 'Локальный режим' }}</small>
      </span>
      <a class="account-access-link" href="#identity-access">
        Доступ и устройство
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </a>
    </div>

    <div class="settings-groups">
      <section v-for="group in settingsGroups" :key="group.id" class="setting-group"
        :aria-labelledby="'settings-group-'+group.id">
        <h2 :id="'settings-group-'+group.id">{{ group.title }}</h2>
        <div class="setting-list">
          <template v-for="entry in group.entries" :key="entry.id">
            <RouterLink v-if="entry.to" class="setting-row" :to="entry.to"
              :data-testid="'settings-nav-'+entry.id">
              <span class="setting-row-copy">
                <strong>{{ entry.label }}</strong>
                <small>{{ entry.description }}</small>
              </span>
              <svg class="row-chevron" aria-hidden="true"
                viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.8">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </RouterLink>
            <div v-else class="setting-row unavailable" aria-disabled="true"
              :data-testid="'settings-pending-'+entry.id">
              <span class="setting-row-copy">
                <strong>{{ entry.label }}</strong>
                <small>{{ entry.description }}</small>
              </span>
              <span class="setting-planned">Позже</span>
            </div>
          </template>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.fieldwork-settings {
  --settings-panel: #202020;
  --settings-line: #303030;
  --settings-muted: #a2a2a2;
  width: 100%;
}
.settings-head h1 {
  font-size: 28px;
  font-weight: 780;
  letter-spacing: -.04em;
  margin: 0;
}
.settings-head p {
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--settings-muted);
}
.account-summary {
  margin: 19px 0 28px;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 17px;
  border-radius: 10px;
  background: var(--settings-panel);
  border: 1px solid var(--settings-line);
}
.account-symbol {
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #35473b;
  color: #c4e9d0;
}
.account-symbol svg { width: 25px; height: 25px; }
.account-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.account-copy strong { font-size: 14px; font-weight: 730; }
.account-copy small { font-size: 12px; color: var(--settings-muted); }
.account-access-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #bfeace;
  text-decoration: none;
  padding: 7px 5px;
}
.account-access-link svg { width: 16px; height: 16px; }
.account-access-link:hover { text-decoration: underline; }
.settings-groups {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  column-gap: 18px;
  row-gap: 18px;
}
.setting-group { min-width: 0; }
.setting-group h2 {
  margin: 0 0 8px 3px;
  color: var(--settings-muted);
  font-size: 11px;
  font-weight: 720;
  letter-spacing: .02em;
}
.setting-list {
  background: var(--settings-panel);
  border-radius: 9px;
  overflow: hidden;
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 58px;
  padding: 12px 13px;
  color: #f3f3f3;
  text-decoration: none;
  border-bottom: 1px solid var(--settings-line);
}
.setting-row:last-child { border-bottom: 0; }
a.setting-row:hover { background: #292f2b; }
a.setting-row:focus-visible, .account-access-link:focus-visible {
  outline: 2px solid #1ed760;
  outline-offset: -3px;
}
.setting-row-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.setting-row-copy strong { font-size: 13px; font-weight: 680; }
.setting-row-copy small { font-size: 11px; color: var(--settings-muted); }
.row-chevron { flex: 0 0 16px; width: 16px; height: 16px; color: #a2aba5; }
.setting-row.unavailable { color: #b3bab5; }
.setting-row.unavailable strong { color: #b3bab5; }
.setting-row.unavailable small { color: #828b85; }
.setting-planned {
  font-size: 11px;
  white-space: nowrap;
  color: #8b978f;
}
@media (min-width: 750px) {
  .settings-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 430px) {
  .account-summary { flex-wrap: wrap; }
  .account-access-link { flex: 1 1 100%; justify-content: flex-end; }
}
@media (prefers-reduced-motion: reduce) {
  .fieldwork-settings * { scroll-behavior: auto; }
}
</style>
