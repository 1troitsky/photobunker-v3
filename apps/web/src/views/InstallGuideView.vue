<script setup lang="ts">
import {onMounted,ref} from 'vue'
import {RouterLink} from 'vue-router'

type Platform='ios'|'android'|'desktop'
const platform=ref<Platform>('ios')
const origin=ref('')
onMounted(()=>{
  // Use the actual app origin. The owner-approved example domain in docs/ux
  // was not a verified production deployment or installability guarantee.
  origin.value=window.location.origin
})
</script>
<template>
<div class="install-public-page" data-testid="install-guide-page">
  <header class="site-head">
    <RouterLink to="/welcome" class="site-logo" aria-label="PhotoBunker — главная">
      <span class="site-logo-mark" aria-hidden="true">
        <svg viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="3">
          <rect x="9" y="17" width="54" height="39" rx="10"/>
          <path d="m19 17 5-7h24l5 7"/>
          <circle cx="36" cy="37" r="13"/>
        </svg>
      </span><strong>PhotoBunker</strong>
    </RouterLink>
    <RouterLink to="/welcome" class="install-home-link">Открыть приложение</RouterLink>
  </header>
  <main class="app-explain">
    <div class="app-icon" aria-hidden="true">
      <svg viewBox="0 0 72 72" fill="none" stroke="#c6f1cf" stroke-width="3">
        <rect x="9" y="17" width="54" height="39" rx="10"/>
        <path d="m19 17 5-7h24l5 7"/>
        <circle cx="36" cy="37" r="13"/>
      </svg>
    </div>
    <h1>PhotoBunker всегда под рукой</h1>
    <p>Снимайте, организуйте задания и делитесь файлами. Когда поддерживается установка,
      веб-приложение можно добавить через браузер.</p>
    <div class="install-choices" role="group" aria-label="Выберите устройство">
      <button type="button" :class="{selected:platform==='ios'}"
        :aria-pressed="platform==='ios'" data-testid="install-ios" @click="platform='ios'">iPhone</button>
      <button type="button" :class="{selected:platform==='android'}"
        :aria-pressed="platform==='android'" data-testid="install-android" @click="platform='android'">Android</button>
      <button type="button" :class="{selected:platform==='desktop'}"
        :aria-pressed="platform==='desktop'" data-testid="install-desktop" @click="platform='desktop'">Компьютер</button>
    </div>
    <section class="install-guide" data-testid="install-platform-guide" aria-live="polite">
      <h2>{{platform==='ios'?'Добавить на экран «Домой»':
        platform==='android'?'Установка через Chrome':'Установка в Chrome на компьютере'}}</h2>
      <ol v-if="platform==='ios'">
        <li>Откройте <a v-if="origin" :href="origin">{{origin}}</a> <strong>именно в Safari</strong> на iPhone.</li>
        <li>Нажмите «Поделиться» и выберите «На экран „Домой“».</li>
        <li>Убедитесь, что переключатель <strong>«Открыть как веб-приложение» включён</strong>.</li>
        <li>Нажмите «Добавить». Значок появится на главном экране, если устройство поддерживает этот способ.</li>
      </ol>
      <ol v-else-if="platform==='android'">
        <li>Откройте <a v-if="origin" :href="origin">{{origin}}</a> в <strong>Google Chrome</strong> на Android.</li>
        <li>Откройте меню ⋮ в Chrome.</li>
        <li>Выберите «Установить приложение» или «Добавить на главный экран» — доступный пункт зависит от браузера.</li>
        <li>Подтвердите действие, если Chrome предложит установку.</li>
      </ol>
      <ol v-else>
        <li>Откройте <a v-if="origin" :href="origin">{{origin}}</a> в <strong>Google Chrome</strong> на компьютере.</li>
        <li>Поищите значок установки в адресной строке или пункт «Установить приложение» в меню браузера.</li>
        <li>Подтвердите установку, если она доступна для этой сборки.</li>
      </ol>
      <p v-if="platform==='ios'">На iPhone используйте Safari для добавления на экран «Домой».</p>
      <p v-else>Браузер может не показывать пункт установки, если сборка ещё не соответствует требованиям PWA.</p>
    </section>
    <p class="install-release-note">
      Подписанная офлайн-версия PhotoBunker ещё не прошла окончательную приёмку.
      Инструкция не означает, что текущая сборка уже устанавливается как полноценное PWA.
    </p>
    <RouterLink to="/welcome" class="back-to-file">Вернуться в PhotoBunker</RouterLink>
  </main>
  <footer class="install-site-footer">Опубликовано через PhotoBunker · © 2026 PhotoBunker</footer>
