import { createApp, watch } from 'vue'
import App from './App.vue'
import { router } from './router'
import { brand } from './config/brand'
import { initializeVisualAppearance } from './ui/fieldwork/visual-preferences'
import './styles.css'
import { ensureOwnExchangeKey } from './features/sharing/key-directory'
import { attachShareLifecycle, flushRecipientGrants } from './features/sharing/grant-flow'
import { attachAssignmentLifecycle, flushAssignmentOutbox } from './features/assignments/application/assignment-outbox'
import { activeSession, resumeExistingDevice, sessionBootstrapPending } from './features/identity/application/session'
import { attachOutboxLifecycle, flushOutbox } from './features/photo-sync/application/p1-photo'
import { refreshRetentionHint } from './features/media/application/retention-hint'
import { attachMediaRetryCoordinator } from './features/media/application/media-retry-coordinator'

document.title = brand.name
initializeVisualAppearance()
// The loader is visible only during real initial identity bootstrap.
sessionBootstrapPending.value = true
// P0 deliberately does NOT register a Service Worker pending signed-release design.
// Navigation and this shell are available without waiting for any network identity call.
createApp(App).use(router).mount('#app')
attachOutboxLifecycle()
attachShareLifecycle()
attachAssignmentLifecycle()
attachMediaRetryCoordinator()
watch(activeSession, s => {
  // Welcome Loader 1.6 ends on a *locally decrypted, authenticated device*
  // rather than waiting for a remote login challenge to finish. Offline and
  // slow networks must not trap the user at «Входим в приложение...».
  // Server-only actions remain protected by s.online below.
  if(s)sessionBootstrapPending.value=false
  if(s?.online) {
    void refreshRetentionHint(s)
    void flushOutbox()
    void flushRecipientGrants()
    void flushAssignmentOutbox()
    void ensureOwnExchangeKey().catch(() => { /* explicit UI retry */ })
  }
},{flush:'sync'})
void resumeExistingDevice()
  .catch(() => { /* no persisted or valid account yet */ })
  .finally(() => { sessionBootstrapPending.value = false })
