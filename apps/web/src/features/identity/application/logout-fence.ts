/**
 * P1 #402. A non-secret origin-wide logout fence.
 *
 * IndexedDB transactions are asynchronous and may be aborted by a hard reload.
 * Persist this synchronous revocation intent BEFORE the UI becomes signed out.
 * The value is always a constant bit: no account IDs, device IDs, keys or tokens.
 *
 * The fence intentionally survives a completed logout. Only successful, explicit
 * Key-Only registration / Recovery Key login may clear it; auto-resume cannot.
 * Browser storage blocking fails closed for automatic device restoration.
 */
const KEY = 'pb3.identity.logout-fence.v1'
const FENCED = '1'

function safeStorage(): Storage {
  try {
    const storage = globalThis.localStorage
    if (!storage) throw new Error('storage unavailable')
    return storage
  } catch {
    throw new Error('identity.logout_fence_unavailable')
  }
}

export function isLogoutFenced(): boolean {
  // This module is browser-only. Node unit fixtures create synthetic sessions
  // without a window, IDB or a browser auto-resume surface; they cannot
  // represent an origin-scoped logout. NEVER bypass for a real Window.
  if (typeof window === 'undefined') return false
  try {
    // Any unexpected value is treated as fenced, not as a false boolean.
    return safeStorage().getItem(KEY) !== null
  } catch {
    return true
  }
}

export function establishLogoutFence(): void {
  try {
    const storage = safeStorage()
    storage.setItem(KEY, FENCED)
    // Fail closed for storage shims that acknowledge but do not persist writes.
    if (storage.getItem(KEY) !== FENCED) throw new Error('storage write not committed')
  } catch {
    throw new Error('identity.logout_fence_unavailable')
  }
}

export function clearLogoutFenceAfterExplicitProof(): void {
  try {
    const storage = safeStorage()
    storage.removeItem(KEY)
    if (storage.getItem(KEY) !== null) throw new Error('storage delete not committed')
  } catch {
    throw new Error('identity.logout_fence_unavailable')
  }
}

export function isLogoutFenceStorageEvent(event: StorageEvent): boolean {
  return event.key === KEY && event.newValue !== null
}
