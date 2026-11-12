import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultLaunch, launchPageRoutes, readAppearance, readLaunchPreference,
  resolveStartRoute, saveAppearance, savedLaunch, validateAppearance, validateLaunch,
} from './appearance-preferences'
import { appearanceStorageKey, defaultDock, displayedDock, dockStorageKey,
  readDock, restoreDock, savedDock } from './dock-preferences'
import type { AppearanceStorage } from './appearance-preferences'

function memory(initial:Record<string,string> = {}):AppearanceStorage & {data:Record<string,string>} {
  const data={...initial}
  return {
    data,
    getItem:(key:string)=>data[key] ?? null,
    setItem:(key:string,value:string)=>{data[key]=value},
  }
}

afterEach(()=>{
  savedDock.value=[...defaultDock]
  restoreDock()
  savedLaunch.value=defaultLaunch
})

describe('Appearance start page: atomic local preferences and v1 compatibility',()=>{
  it('supports exactly the three approved start routes and preserves default',()=>{
    expect(resolveStartRoute(memory())).toBe('/assignments')
    expect(launchPageRoutes).toEqual({
      tasks:'/assignments',camera:'/camera',browser:'/browser',
    })
    for(const value of ['contacts','settings','messages','notifications',null,42,{}])
      expect(validateLaunch(value)).toBeNull()
  })

  it('persists Dock + launch as a single validated v2 document',()=>{
    const store=memory()
    expect(saveAppearance(['browser','settings','camera'],'camera',store)).toBe(true)
    expect(Object.keys(store.data)).toEqual([appearanceStorageKey])
    expect(JSON.parse(store.data[appearanceStorageKey]!)).toEqual({
      version:2,dock:['browser','settings','camera'],launch:'camera',
    })
    expect(readLaunchPreference(store)).toBe('camera')
    expect(resolveStartRoute(store)).toBe('/camera')
    expect(readDock(store)).toEqual(['browser','settings','camera'])
    expect(savedDock.value).toEqual(['browser','settings','camera'])
    expect(displayedDock.value).toEqual(['browser','settings','camera'])
    expect(savedLaunch.value).toBe('camera')
  })

  it('migrates legacy Dock without clearing user data, and defaults launch to Tasks',()=>{
    const initial=['settings','camera','browser']
    const store=memory({[dockStorageKey]:JSON.stringify(initial)})
    expect(readDock(store)).toEqual(initial)
    expect(readLaunchPreference(store)).toBe('tasks')
    expect(saveAppearance(initial,'browser',store)).toBe(true)
    expect(readDock(store)).toEqual(initial)
    expect(resolveStartRoute(store)).toBe('/browser')
    expect(store.data[dockStorageKey]).toBe(JSON.stringify(initial))
  })

  it('rejects invalid preference without changing saved state or storage',()=>{
    const store=memory()
    const previousDock=[...savedDock.value]
    expect(saveAppearance(['camera','camera','settings'],'camera',store)).toBe(false)
    expect(saveAppearance(['camera','settings','browser'],'messages',store)).toBe(false)
    expect(validateAppearance({version:3,dock:defaultDock,launch:'tasks'})).toBeNull()
    expect(validateAppearance({version:2,dock:defaultDock,launch:'bad'})).toBeNull()
    expect(Object.keys(store.data)).toHaveLength(0)
    expect(savedDock.value).toEqual(previousDock)
    expect(savedLaunch.value).toBe('tasks')
  })

  it('handles blocked/quota storage and corrupt v2 without losing valid legacy Dock',()=>{
    const broken:AppearanceStorage={
      getItem:()=>null,
      setItem:()=>{throw Error('quota exceeded')},
    }
    expect(saveAppearance(['camera','browser','settings'],'browser',broken)).toBe(false)
    expect(savedLaunch.value).toBe('tasks')
    expect(savedDock.value).toEqual(defaultDock)
    const store=memory({
      [appearanceStorageKey]:'not valid JSON',
      [dockStorageKey]:JSON.stringify(['settings','browser','camera']),
    })
    expect(readAppearance(store)).toBeNull()
    expect(readDock(store)).toEqual(['settings','browser','camera'])
    expect(resolveStartRoute(store)).toBe('/assignments')
    expect(resolveStartRoute({getItem:()=>{throw Error('denied')},setItem:()=>{}}))
      .toBe('/assignments')
  })
})
