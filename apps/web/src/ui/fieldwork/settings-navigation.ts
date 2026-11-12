// Fieldwork Settings 1.6 is WIP: keep navigation explicit, and do not
// present prototype-only pages as real production routes.
export interface SettingsEntry {
  id: string
  label: string
  description: string
  to: string | null
}
export interface SettingsGroup {
  id: string
  title: string
  entries: readonly SettingsEntry[]
}

// Contacts has an existing authorized PB3 route; Appearance now has a real
// locally persisted Dock editor. Other source HTML designs are not routes.
export const settingsGroups: readonly SettingsGroup[] = [
  {
    id: 'people', title: 'Профиль и люди', entries: [
      {id:'profile-card',label:'Карточка профиля',description:'Профиль и его видимость',to:null},
      {id:'profile-edit',label:'Настройки профиля',description:'Имя, описание и приватность',to:null},
      {id:'contacts-teams',label:'Контакты и команды',description:'Контакты, команды и участники',to:'/contacts'},
    ],
  },
  {
    id: 'application', title: 'Приложение', entries: [
      {id:'appearance',label:'Оформление',description:'Порядок и состав нижней панели',to:'/settings/appearance'},
      {id:'notifications',label:'Уведомления',description:'События и параметры уведомлений',to:null},
    ],
  },
  {
    id: 'security', title: 'Безопасность и данные', entries: [
      {id:'security-privacy',label:'Безопасность и приватность',description:'PIN, устройства и Recovery Key',to:null},
      {id:'data-storage',label:'Данные и хранилище',description:'Очередь, кэш и резервные копии',to:null},
    ],
  },
  {
    id: 'subscription', title: 'Подписка', entries: [
      {id:'payments',label:'Платежи и тарифы',description:'Тариф, продление и история',to:null},
    ],
  },
  {
    id: 'information', title: 'Информация', entries: [
      {id:'help',label:'Помощь, FAQ и документы',description:'О приложении, помощь и правовые документы',to:null},
    ],
  },
]

export const availableSettingsRoutes = settingsGroups
  .flatMap(group => group.entries)
  .filter(entry => entry.to !== null)
  .map(entry => entry.to)
