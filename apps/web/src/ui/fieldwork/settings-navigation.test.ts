import { describe, expect, it } from 'vitest'
import { settingsGroups, availableSettingsRoutes } from './settings-navigation'

describe('Fieldwork settings navigation against PB3 shipped routes', () => {
  it('preserves all owner-approved section families without inventing separate apps', () => {
    expect(settingsGroups.map(group => group.title)).toEqual([
      'Профиль и люди', 'Приложение', 'Безопасность и данные',
      'Подписка', 'Информация',
    ])
    expect(settingsGroups.find(group => group.id === 'people')
      ?.entries.map(entry => entry.id)).toEqual([
      'profile-card', 'profile-edit', 'contacts-teams',
    ])
  })

  it('routes only implemented settings features, including real Help/FAQ and encrypted storage status', () => {
    expect(availableSettingsRoutes).toEqual(['/contacts','/settings/appearance','/notifications','/settings/storage','/settings/help'])
    const paths = settingsGroups.flatMap(group => group.entries)
    expect(new Set(paths.map(entry => entry.id)).size).toBe(paths.length)
    expect(paths.filter(entry => entry.to !== null)).toEqual([
      expect.objectContaining({ id: 'contacts-teams', to: '/contacts' }),
      expect.objectContaining({ id: 'appearance', to: '/settings/appearance' }),
      expect.objectContaining({ id: 'notifications', to: '/notifications' }),
      expect.objectContaining({ id: 'data-storage', to: '/settings/storage' }),
      expect.objectContaining({ id: 'help', to: '/settings/help' }),
    ])
    expect(paths.filter(entry => entry.to === null)).toHaveLength(4)
  })

  it('does not misrepresent Messages as a Contacts child or a shipped profile', () => {
    const ids = settingsGroups.flatMap(group => group.entries.map(entry => entry.id))
    expect(ids).not.toContain('messages')
    expect(ids).not.toContain('team-chat')
    expect(ids).not.toContain('public-profile-route')
  })
})
