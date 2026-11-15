<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { ref, watch } from 'vue'
import { activeSession } from '../../features/identity/application/session'
import { readLocalProfile } from '../../features/profile/application/local-profile'
import { settingsGroups } from './settings-navigation'

defineProps<{ online: boolean }>()
const localHandle=ref('')
let generation=0
watch(activeSession,async session=>{
  const current=++generation
  localHandle.value=''
  if(!session)return
  try{
    const profile=await readLocalProfile()
    if(current===generation&&activeSession.value?.accountId===session.accountId
      &&activeSession.value?.deviceId===session.deviceId)
      localHandle.value=profile.username?'@'+profile.username:(profile.name||'')
  }catch{ /* Never display unverified, unreadable or old-account profile data. */ }
},{immediate:true})
</script>

<template>
<section class="fieldwork-settings" data-testid="fieldwork-settings" aria-labelledby="settings-main-title">
  <header class="settings-head">
    <h1 id="settings-main-title">Настройки</h1>
  </header>

  <div class="account-overview">
    <RouterLink class="account-overview-link" to="/settings/profile"
      data-testid="settings-own-profile" aria-label="Открыть свой профиль">
      <span class="person-avatar" aria-hidden="true">{{localHandle?localHandle.replace(/^@/,'').slice(0,1).toUpperCase():'P'}}</span>
      <span class="account-copy">
        <strong>{{localHandle||'Мой аккаунт'}}</strong>
        <small>{{online?'Подтверждённая сессия':'Локальный режим'}} · Профиль на устройстве</small>
      </span>
      <svg class="row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </RouterLink>
    <a class="identity-link" href="#identity-access">Доступ и устройство</a>
  </div>

  <div class="settings-grid">
    <section v-for="group in settingsGroups" :key="group.id" class="settings-group"
      :aria-labelledby="'settings-group-'+group.id">
      <h2 class="group-title" :id="'settings-group-'+group.id">{{group.title}}</h2>
      <div class="settings-list">
        <template v-for="entry in group.entries" :key="entry.id">
          <RouterLink v-if="entry.to" :to="entry.to" class="settings-row"
            :data-testid="'settings-nav-'+entry.id">
            <span class="row-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                stroke-linecap="round" stroke-linejoin="round">
                <template v-if="entry.id==='contacts-teams'"><circle cx="8" cy="8" r="3"/><path d="M2 20v-2a6 6 0 0 1 12 0v2M17 7a3 3 0 0 1 0 6M21 20v-3a5 5 0 0 0-4-4"/></template>
                <template v-else-if="entry.id==='appearance'"><path d="M12 3a9 9 0 0 0 0 18h2a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.2h1a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="12" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="15.5" cy="8" r="1"/></template>
                <template v-else-if="entry.id==='notifications'"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></template>
                <template v-else-if="entry.id==='security-privacy'"><path d="M12 2 4 5v7c0 5.5 4 8.5 8 10 4-1.5 8-4.5 8-10V5z"/><path d="m9 12 2 2 4-4"/></template>
                <template v-else-if="entry.id==='data-storage'"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/></template>
                <template v-else-if="entry.id==='payments'"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></template>
                <template v-else-if="entry.id==='help'"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.3-1.5 2.5M12 17h.01"/></template>
                <template v-else><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></template>
              </svg>
            </span>
            <span class="row-copy"><strong>{{entry.label}}</strong><small>{{entry.description}}</small></span>
            <svg class="row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </RouterLink>
          <div v-else class="settings-row unavailable" aria-disabled="true"
            :data-testid="'settings-pending-'+entry.id">
            <span class="row-icon" aria-hidden="true">·</span>
            <span class="row-copy"><strong>{{entry.label}}</strong><small>{{entry.description}}</small></span>
            <span class="setting-planned">Позже</span>
          </div>
        </template>
      </div>
    </section>
  </div>
</section>
</template>
<style scoped>
/* Owner-approved Settings & Profile 1.6 menu structure and CSS from docs/ux/settings-profile. */
.settings-grid{display:grid;gap:20px}.settings-group{min-width:0}.group-title{font-size:11px;color:#a2a2a2;font-weight:720;letter-spacing:.025em;margin:0 0 9px 3px}.settings-list{background:var(--surface);border-radius:9px;overflow:hidden}.settings-row{display:flex;align-items:center;gap:12px;width:100%;min-height:55px;border:0;border-bottom:1px solid #343434;background:none;text-align:left;padding:11px 12px}.settings-row:last-child{border-bottom:0}.settings-row:hover{background:#292929}.row-icon{width:24px;height:24px;display:grid;place-items:center;color:#b5b5b5;flex:none}.row-icon svg{width:19px;height:19px}.row-copy{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}.row-copy strong{font-size:12.5px;font-weight:670}.row-copy small{color:#929292;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-chevron{color:#868686;width:16px;height:16px}.account-overview{display:flex;align-items:center;gap:12px;background:var(--surface);border:0;width:100%;padding:15px 13px;border-radius:9px;text-align:left;margin-bottom:22px}.account-overview:hover{background:#282828}.account-overview .person-avatar{width:48px;height:48px;flex:0 0 48px;font-size:18px}.account-copy{min-width:0;flex:1}.account-copy strong{font-size:15px;font-weight:760;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.account-copy span{color:#a2a2a2;font-size:11px;display:block;margin-top:3px}.account-overview>.row-chevron{width:19px;height:19px}
.fieldwork-settings{--surface:#202020;--green:#1ed760;width:100%}
.settings-head h1{font-size:27px;margin:0 0 22px;font-weight:800;letter-spacing:-.04em}
.account-overview{background:#202020;border-radius:10px;margin-bottom:25px}
.account-overview-link{display:flex;align-items:center;gap:13px;min-height:82px;padding:15px 15px;color:#f1f1f1;text-decoration:none}
.account-overview-link:hover,.settings-row:hover{background:#292929}
.account-overview-link .person-avatar{width:43px;height:43px;font-size:15px}
.account-overview-link .row-chevron{width:17px;height:17px;color:#aaa}
.account-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px}
.account-copy strong{font-size:14px}
.account-copy small{font-size:11px;color:#a6a6a6}
.identity-link{display:block;padding:8px 15px 13px;color:#b6e6c0;text-align:right;font-size:11px;text-decoration:none}
.settings-grid{grid-template-columns:minmax(0,1fr);gap:20px}
.settings-row{color:#f2f2f2;text-decoration:none;cursor:pointer}
.settings-row .row-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.settings-row .row-copy strong{font-weight:700}
.settings-row .row-copy small{font-size:11px;color:#a9a9a9;line-height:1.4}
.settings-row .row-icon{flex-shrink:0}
.settings-row .row-chevron{width:17px;height:17px;flex-shrink:0;color:#999}
.settings-row.unavailable{opacity:.5;cursor:default}
.setting-planned{color:#a5a5a5;font-size:10px}
.settings-row:focus-visible,.account-overview-link:focus-visible,.identity-link:focus-visible{outline:2px solid #9fe4b3;outline-offset:-2px}
@media(min-width:800px){.settings-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:390px){.settings-row{padding:11px 10px;gap:9px}.account-overview-link{padding:12px}}
</style>