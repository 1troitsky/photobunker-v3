import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearLogoutFenceAfterExplicitProof, establishLogoutFence,
  isLogoutFenced, isLogoutFenceStorageEvent,
} from './logout-fence'

function stubStorage() {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', storage)
  return data
}
afterEach(() => vi.unstubAllGlobals())

describe('P1 #402 synchronous non-secret logout fence', () => {
  it('writes only an origin-wide non-secret bit before any IndexedDB operation', () => {
    const data = stubStorage()
    expect(isLogoutFenced()).toBe(false)
    establishLogoutFence()
    expect([...data.entries()]).toEqual([['pb3.identity.logout-fence.v1', '1']])
    expect(isLogoutFenced()).toBe(true)
  })

  it('survives repeated logout and refuses malformed persisted fence values', () => {
    const data = stubStorage()
    establishLogoutFence()
    establishLogoutFence()
    expect(data.size).toBe(1)
    data.set('pb3.identity.logout-fence.v1', 'unexpected value')
    expect(isLogoutFenced()).toBe(true)
  })

  it('does not silently authorize session resume when localStorage is unavailable', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', undefined)
    expect(isLogoutFenced()).toBe(true)
    expect(() => establishLogoutFence()).toThrow('identity.logout_fence_unavailable')
    expect(() => clearLogoutFenceAfterExplicitProof()).toThrow('identity.logout_fence_unavailable')
  })

  it('treats failed or ignored storage writes as failure, never signed-out success', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    })
    expect(() => establishLogoutFence()).toThrow('identity.logout_fence_unavailable')
    expect(() => clearLogoutFenceAfterExplicitProof()).not.toThrow()
    vi.stubGlobal('localStorage', {
      getItem: () => '1', setItem: () => undefined, removeItem: () => undefined,
    })
    expect(() => clearLogoutFenceAfterExplicitProof()).toThrow('identity.logout_fence_unavailable')
  })

  it('allows clearing only via the explicit proof path, not by automatic resume', () => {
    stubStorage()
    establishLogoutFence()
    expect(isLogoutFenced()).toBe(true)
    clearLogoutFenceAfterExplicitProof()
    expect(isLogoutFenced()).toBe(false)
  })

  it('fences other tabs only when a storage event adds a logout marker', () => {
    const makeEvent = (key: string | null, value: string | null) => ({key, newValue:value}) as StorageEvent
    expect(isLogoutFenceStorageEvent(makeEvent('pb3.identity.logout-fence.v1','1'))).toBe(true)
    expect(isLogoutFenceStorageEvent(makeEvent('pb3.identity.logout-fence.v1',null))).toBe(false)
    expect(isLogoutFenceStorageEvent(makeEvent('unrelated','1'))).toBe(false)
  })
})
