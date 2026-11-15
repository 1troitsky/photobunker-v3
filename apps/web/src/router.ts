import { createRouter, createWebHistory } from 'vue-router'
import { resolveStartRoute } from './ui/fieldwork/appearance-preferences'
import { activeSession } from './features/identity/application/session'
import WelcomeView from './views/WelcomeView.vue'
import AuthorizationErrorView from './views/AuthorizationErrorView.vue'
import AssignmentsView from './views/AssignmentsView.vue'
import AssignmentEditorView from './views/AssignmentEditorView.vue'
import AccountView from './views/AccountView.vue'
import AppearanceView from './views/AppearanceView.vue'
import DataStorageView from './views/DataStorageView.vue'
import SettingsSearchView from './views/SettingsSearchView.vue'
import HelpView from './views/HelpView.vue'
import CaptureView from './views/CaptureView.vue'
import PhotoBrowserView from './views/PhotoBrowserView.vue'
import FileViewerView from './views/FileViewerView.vue'
import ContactsTeamsView from './views/ContactsTeamsView.vue'
import NotificationsView from './views/NotificationsView.vue'
import NotificationSettingsView from './views/NotificationSettingsView.vue'
import MessagesView from './views/MessagesView.vue'
import ProfileView from './views/ProfileView.vue'
import ProfileEditView from './views/ProfileEditView.vue'
import SecurityPrivacyView from './views/SecurityPrivacyView.vue'
import PaymentsView from './views/PaymentsView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: () => activeSession.value?resolveStartRoute():'/welcome' },
    { path: '/welcome', component: WelcomeView, meta: { title:'Welcome',standalone:true } },
    { path: '/welcome/create', component: WelcomeView, meta: { title:'Создать аккаунт',standalone:true } },
    { path: '/welcome/recover', component: WelcomeView, meta: { title:'Восстановить аккаунт',standalone:true } },
    { path: '/authorization-error', component: AuthorizationErrorView,
      meta: {title:'Ошибка доступа',standalone:true} },
    { path: '/assignments', component: AssignmentsView, meta: { title: 'Задания' } },
    { path: '/assignments/:assignmentId/edit', component: AssignmentEditorView,
      meta: { title: 'Редактор задания' } },
    { path: '/browser', component: PhotoBrowserView, meta: { title: 'Browser' } },
    { path: '/browser/file/:protocol/:id', name: 'browser-viewer',
      component: FileViewerView, meta: { title: 'Просмотр файла' } },
    // Reuse the same authorized, Local-First file lifecycle and E2EE
    // processing pipeline. The Editor is a distinct user-facing route,
    // not a second implementation of the JPEG/WAV/still engine.
    { path: '/browser/file/:protocol/:id/edit', name: 'browser-editor',
      component: FileViewerView, meta: { title: 'Редактирование файла' } },
    { path: '/camera', component: CaptureView, meta: { title: 'Камера' } },
    { path: '/contacts', component: ContactsTeamsView, meta: { title: 'Контакты и Команды' } },
    { path: '/settings', component: AccountView, meta: { title: 'Настройки' } },
    { path: '/settings/profile', component: ProfileView,
      meta: { title: 'Мой профиль' } },
    { path: '/settings/profile/edit', component: ProfileEditView,
      meta: { title: 'Настройки профиля' } },
    { path: '/settings/security', component: SecurityPrivacyView,
      meta: { title: 'Безопасность и приватность' } },
    { path: '/settings/payments', component: PaymentsView,
      meta: { title: 'Платежи и тарифы' } },
    { path: '/settings/appearance', component: AppearanceView,
      meta: { title: 'Оформление' } },
    { path: '/settings/storage', component: DataStorageView,
      meta: { title: 'Данные и хранилище' } },
    { path: '/settings/help', component: HelpView,
      meta: { title: 'Помощь и информация' } },
    { path: '/settings/search', component: SettingsSearchView,
      meta: { title: 'Поиск по настройкам' } },
    // Encrypted local inbox; does not imply server delivery or push.
    { path: '/notifications', component: NotificationsView,
      meta: { title: 'Уведомления' } },
    { path: '/notifications/settings', component: NotificationSettingsView,
      meta: { title: 'Настройки уведомлений' } },
    // E2EE device-local drafts ONLY; no Matrix send, remote rooms or delivery.
    { path: '/messages', component: MessagesView,
      meta: { title: 'Сообщения — локальные черновики' } },
    { path: '/:pathMatch(.*)*', redirect: '/assignments' },
  ],
})
