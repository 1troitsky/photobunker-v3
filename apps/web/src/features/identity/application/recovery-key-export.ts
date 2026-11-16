/**
 * This is a user-initiated plaintext export, never a Recovery Key store.
 * The only caller is the registration screen while the generated secret is
 * still visible in volatile memory. The server must never receive this blob.
 */
export type RecoveryKeySaveResult = 'saved' | 'downloaded' | 'cancelled'

interface KeyWriter {
  write(data: Blob): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}
interface KeyFileHandle {
  createWritable(): Promise<KeyWriter>
}
type KeyPicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<KeyFileHandle>

const filename = 'recovery-key.txt'

export function recoveryKeyExportBlob(recoveryKey: string): Blob {
  if (!recoveryKey || recoveryKey.trim() !== recoveryKey || !recoveryKey.startsWith('PB2.')) {
    throw new Error('identity.recovery_save_unavailable')
  }
  return new Blob([recoveryKey, '\n'], { type: 'text/plain;charset=utf-8' })
}

function isCancel(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'name' in error && error.name === 'AbortError'
}

/**
 * The picker is deliberately invoked synchronously from the click handler
 * before any await, preserving the browser's transient user activation.
 */
export async function saveRecoveryKeyToDevice(recoveryKey: string): Promise<RecoveryKeySaveResult> {
  const blob = recoveryKeyExportBlob(recoveryKey)
  const picker = (window as Window & { showSaveFilePicker?: KeyPicker }).showSaveFilePicker
  if (typeof picker === 'function') {
    let handle: KeyFileHandle
    try {
      handle = await picker.call(window, {
        suggestedName: filename,
        types: [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }],
      })
    } catch (error) {
      if (isCancel(error)) return 'cancelled'
      throw new Error('identity.recovery_save_failed')
    }
    let writer: KeyWriter
    try {
      writer = await handle.createWritable()
    } catch {
      throw new Error('identity.recovery_save_failed')
    }
    try {
      await writer.write(blob)
      await writer.close()
    } catch {
      try { await writer.abort() } catch { /* best-effort discard */ }
      throw new Error('identity.recovery_save_failed')
    }
    return 'saved'
  }

  // Safari/Firefox and other browsers without the native file picker:
  // a download is only begun by this explicit user action, never on render.
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.rel = 'noopener'
  link.hidden = true
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    // Keep the URL alive long enough for the browser's download handoff.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
  }
  return 'downloaded'
}
