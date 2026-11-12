import { describe, expect, it } from 'vitest'
import { implementedSearchTargets, searchSettings, settingsSearchEntries } from './settings-search'

describe('Fieldwork Settings search: exact implemented field links only', () => {
  it('finds the approved Dock editor by RU/EN names and synonyms', () => {
    for (const term of ['dock', 'ДОК', 'панель', 'navigation', 'нижняя панель']) {
      expect(searchSettings(term).some(entry =>
        entry.id === 'dock' && entry.to === '/settings/appearance?field=dock'
      )).toBe(true)
    }
  })
  it('shows language as an unavailable real future setting, not a fake jump', () => {
    for (const term of ['язык', 'language', 'english']) {
      const entry = searchSettings(term).find(row => row.id === 'language')
      expect(entry).toBeDefined()
      expect(entry?.to).toBeNull()
    }
  })
  it('only exposes existing PB3 routes and anchored fields', () => {
    expect(implementedSearchTargets).toEqual([
      '/settings/appearance?field=dock', '/contacts',
    ])
    expect(searchSettings('')).toEqual(
      settingsSearchEntries.filter(entry => entry.to !== null),
    )
    expect(new Set(settingsSearchEntries.map(entry => entry.id)).size)
      .toBe(settingsSearchEntries.length)
    expect(settingsSearchEntries.filter(entry => entry.to !== null)).toHaveLength(2)
  })
  it('never treats messages as a nested Contacts settings route', () => {
    expect(settingsSearchEntries.some(entry => entry.id === 'messages')).toBe(false)
    expect(searchSettings('несуществующее слово')).toEqual([])
    expect(searchSettings('a'.repeat(201))).toEqual([])
  })
})
