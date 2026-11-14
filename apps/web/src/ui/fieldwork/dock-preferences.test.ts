import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultDock, displayedDock, dockDefinitions, dockStorageKey,
  readDock, restoreDock, savedDock, saveDock, validateDock, previewDock,
} from './dock-preferences'
import type { DockStorage } from './dock-preferences'

const memory = (start?: string): DockStorage & {value: string | null} => {
  const result = {
    value:start ?? null,
    getItem: (_key:string) => result.value,
    setItem: (key:string, value:string) => {
      if (key !== dockStorageKey) throw Error('Unexpected preference key')
      result.value=value
    },
  }
  return result
}

afterEach(() => { savedDock.value = [...defaultDock]; restoreDock() })

describe('Appearance 1.3 dock with fail-safe Local-First persistence', () => {
  it('uses the accepted five-point default and rejects hidden routes', () => {
    expect(defaultDock).toEqual(['assignments','browser','camera','contacts','settings'])
    expect(dockDefinitions.messages.to).toBeNull()
    expect(dockDefinitions.notifications.to).toBe('/notifications')
    expect(validateDock(['assignments','messages','settings'])).toBeNull()
    expect(validateDock(['assignments','notifications','settings'])).toEqual([
      'assignments','notifications','settings',
    ])
  })
  it('enforces mandatory Settings, uniqueness and 3–6 navigation entries', () => {
    expect(validateDock(['assignments','camera','settings'])).toEqual([
      'assignments','camera','settings',
    ])
    expect(validateDock(['settings','browser','contacts','camera'])).toEqual([
      'settings','browser','contacts','camera',
    ])
    for (const invalid of [
      [], ['settings'], ['settings','contacts'], ['settings','settings','browser'],
      ['contacts','camera','browser'], ['settings','camera','unknown'],
      ['settings','browser','camera','contacts','assignments','browser'],
      'settings,browser,camera', null, {dock:['settings','browser','camera']},
    ]) expect(validateDock(invalid)).toBeNull()
  })
  it('recovers safely from corrupt, malicious or outdated stored preferences', () => {
    expect(readDock(memory('not-json'))).toEqual(defaultDock)
    expect(readDock(memory('["settings","messages","camera"]'))).toEqual(defaultDock)
    expect(readDock(memory(JSON.stringify(['settings','browser','camera']))))
      .toEqual(['settings','browser','camera'])
    expect(readDock({getItem:()=>{throw Error('private mode')},setItem:()=>{}}))
      .toEqual(defaultDock)
  })
  it('previews without saving, cancels cleanly, then persists a valid order', () => {
    const store=memory()
    const next=['settings','camera','browser']
    expect(previewDock(next)).toBe(true)
    expect(displayedDock.value).toEqual(next)
    expect(savedDock.value).toEqual(defaultDock)
    restoreDock()
    expect(displayedDock.value).toEqual(defaultDock)
    expect(saveDock(next,store)).toBe(true)
    expect(savedDock.value).toEqual(next)
    expect(readDock(store)).toEqual(next)
  })
  it('does not update saved state if the local write fails', () => {
    const broken: DockStorage={getItem:()=>null,setItem:()=>{throw Error('quota')}}
    expect(saveDock(['settings','camera','browser'],broken)).toBe(false)
    expect(savedDock.value).toEqual(defaultDock)
    expect(displayedDock.value).toEqual(defaultDock)
  })
})
