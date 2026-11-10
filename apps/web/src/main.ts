import { createApp, watch } from 'vue'
import App from './App.vue'
import { router } from './router'
import { brand } from './config/brand'
import './styles.css'
import { ensureOwnExchangeKey } from './features/sharing/key-directory'
import { attachShareLifecycle, flushRecipientGrants } from './features/sharing/grant-flow'
import { attachAssignmentLifecycle, flushAssignmentOutbox } from './features/assignments/application/assignment-outbox'
import { activeSession, resumeExistingDevice } from './features/identity/application/session'
import { attachOutboxLifecycle, flushOutbox } from './features/photo-sync/application/p1-photo'

document.title = brand.name
// P0 deliberately does NOT register a Service Worker pending signed-release design.
// Navigation and this shell are available without waiting for any network identity call.
createApp(App).use(router).mount('#app')
attachOutboxLifecycle()
attachShareLifecycle()
attachAssignmentLifecycle()
watch(activeSession, s => { if(s?.online) { void flushOutbox(); void flushRecipientGrants(); void flushAssignmentOutbox(); void ensureOwnExchangeKey().catch(() => { /* explicit UI retry */ }) } })
void resumeExistingDevice().catch(() => { /* no persisted or valid account yet */ })
