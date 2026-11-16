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
    description: 'Тёмная, светлая или системная тема устройства',
    keywords: ['тема', 'theme', 'темн', 'светл', 'system', 'dark', 'light'],
    to: '/settings/appearance?field=theme',
  },
  {
    id: 'accent', label: 'Основной цвет', group: 'Оформление',
    description: 'Зелёный, серый, янтарный или коралловый акцент',
    keywords: ['цвет', 'акцент', 'accent', 'color', 'colour'],
    to: '/settings/appearance?field=accent',
  },
  {
    id: 'text-size', label: 'Размер текста', group: 'Оформление',
    description: 'Мелкий, обычный или крупный текст',
    keywords: ['шрифт', 'размер текста', 'text size', 'font', 'size'],
    to: '/settings/appearance?field=size',
  },
  {
    id: 'start-page', label: 'Стартовая страница', group: 'Оформление',
    description: 'При запуске открывать камеру, задания или Browser',
    keywords: ['старт', 'запуск', 'начальный экран', 'launch page', 'start page', 'home'],
    to: '/settings/appearance?field=launch',
  },
  {
    id: 'language', label: 'Язык', group: 'Оформление',
    description: 'Русский / English — выбор языка интерфейса на устройстве',
    keywords: ['язык', 'языки', 'language', 'locale', 'русский', 'english', 'localization'],
    to: '/settings/appearance?field=language',
  },
  {
    id: 'notifications', label: 'Уведомления', group: 'Приложение',
    description: 'Локальный зашифрованный inbox и настройки уведомлений',
    keywords: ['уведомлен', 'push', 'notifications', 'badge'],
    to: '/notifications',
  },
  {
    id: 'notification-invitations', label: 'Приглашения', group: 'Настройки уведомлений',
    description: 'Уведомления о приглашениях в задания и команды',
    keywords: ['приглашения', 'invitation', 'invites', 'teams', 'задания', 'notifications'],
    to: '/notifications/settings?field=invitations',
  },
  {
    id: 'notification-deadlines', label: 'Сроки заданий', group: 'Настройки уведомлений',
    description: 'Локальные напоминания о сроках заданий',
    keywords: ['срок', 'дедлайн', 'deadline', 'reminder', 'notifications'],
    to: '/notifications/settings?field=deadlines',
  },
  {
    id: 'notification-expiry', label: 'Удаление файлов', group: 'Настройки уведомлений',
    description: 'Отображение уведомлений об истечении хранения',
    keywords: ['удаление', 'файл', 'expiry', 'retention', 'notifications'],
    to: '/notifications/settings?field=expiry',
  },
  {
    id: 'notification-badges', label: 'Индикаторы уведомлений', group: 'Настройки уведомлений',
    description: 'Значки непрочитанных уведомлений в приложении',
    keywords: ['значок', 'индикатор', 'badge', 'unread', 'notifications'],
    to: '/notifications/settings?field=badges',
  },
  {
    id: 'notification-quiet', label: 'Тихие часы', group: 'Настройки уведомлений',
    description: 'Время скрытия обычных индикаторов',
    keywords: ['тихие часы', 'тихий', 'quiet hours', 'quiet', 'silent', 'notifications'],
    to: '/notifications/settings?field=quiet',
  },
  {
    id: 'notification-delivery', label: 'Проверка доставки уведомлений', group: 'Настройки уведомлений',
    description: 'Проверка доступности внутренних событий и системных разрешений',
    keywords: ['доставка', 'delivery', 'push', 'permission', 'разрешение', 'notifications'],
    to: '/notifications/settings?field=delivery',
  },
  {
    id: 'profile', label: 'Настройки профиля', group: 'Профиль и люди',
    description: 'Зашифрованное имя, описание и локальные предпочтения',
    keywords: ['профил', 'profile', 'аватар', 'privacy', 'username'],
    to: '/settings/profile/edit',
  },
  {
    id: 'security', label: 'Безопасность и приватность', group: 'Безопасность и данные',
    description: 'Состояние PIN, устройство и подтверждённая сессия',
    keywords: ['безопасность', 'pin', 'security', 'privacy', 'приватность'],
    to: '/settings/security?field=pin',
  },
  {
    id: 'relock', label: 'Через какое время запрашивать PIN',
    group: 'Безопасность и данные',
    description: 'Время повторной блокировки (пока PIN недоступен)',
    keywords: ['таймер', 'время', 'разблокировка', 'relock', 'timeout', 'slider', 'pin'],
    to: '/settings/security?field=relock',
  },
  {
    id: 'emergency-pin', label: 'PIN экстренного удаления', group: 'Безопасность и данные',
    description: 'Экстренное удаление (функция ещё не активирована)',
    keywords: ['экстренный', 'аварийный', 'panic', 'emergency', 'pin', 'удаление'],
    to: '/settings/security?field=emergency',
  },
  {
    id: 'devices', label: 'Другие устройства', group: 'Безопасность и данные',
    description: 'Подтверждённый серверный список устройств',
    keywords: ['устройства', 'устройство', 'девайс', 'devices', 'revoke', 'выход'],
    to: '/settings/security?field=devices',
  },
  {
    id: 'recovery', label: 'Recovery Key', group: 'Безопасность и данные',
    description: 'Сведения о ключе восстановления',
    keywords: ['ключ', 'восстановление', 'recovery', 'key', 'пароль'],
    to: '/settings/security?field=key',
  },
  {
    id: 'inactivity', label: 'Dead Man’s Switch', group: 'Безопасность и данные',
    description: 'Автоудаление при неактивности (пока недоступно)',
    keywords: ['неактивность', 'автоудаление', 'inactivity', 'dead man', 'switch'],
    to: '/settings/security?field=inactivity',
  },
  {
    id: 'storage', label: 'Данные и хранилище', group: 'Безопасность и данные',
    description: 'Зашифрованная очередь, объём и резервные копии',
    keywords: ['хранилище', 'данные', 'кэш', 'storage', 'backup', 'cache'],
    to: '/settings/storage',
  },
  {
    id: 'payments', label: 'Платежи и тарифы', group: 'Подписка',
    description: 'Подтверждённый серверный тариф и актуальный каталог',
    keywords: ['тариф', 'оплата', 'plans', 'payments', 'subscription'],
    to: '/settings/payments',
  },
  {
    id: 'help', label: 'Помощь и документы', group: 'Информация',
    description: 'Офлайн FAQ и черновики документов',
    keywords: ['помощь', 'faq', 'help', 'terms', 'документы'],
    to: '/settings/help',
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
