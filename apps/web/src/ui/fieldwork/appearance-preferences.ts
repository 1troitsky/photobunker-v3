import { shallowRef } from 'vue'
import {
  appearanceStorageKey, displayedDock, dockStorageKey, savedDock, validateDock,
} from './dock-preferences'
import type { DockId } from './dock-preferences'

export type LaunchPage = 'tasks' | 'camera' | 'browser'

export const defaultLaunch: LaunchPage = 'tasks'
export const launchPageRoutes: Readonly<Record<LaunchPage,string>> = {
  tasks:'/assignments',
  camera:'/camera',
  browser:'/browser',
}
export const launchChoices: readonly {id:LaunchPage;label:string;description:string}[] = [
  {id:'tasks',label:'Задания',description:'Список моих заданий'},
  {id:'camera',label:'Камера',description:'Перейти к съёмке'},
  {id:'browser',label:'Browser',description:'Каталог зашифрованных файлов'},
]

export interface AppearancePreferences {
  readonly version: 2
  readonly dock: DockId[]
  readonly launch: LaunchPage
}

export type AppearanceStorage = Pick<Storage,'getItem'|'setItem'>

function deviceStorage(): AppearanceStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage }
  catch { return null }
}

export function validateLaunch(input: unknown): LaunchPage | null {
  return input === 'tasks' || input === 'camera' || input === 'browser' ? input : null
}

export function validateAppearance(input: unknown): AppearancePreferences | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string,unknown>
  if (record.version !== 2) return null
  const dock = validateDock(record.dock)
  const launch = validateLaunch(record.launch)
  return dock && launch ? {version:2,dock,launch} : null
}

export function readAppearance(storage: AppearanceStorage | null = deviceStorage()):
  AppearancePreferences | null {
  if (!storage) return null
  try {
    const raw=storage.getItem(appearanceStorageKey)
    if (!raw) return null
    return validateAppearance(JSON.parse(raw) as unknown)
  } catch { return null }
}

export function readLaunchPreference(storage: AppearanceStorage | null = deviceStorage()):
  LaunchPage {
  return readAppearance(storage)?.launch ?? defaultLaunch
}

export function resolveStartRoute(storage: AppearanceStorage | null = deviceStorage()):
  string {
  return launchPageRoutes[readLaunchPreference(storage)]
}

export const savedLaunch = shallowRef<LaunchPage>(readLaunchPreference())

// A single localStorage.setItem is atomic for BOTH fields. The previous v1
// Dock remains as a read-only migration fallback. No account/keys/metadata
// or media is ever stored in this UI preferences document.
export function saveAppearance(
  dock: unknown,
  launch: unknown,
  storage: AppearanceStorage | null = deviceStorage(),
): boolean {
  const normalized = validateAppearance({version:2,dock,launch})
  if (!normalized || !storage) return false
  try {
    storage.setItem(appearanceStorageKey,JSON.stringify(normalized))
  } catch { return false }
  savedDock.value = [...normalized.dock]
  displayedDock.value = [...normalized.dock]
  savedLaunch.value = normalized.launch
  return true
}

// Keep the pre-existing migration key documented for verification and future
// upgrades. saveAppearance never modifies/deletes the user's v1 preference.
export const previousDockKey = dockStorageKey
