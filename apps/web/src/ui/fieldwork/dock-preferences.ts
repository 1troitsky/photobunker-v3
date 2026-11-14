import { shallowRef } from 'vue'

export type DockId =
  | 'assignments' | 'browser' | 'camera' | 'contacts' | 'settings'
  | 'notifications' | 'messages'

export interface DockDefinition {
  id: DockId
  name: string
  to: string | null
  icon: string
}

// Appearance 1.3 permits seven choices. The encrypted notifications inbox
// has a real local route, while Messages still has none. Never allow a saved
// Dock button to link to a missing or unimplemented messenger route.
export const dockDefinitions: Readonly<Record<DockId, DockDefinition>> = {
  assignments: {id:'assignments',name:'Задания',to:'/assignments',icon:'tasks'},
  browser: {id:'browser',name:'Browser',to:'/browser',icon:'folder'},
  camera: {id:'camera',name:'Камера',to:'/camera',icon:'camera'},
  contacts: {id:'contacts',name:'Контакты',to:'/contacts',icon:'users'},
  settings: {id:'settings',name:'Настройки',to:'/settings',icon:'settings'},
  notifications: {id:'notifications',name:'Уведомления',to:'/notifications',icon:'bell'},
  messages: {id:'messages',name:'Сообщения',to:null,icon:'message'},
}

export const dockChoices: readonly DockDefinition[] = [
  dockDefinitions.assignments,
  dockDefinitions.browser,
  dockDefinitions.camera,
  dockDefinitions.notifications,
  dockDefinitions.settings,
  dockDefinitions.contacts,
  dockDefinitions.messages,
]

export const defaultDock: readonly DockId[] = Object.freeze([
  'assignments','browser','camera','contacts','settings',
])

// These are *local display preferences*, never identity, keys, metadata or
// access rights. They may be set while offline and are scoped to this device.
// V1 is read as a migration fallback. V2 stores the complete appearance draft
// in one atomic localStorage item, so Dock and Start Page cannot half-save.
export const dockStorageKey = 'pb3.appearance.dock.v1'
export const appearanceStorageKey = 'pb3.appearance.v2'

export type DockStorage = Pick<Storage, 'getItem' | 'setItem'>

function deviceStorage(): DockStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage }
  catch { return null }
}

export function validateDock(input: unknown): DockId[] | null {
  if (!Array.isArray(input) || input.length < 3 || input.length > 6) return null
  if (!input.every(item => typeof item === 'string'
    && Object.prototype.hasOwnProperty.call(dockDefinitions, item))) return null
  const values = input as DockId[]
  if (new Set(values).size !== values.length
    || !values.includes('settings')
    || values.some(id => dockDefinitions[id].to === null)) return null
  return [...values]
}

export function readDock(storage: DockStorage | null = deviceStorage()): DockId[] {
  if (!storage) return [...defaultDock]
  try {
    // Full v2 bundle must be structurally valid. Invalid/unreadable v2 data
    // falls through to the previous v1 Dock, without losing saved choices.
    const v2 = storage.getItem(appearanceStorageKey)
    if (v2) {
      const parsed: unknown = JSON.parse(v2)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const value = parsed as Record<string,unknown>
        const dock = validateDock(value.dock)
        if (value.version === 2
          && ['tasks','camera','browser'].includes(String(value.launch)) && dock) return dock
      }
    }
  } catch { /* corrupt v2 is not fatal: try the legacy Dock key */ }
  try {
    const legacy = storage.getItem(dockStorageKey)
    if (!legacy) return [...defaultDock]
    return validateDock(JSON.parse(legacy)) ?? [...defaultDock]
  } catch {
    // Corrupt or blocked storage never breaks the application shell.
    return [...defaultDock]
  }
}

export const savedDock = shallowRef<DockId[]>(readDock())
export const displayedDock = shallowRef<DockId[]>([...savedDock.value])

export function previewDock(input: unknown): boolean {
  const next = validateDock(input)
  if (!next) return false
  displayedDock.value = next
  return true
}

export function restoreDock(): void {
  displayedDock.value = [...savedDock.value]
}

// Durable local write precedes updating visible saved state. If persistence
// fails, no misleading "saved" badge or unpersisted application state.
export function saveDock(input: unknown, storage: DockStorage | null = deviceStorage()): boolean {
  const next = validateDock(input)
  if (!next || !storage) return false
  try { storage.setItem(dockStorageKey, JSON.stringify(next)) }
  catch { return false }
  savedDock.value = next
  displayedDock.value = [...next]
  return true
}
