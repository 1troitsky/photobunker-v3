<script setup lang="ts">
import {RouterLink} from 'vue-router'
/**
 * Owner-approved Public Card 1.1 *denial* state only.
 *
 * No public publication endpoint, bearer key wrapping or external-card
 * grant exists in the accepted PB3 server. Never infer permission from
 * the URL, query parameter, a local private preview or demo sample.
 */
</script>
<template>
<div class="public-card-denied" data-testid="public-card-unavailable">
  <header class="site-head">
    <RouterLink class="site-logo" to="/welcome" aria-label="PhotoBunker — главная">
      <span class="site-logo-mark" aria-hidden="true">
        <svg viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="3">
          <rect x="9" y="17" width="54" height="39" rx="10"/>
          <path d="m19 17 5-7h24l5 7"/>
          <circle cx="36" cy="37" r="13"/>
        </svg>
      </span><strong>PhotoBunker</strong>
    </RouterLink>
    <RouterLink to="/install" class="install-link" data-testid="public-card-install">
      ☆ Установить приложение
    </RouterLink>
  </header>
  <main class="card-shell">
    <section class="expired-stage" aria-labelledby="public-unavailable-title">
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="14"/><path d="M18 10v9l6 4"/>
      </svg>
      <h1 id="public-unavailable-title">Карточка недоступна</h1>
      <p>Ссылка не найдена, срок действия истёк или доступ к файлу закрыт.</p>
      <p>Публичная публикация файлов ещё не включена в этой сборке PhotoBunker.
        Никакие данные файла по этой ссылке не раскрываются.</p>
    </section>
  </main>
  <footer class="site-footer">
    <span>Опубликовано через PhotoBunker</span>
    <RouterLink to="/install">Установка PhotoBunker</RouterLink>
    <span>© 2026 PhotoBunker</span>
  </footer>
</div>
</template>
<style scoped>
/* Expired/denied state geometry from approved docs/ux/public-card/style.css. */
.expired-stage{min-height:295px;border:1px solid #404040;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;padding:24px;background:#1c1c1c}.expired-stage svg{width:35px;height:35px;stroke:#c3c3c3;fill:none;stroke-width:1.4}.expired-stage h2{font-size:17px;margin:0}.expired-stage p{color:#b0b0b0;margin:0;max-width:280px;font-size:12px}.app-explain{max-width:525px;margin:auto;min-height:calc(100% - 68px);padding:34px 20px 40px;display:flex;align-items:center;flex-direction:column;justify-content:center;text-align:center}.app-icon{width:78px;height:78px;border-radius:20px;border:1px solid #415a46;background:linear-gradient(140deg,#2b4234,#1d261f);display:grid;place-items:center;margin-bottom:22px}.app-icon svg{height:49px;width:49px}.app-explain h1{font-size:27px;line-height:1.2;letter-spacing:-.06em;margin:0 0 12px}.app-explain>p{max-width:360px;color:#b9b9b9;font-size:13px;margin:0 0 26px}.install-choices{display:flex;gap:7px;background:#272727;padding:4px;border-radius:8px;margin-bottom:16px;flex-wrap:wrap}.install-choices button{background:none;color:#aaa;border:0;border-radius:6px;padding:8px 11px;font-size:11px}.install-choices button.selected{color:#f0f0f0;background:#494949}.install-guide{width:100%;text-align:left;background:#202020;padding:19px 21px;border-radius:10px}.install-guide h2{margin:0 0 13px;font-size:14px}.install-guide ol{margin:0;padding-left:18px;color:#d4d4d4;font-size:12px;line-height:1.8}.install-guide li+li{margin-top:6px}.install-guide p{font-size:11px;color:#9c9c9c;margin:11px 0 0}.back-to-file{margin:22px 0 0;border:0;background:transparent;text-decoration:underline;text-underline-offset:3px;color:#b9ebc5;padding:7px}

.public-card-denied{--green:#1ed760;--muted:#a3a3a3;background:#121212;color:#f2f2f2;
  min-height:100dvh;display:flex;flex-direction:column;font-size:13px}
.site-head{min-height:68px;padding:0 clamp(15px,3vw,34px);display:flex;align-items:center;
  justify-content:space-between;gap:10px;background:#181818;border-bottom:1px solid #292929}
.site-logo{display:flex;align-items:center;gap:10px;color:#f5f5f5;text-decoration:none}
.site-logo-mark{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;
  background:linear-gradient(135deg,#263a2c,#1b211d);border:1px solid #405043}
.site-logo-mark svg{width:23px;height:23px}
.site-logo strong{font-weight:800;font-size:15px}
.install-link{white-space:nowrap;text-decoration:none;color:#bde9c7;font-size:11px;
  border:1px solid #367d4b;border-radius:8px;padding:9px 12px;background:#203a27}
.card-shell{width:min(100%,840px);margin:auto;padding:45px 15px}
.expired-stage{min-height:295px}
.expired-stage svg{width:35px;height:35px;fill:none}
.expired-stage h1{font-size:18px;margin:0}
.expired-stage p{color:#b0b0b0;font-size:12px;line-height:1.6;max-width:380px;margin:0}
.site-footer{display:flex;justify-content:center;gap:14px;align-items:center;flex-wrap:wrap;
  border-top:1px solid #303030;color:#9c9c9c;font-size:11px;padding:20px 14px}
.site-footer a{color:#a3d9b5;text-decoration:none}
.public-card-denied a:focus-visible{outline:2px solid #9beab2;outline-offset:2px}
@media(max-width:470px){.site-head{min-height:61px;padding:0 13px}
  .install-link{padding:8px;font-size:10px}.card-shell{padding:26px 13px}}
</style>