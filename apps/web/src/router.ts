import { createRouter, createWebHistory } from 'vue-router'
import { resolveStartRoute } from './ui/fieldwork/appearance-preferences'
import AssignmentsView from './views/AssignmentsView.vue'
import AssignmentEditorView from './views/AssignmentEditorView.vue'
import AccountView from './views/AccountView.vue'
import AppearanceView from './views/AppearanceView.vue'
import SettingsSearchView from './views/SettingsSearchView.vue'
import CaptureView from './views/CaptureView.vue'
import PhotoBrowserView from './views/PhotoBrowserView.vue'
import FileViewerView from './views/FileViewerView.vue'
import ContactsTeamsView from './views/ContactsTeamsView.vue'
import NotificationsView from './views/NotificationsView.vue'
import NotificationSettingsView from './views/NotificationSettingsView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: () => resolveStartRoute() },
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
    { path: '/settings/appearance', component: AppearanceView,
      meta: { title: 'Оформление' } },
    { path: '/settings/search', component: SettingsSearchView,
      meta: { title: 'Поиск по настройкам' } },
    // Encrypted local inbox; does not imply server delivery or push.
    { path: '/notifications', component: NotificationsView,
      meta: { title: 'Уведомления' } },
    { path: '/notifications/settings', component: NotificationSettingsView,
      meta: { title: 'Настройки уведомлений' } },
    { path: '/:pathMatch(.*)*', redirect: '/assignments' },
  ],
})
