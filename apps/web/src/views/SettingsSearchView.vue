<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { searchSettings } from '../ui/fieldwork/settings-search'

const route = useRoute()
const router = useRouter()
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const searchInput = ref<HTMLInputElement | null>(null)
const results = computed(() => searchSettings(query.value))
const implemented = computed(() => results.value.filter(row => row.to !== null))
const planned = computed(() => results.value.filter(row => row.to === null))

watch(() => route.query.q, value => {
  const next = typeof value === 'string' ? value : ''
  if (next !== query.value) query.value = next
})
watch(query, value => {
  // Replace never adds one history entry per typed character.
  const current = typeof route.query.q === 'string' ? route.query.q : ''
  if (value === current) return
  void router.replace({path:'/settings/search',query:value ? {q:value} : {}})
})
onMounted(async () => {
  await nextTick()
  searchInput.value?.focus()
})
</script>

<template>
  <section class="settings-search" data-testid="settings-search-page">
    <header class="search-heading">
      <h1>Поиск по настройкам</h1>
      <p>Поиск по названиям настроек на русском и английском</p>
    </header>

    <label class="search-label" for="settings-search-input">Найти настройку</label>
    <input id="settings-search-input" ref="searchInput" v-model="query"
      type="search" maxlength="200" placeholder="Например: dock, панель, язык"
      autocomplete="off" spellcheck="false" data-testid="settings-search-input">

    <p v-if="query.trim()" class="result-count" data-testid="settings-search-count">
      Найдено: {{ results.length }}
    </p>
    <p v-else class="result-count">Доступные настройки</p>

    <div v-if="implemented.length" class="search-results">
      <RouterLink v-for="entry in implemented" :key="entry.id" :to="entry.to!"
        class="search-row" :data-testid="'settings-search-result-'+entry.id">
        <span class="row-content">
          <small>{{ entry.group }}</small>
          <strong>{{ entry.label }}</strong>
          <span>{{ entry.description }}</span>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"
          stroke="currentColor" stroke-width="1.8"><path d="m9 18 6-6-6-6"/></svg>
      </RouterLink>
    </div>

    <section v-if="planned.length" class="pending-results" aria-labelledby="pending-search-title">
      <h2 id="pending-search-title">Ещё не подключено</h2>
      <div v-for="entry in planned" :key="entry.id" class="search-row planned"
        aria-disabled="true" :data-testid="'settings-search-pending-'+entry.id">
        <span class="row-content">
          <small>{{ entry.group }}</small>
          <strong>{{ entry.label }}</strong>
          <span>{{ entry.description }}</span>
        </span>
        <span class="later-badge">Позже</span>
      </div>
    </section>

    <p v-if="!results.length" class="empty-results" role="status">
      Такой настройки не найдено.
    </p>
    <p class="search-footnote">
      Неработающие страницы не открываются. Поиск не отправляет данные на сервер.
    </p>
  </section>
</template>

<style scoped>
.settings-search{width:100%;max-width:780px;margin:0 auto;padding:28px 16px 45px}
.search-heading h1{font-size:26px;margin:0;letter-spacing:-.035em}
.search-heading p{font-size:12px;color:#a9aea9;margin:6px 0 26px}
.search-label{display:block;font-size:12px;color:#c6d0c8;margin-bottom:8px}
.settings-search input{width:100%;min-height:44px;padding:11px 13px;
 border:1px solid #555e57;border-radius:9px;background:#232723;color:#f7faf7;
 font:inherit;font-size:14px}
.settings-search input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.result-count{font-size:12px;color:#a9aea9;margin:23px 2px 9px}
.search-results,.pending-results{background:#202020;border-radius:9px;overflow:hidden}
.search-row{display:flex;align-items:center;gap:8px;min-height:70px;
 text-decoration:none;border-bottom:1px solid #333c35;padding:12px 14px}
.search-row:last-child{border-bottom:0}
a.search-row:hover{background:#29342c}
a.search-row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.search-row svg{width:17px;height:17px;flex:0 0 17px;color:#94cc9e}
.row-content{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}
.row-content strong{font-size:13px;color:#f2f6f3}
.row-content small{font-size:10px;color:#95aa99}
.row-content span{font-size:11px;color:#a8b5ab;line-height:1.5}
.pending-results{margin-top:19px}
.pending-results h2{padding:14px 14px 9px;margin:0;
 color:#abb6ac;font-size:12px;border-bottom:1px solid #333c35}
.search-row.planned{opacity:.72}
.later-badge{font-size:11px;color:#c1c6c1}
.empty-results{padding:16px;color:#b5c3b6;border-radius:9px;background:#202020;font-size:13px}
.search-footnote{margin-top:20px;color:#9aa89d;font-size:11px;line-height:1.6}
</style>
