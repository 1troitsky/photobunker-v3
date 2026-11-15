<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { authFailure, clearAuthFailure, authFailureCopy } from '../features/identity/application/authorization-failure'

const router=useRouter()
onMounted(()=>{
  if(!authFailure.value)void router.replace('/welcome')
})
</script>
<template>
<section class="error-page" data-testid="authorization-error-page">
  <div v-if="authFailure" class="page-layout">
    <div class="brand">
      <div class="brand-logo" aria-hidden="true">
        <svg viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="3">
          <rect x="9" y="17" width="54" height="39" rx="10"/>
          <path d="m19 17 5-7h24l5 7"/>
          <circle cx="36" cy="37" r="13"/>
          <path d="M29 42c5 5 11 6 17 1"/>
        </svg>
      </div>
      <div class="brand-name">PhotoBunker</div>
    </div>
    <div class="error-message" role="alert">
      <div class="error-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 3 22 21H2z"/>
          <path d="M12 9v5M12 17h.01"/></svg>
      </div>
      <h1>{{authFailureCopy[authFailure].title}}</h1>
      <p>{{authFailureCopy[authFailure].description}}</p>
    </div>
    <RouterLink class="back-home" to="/welcome" @click="clearAuthFailure">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 12H5m7-7-7 7 7 7"/></svg>
      На страницу приветствия
    </RouterLink>
  </div>
</section>
</template>
<style scoped>
/* Exact owner-accepted Authorization Error 1.0 geometry from docs/ux/authorization-error/style.css. */
.error-page{height:100dvh;width:100%;background:radial-gradient(ellipse 68% 37% at 50% 50%,#30202260 0%,transparent 76%),#121212;position:relative;isolation:isolate;overflow-y:auto;overscroll-behavior:contain;color:#f2f2f2}
.page-layout{width:min(100%,480px);min-height:100%;margin:0 auto;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:clamp(35px,8%,62px) 26px clamp(44px,8%,66px)}
.brand{display:flex;flex-direction:column;align-items:center;gap:7px;flex:none}
.brand-logo{height:54px;width:54px;display:grid;place-items:center;border:1px solid #454e45;background:linear-gradient(140deg,#2b382b,#171e18);border-radius:16px;box-shadow:0 8px 24px #0003;color:#f3fff4}
.brand-logo svg{width:37px;height:37px}.brand-name{font-size:20px;line-height:1.2;font-weight:780;letter-spacing:-.055em}
.error-message{width:100%;display:flex;align-items:center;flex-direction:column;text-align:center;gap:0;margin:auto 0;min-height:245px;justify-content:center;padding:18px 0}
.error-icon{width:66px;height:66px;display:grid;place-items:center;border-radius:19px;border:1px solid #684443;background:#342425;color:#e4aaaa;margin:0 0 25px;box-shadow:0 12px 44px #00000027}
.error-icon svg{width:32px;height:32px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.error-message h1{font-size:clamp(21px,4.6vw,26px);font-weight:760;letter-spacing:-.043em;line-height:1.22;margin:0 0 13px;max-width:410px}
.error-message p{font-size:13px;color:#b2b2b2;line-height:1.65;max-width:355px;margin:0;min-height:64px;text-wrap:pretty}
.back-home{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:44px;text-decoration:none;color:#a9efbe;font-size:13px;font-weight:700;letter-spacing:-.015em;padding:10px 12px;border-radius:8px;flex:none;transition:color .15s,transform .15s}
.back-home:hover{color:#e9fff0;transform:translateY(-1px)}.back-home svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
@media(max-width:390px){.page-layout{padding:32px 22px 39px}.error-icon{width:60px;height:60px;border-radius:17px;margin-bottom:22px}.error-icon svg{width:29px;height:29px}.error-message p{font-size:12px}.error-message h1{font-size:21px}}
@media(max-height:650px){.page-layout{padding-top:24px;padding-bottom:24px}.brand-logo{width:49px;height:49px}.brand-name{font-size:19px}.error-message{min-height:200px}.error-icon{margin-bottom:17px}}
@media(prefers-reduced-motion:reduce){.back-home{transition:none}.back-home:hover{transform:none}}
</style>