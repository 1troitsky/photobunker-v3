<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import HelpCenter from '../features/help/ui/HelpCenter.vue'
import type { HelpLocale } from '../features/help/domain/help-content'

const router = useRouter()
const locale = ref<HelpLocale>('ru')
function leaveHelp(): void { void router.push('/settings') }
</script>

<template>
  <section data-testid="help-shell-page" class="help-shell-view">
    <nav class="help-language-nav" aria-label="Язык справки">
      <button type="button" :aria-pressed="locale==='ru'"
        data-testid="help-language-ru" @click="locale='ru'">Русский</button>
      <button type="button" :aria-pressed="locale==='en'"
        data-testid="help-language-en" @click="locale='en'">English</button>
    </nav>
    <HelpCenter :key="locale" :locale="locale" @back="leaveHelp"/>
  </section>
</template>

<style scoped>
.help-shell-view{width:100%;min-width:0;margin:0 auto;max-width:980px}
.help-language-nav{display:flex;justify-content:flex-end;gap:7px;padding:12px 14px 0}
.help-language-nav button{min-height:38px;padding:8px 12px;border-radius:7px;
  border:1px solid #424942;background:#222;color:#bbb;cursor:pointer}
.help-language-nav button[aria-pressed=true]{border-color:#1ed760;color:#e3f5e6}
.help-language-nav button:focus-visible{outline:2px solid #1ed760;outline-offset:2px}
</style>
