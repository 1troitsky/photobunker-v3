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
  it('opens the exact start page control with RU/EN synonyms', () => {
    for (const query of ['стартовая страница','launch page','начальный экран']) {
      expect(searchSettings(query).find(row => row.id === 'start-page')?.to)
        .toBe('/settings/appearance?field=launch')
    }
  })
  it('opens exact Appearance 1.3 language section from RU/EN search', () => {
    for (const term of ['язык', 'language', 'english']) {
      const entry = searchSettings(term).find(row => row.id === 'language')
      expect(entry).toBeDefined()
      expect(entry?.to).toBe('/settings/appearance?field=language')
    }
  })
  it('only exposes existing PB3 routes and anchored fields', () => {
    expect(implementedSearchTargets).toEqual([
      '/settings/appearance?field=dock', '/contacts',
      '/settings/appearance?field=theme',
      '/settings/appearance?field=accent',
      '/settings/appearance?field=size',
      '/settings/appearance?field=launch',
      '/settings/appearance?field=language', '/notifications',
      '/notifications/settings?field=invitations',
      '/notifications/settings?field=deadlines',
      '/notifications/settings?field=expiry',
      '/notifications/settings?field=newFiles',
      '/notifications/settings?field=reviews',
      '/notifications/settings?field=backups',
      '/notifications/settings?field=subscription',
      '/notifications/settings?field=badges',
      '/notifications/settings?field=quiet',
      '/notifications/settings?field=delivery',
      '/settings/profile/edit','/settings/security?field=pin',
      '/settings/security?field=relock','/settings/security?field=emergency',
      '/settings/security?field=devices','/settings/security?field=key',
      '/settings/security?field=inactivity','/settings/storage',
      '/settings/payments','/settings/help',
    ])
    expect(searchSettings('')).toEqual(
      settingsSearchEntries.filter(entry => entry.to !== null),
    )
    expect(new Set(settingsSearchEntries.map(entry => entry.id)).size)
      .toBe(settingsSearchEntries.length)
    expect(settingsSearchEntries.filter(entry => entry.to !== null)).toHaveLength(28)
  })
  it('routes RU/EN notification searches to exact working controls', () => {
    for(const [word,id,field] of [
      ['тихие часы','notification-quiet','quiet'],
      ['quiet hours','notification-quiet','quiet'],
      ['delivery','notification-delivery','delivery'],
      ['приглашения','notification-invitations','invitations'],
      ['новые файлы','notification-new-files','newFiles'],
      ['review','notification-reviews','reviews'],
      ['backup','notification-backups','backups'],
      ['subscription','notification-subscription','subscription'],
    ] as const){
      expect(searchSettings(word).find(item=>item.id===id)?.to)
        .toBe('/notifications/settings?field='+field)
    }
  })
  it('routes security search to the exact approved field, including disabled controls', () => {
    expect(searchSettings('PIN экстренного').find(item => item.id==='emergency-pin')?.to)
      .toBe('/settings/security?field=emergency')
    expect(searchSettings('recovery').find(item => item.id==='recovery')?.to)
      .toBe('/settings/security?field=key')
    expect(searchSettings('неактивность').find(item => item.id==='inactivity')?.to)
      .toBe('/settings/security?field=inactivity')
  })
  it('never treats messages as a nested Contacts settings route', () => {
    expect(settingsSearchEntries.some(entry => entry.id === 'messages')).toBe(false)
    expect(searchSettings('несуществующее слово')).toEqual([])
    expect(searchSettings('a'.repeat(201))).toEqual([])
  })
})
