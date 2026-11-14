import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoveryKeyExportBlob, saveRecoveryKeyToDevice } from './recovery-key-export'

const testKey = 'PB2.test-only-do-not-use-as-a-real-recovery-key'

afterEach(() => vi.unstubAllGlobals())

describe('Recovery Key export never persists without explicit user action', () => {
  it('serializes only the exact volatile key and a terminal newline', async () => {
    const blob = recoveryKeyExportBlob(testKey)
    expect(blob.type).toBe('text/plain;charset=utf-8')
    expect(await blob.text()).toBe(testKey + '\n')
    for (const invalid of ['', 'PB2.test-key ', 'wrong-format', ' PB2.test-key']) {
      expect(() => recoveryKeyExportBlob(invalid)).toThrow('identity.recovery_save_unavailable')
    }
  })

  it('uses supported native system picker and writes before acknowledging save', async () => {
    const write = vi.fn(async (_blob: Blob) => undefined)
    const close = vi.fn(async () => undefined)
    const abort = vi.fn(async () => undefined)
    const picker = vi.fn(async () => ({
      createWritable: async () => ({ write, close, abort }),
    }))
    vi.stubGlobal('window', { showSaveFilePicker: picker })
    expect(await saveRecoveryKeyToDevice(testKey)).toBe('saved')
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'recovery-key.txt',
    }))
    expect(write).toHaveBeenCalledOnce()
    expect(await (write.mock.calls[0] as unknown as [Blob])[0].text()).toBe(testKey + '\n')
    expect(close).toHaveBeenCalledOnce()
    expect(abort).not.toHaveBeenCalled()
  })

  it('handles user cancel without a write, exposing no error text or key', async () => {
    const picker = vi.fn(async () => {
      throw Object.assign(new Error('cancelled by user'), { name: 'AbortError' })
    })
    vi.stubGlobal('window', { showSaveFilePicker: picker })
    expect(await saveRecoveryKeyToDevice(testKey)).toBe('cancelled')
    expect(picker).toHaveBeenCalledOnce()
  })

  it('does not claim success after a failed partial write', async () => {
    const abort = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async () => { throw new Error('private filesystem path') },
          close: vi.fn(),
          abort,
        }),
      }),
    })
    await expect(saveRecoveryKeyToDevice(testKey))
      .rejects.toThrow('identity.recovery_save_failed')
    expect(abort).toHaveBeenCalledOnce()
  })
})
