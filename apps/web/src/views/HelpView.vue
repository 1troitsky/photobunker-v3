<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import HelpCenter from '../features/help/ui/HelpCenter.vue'
import type { HelpLocale } from '../features/help/domain/help-content'

const router = useRouter()
const locale = ref<HelpLocale>('ru')
function leaveHelp(): void { void router.push('/settings') }
</script>

<template>
  <section data-testid="help-shell-page" class="help-shell-view">
    <nav class="help-language-nav" aria-label="Язык справки">
      <RouterLink to="/install" class="help-install-link" data-testid="help-install-link">
        Установить PhotoBunker
      </RouterLink>
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
.help-install-link{display:inline-flex;align-items:center;text-decoration:none;min-height:38px;
  color:#b4dfbe;border:1px solid #424942;border-radius:7px;padding:8px 12px;font-size:12px}
.help-install-link:focus-visible{outline:2px solid #1ed760;outline-offset:2px}
.help-language-nav{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px;padding:12px 14px 0}
.help-language-nav button{min-height:38px;padding:8px 12px;border-radius:7px;
  border:1px solid #424942;background:#222;color:#bbb;cursor:pointer}
.help-language-nav button[aria-pressed=true]{border-color:#1ed760;color:#e3f5e6}
.help-language-nav button:focus-visible{outline:2px solid #1ed760;outline-offset:2px}
</style>