</div>
</template>
<style scoped>
/* Approved public-card v1.1 install-guide composition, no demo card or fabricated share URL. */
.app-explain{max-width:525px;margin:auto;min-height:calc(100% - 68px);padding:34px 20px 40px;display:flex;align-items:center;flex-direction:column;justify-content:center;text-align:center}.app-icon{width:78px;height:78px;border-radius:20px;border:1px solid #415a46;background:linear-gradient(140deg,#2b4234,#1d261f);display:grid;place-items:center;margin-bottom:22px}.app-icon svg{height:49px;width:49px}.app-explain h1{font-size:27px;line-height:1.2;letter-spacing:-.06em;margin:0 0 12px}.app-explain>p{max-width:360px;color:#b9b9b9;font-size:13px;margin:0 0 26px}.install-choices{display:flex;gap:7px;background:#272727;padding:4px;border-radius:8px;margin-bottom:16px;flex-wrap:wrap}.install-choices button{background:none;color:#aaa;border:0;border-radius:6px;padding:8px 11px;font-size:11px}.install-choices button.selected{color:#f0f0f0;background:#494949}.install-guide{width:100%;text-align:left;background:#202020;padding:19px 21px;border-radius:10px}.install-guide h2{margin:0 0 13px;font-size:14px}.install-guide ol{margin:0;padding-left:18px;color:#d4d4d4;font-size:12px;line-height:1.8}.install-guide li+li{margin-top:6px}.install-guide p{font-size:11px;color:#9c9c9c;margin:11px 0 0}.back-to-file{margin:22px 0 0;border:0;background:transparent;text-decoration:underline;text-underline-offset:3px;color:#b9ebc5;padding:7px}
.lightbox{position:absolute;inset:0;background:#090909ed;z-index:25;display:grid;place-items:center;padding:42px 10px 18px}.lightbox .safe-media{max-width:100%;max-height:100%;height:auto;width:auto;object-fit:contain}.lightbox .lightbox-close{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:8px;background:#333;border:1px solid #484848;display:grid;place-items:center;color:#fff}.lightbox-close svg{width:20px;height:20px;stroke:currentColor;stroke-width:1.8;fill:none}.toast{position:absolute;z-index:40;top:12px;left:50%;transform:translateX(-50%);border:1px solid #487b54;background:#223829;color:#d5f2dc;border-radius:8px;min-width:130px;text-align:center;padding:10px 13px;box-shadow:0 8px 21px #0006;font-size:11px;max-width:calc(100% - 24px)}

.install-public-page{--green:#1ed760;--surface:#202020;--muted:#a4a4a4;
  min-height:100dvh;background:#121212;color:#f2f2f2;font-size:13px;overflow:auto}
.site-head{height:68px;background:#181818;border-bottom:1px solid #292929;
  display:flex;align-items:center;justify-content:space-between;padding:0 clamp(15px,3vw,34px);gap:10px}
.site-logo{display:flex;align-items:center;gap:10px;text-decoration:none;color:#f2f2f2}
.site-logo-mark{height:36px;width:36px;border-radius:10px;background:linear-gradient(135deg,#263a2c,#1b211d);
  border:1px solid #405043;display:grid;place-items:center}
.site-logo-mark svg{width:23px;height:23px}
.site-logo strong{font-size:15px;font-weight:800;letter-spacing:-.045em}
.install-home-link{border:1px solid #367d4b;border-radius:8px;color:#bde9c7;
  background:#203a27;padding:8px 12px;text-decoration:none;font-size:11px}
.app-explain{min-height:calc(100dvh - 132px)}
.app-explain .app-icon svg{width:49px;height:49px}
.install-guide a{color:#bde9c7;overflow-wrap:anywhere}
.install-release-note{max-width:470px!important;margin:15px auto 0!important;color:#c9ba9a!important;
  font-size:11px!important;line-height:1.6}
.back-to-file{display:inline-block;color:#b9ebc5;text-decoration:underline;text-underline-offset:3px}
.install-site-footer{text-align:center;color:#8e9a90;padding:18px 12px;border-top:1px solid #262d27;font-size:11px}
.install-choices button:focus-visible,.install-home-link:focus-visible{outline:2px solid #a4e7b7;outline-offset:2px}
@media(max-width:470px){.site-head{height:61px;padding:0 13px}.app-explain{padding:24px 15px 35px}
  .app-explain h1{font-size:24px}.install-choices{justify-content:center}}
</style>