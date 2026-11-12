/**
 * Search index for the approved Fieldwork Settings UX.
 *
 * Only "available" entries have actionable links to an implemented PB3
 * destination. A source HTML design is NOT evidence of a working route.
 * Existing local-only settings (Appearance Dock) are indexed by exact
 * field anchor; other planned fields remain noninteractive.
 */
export interface SettingsSearchEntry {
  id: string
  label: string
  group: string
  description: string
  keywords: readonly string[]
  to: string | null
}

export const settingsSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'dock', label: 'Нижняя панель (Dock)', group: 'Оформление',
    description: 'Состав и порядок разделов нижней панели',
    keywords: ['док', 'dock', 'панель', 'навигация', 'navigation', 'пункты меню', 'кнопки', 'bottom bar'],
    to: '/settings/appearance?field=dock',
  },
  {
    id: 'contacts', label: 'Контакты и команды', group: 'Профиль и люди',
    description: 'Открыть существующий раздел контактов и команд',
    keywords: ['контакт', 'команд', 'contacts', 'teams', 'участники'],
    to: '/contacts',
  },
  {
    id: 'theme', label: 'Тема', group: 'Оформление',
    description: 'Тёмная, светлая и системная тема — ещё не подключены',
    keywords: ['тема', 'theme', 'темн', 'светл', 'system', 'dark', 'light'],
    to: null,
  },
  {
    id: 'accent', label: 'Основной цвет', group: 'Оформление',
    description: 'Цветовой акцент — ещё не подключён',
    keywords: ['цвет', 'акцент', 'accent', 'color', 'colour'],
    to: null,
  },
  {
    id: 'text-size', label: 'Размер текста', group: 'Оформление',
    description: 'Масштаб текста — ещё не подключён',
    keywords: ['шрифт', 'размер текста', 'text size', 'font', 'size'],
    to: null,
  },
  {
    id: 'start-page', label: 'Стартовая страница', group: 'Оформление',
    description: 'При запуске открывать камеру, задания или Browser',
    keywords: ['старт', 'запуск', 'начальный экран', 'launch page', 'start page', 'home'],
    to: '/settings/appearance?field=launch',
  },
  {
    id: 'language', label: 'Язык', group: 'Оформление',
    description: 'Русский / English — полная локализация ещё не подключена',
    keywords: ['язык', 'языки', 'language', 'locale', 'русский', 'english', 'localization'],
    to: null,
  },
  {
    id: 'notifications', label: 'Уведомления', group: 'Приложение',
    description: 'Управление уведомлениями — ещё не подключено',
    keywords: ['уведомлен', 'push', 'notifications', 'badge'],
    to: null,
  },
  {
    id: 'profile', label: 'Настройки профиля', group: 'Профиль и люди',
    description: 'Имя, описание и видимость — ещё не подключены',
    keywords: ['профил', 'profile', 'аватар', 'privacy', 'username'],
    to: null,
  },
  {
    id: 'security', label: 'Безопасность и приватность', group: 'Безопасность и данные',
    description: 'PIN и приватность — отдельный будущий экран',
    keywords: ['безопасность', 'pin', 'security', 'privacy', 'приватность'],
    to: null,
  },
  {
    id: 'storage', label: 'Данные и хранилище', group: 'Безопасность и данные',
    description: 'Очередь, кэш и резервные копии — ещё не подключены',
    keywords: ['хранилище', 'данные', 'кэш', 'storage', 'backup', 'cache'],
    to: null,
  },
  {
    id: 'payments', label: 'Платежи и тарифы', group: 'Подписка',
    description: 'Тарифы и оплата — ещё не подключены',
    keywords: ['тариф', 'оплата', 'plans', 'payments', 'subscription'],
    to: null,
  },
  {
    id: 'help', label: 'Помощь и документы', group: 'Информация',
    description: 'FAQ и правовая информация — ещё не подключены',
    keywords: ['помощь', 'faq', 'help', 'terms', 'документы'],
    to: null,
  },
]

// Lowercase Unicode text is enough for RU/EN Settings labels. No plaintext
// account data, ID, media metadata or recovery key enters this search index.
export function searchSettings(input: string): SettingsSearchEntry[] {
  const tokens = input.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  if (tokens.length === 0) {
    return settingsSearchEntries.filter(entry => entry.to !== null)
  }
  if (input.length > 200) return []
  return settingsSearchEntries.filter(entry => {
    const corpus = [
      entry.label, entry.group, entry.description, ...entry.keywords,
    ].join(' ').toLocaleLowerCase()
    return tokens.every(token => corpus.includes(token))
  })
}

export const implementedSearchTargets = settingsSearchEntries
  .filter(entry => entry.to !== null)
  .map(entry => entry.to)
