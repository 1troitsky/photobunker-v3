import { createRouter, createWebHistory } from 'vue-router'
import FoundationScreen from './views/FoundationScreen.vue'
import AssignmentsView from './views/AssignmentsView.vue'
import AssignmentEditorView from './views/AssignmentEditorView.vue'
import AccountView from './views/AccountView.vue'
import CaptureView from './views/CaptureView.vue'
import PhotoBrowserView from './views/PhotoBrowserView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/assignments' },
    { path: '/assignments', component: AssignmentsView, meta: { title: 'Задания' } },
    { path: '/assignments/:assignmentId/edit', component: AssignmentEditorView,
      meta: { title: 'Редактор задания' } },
    { path: '/browser', component: PhotoBrowserView, meta: { title: 'Browser' } },
    { path: '/camera', component: CaptureView, meta: { title: 'Камера' } },
    { path: '/contacts', component: FoundationScreen, meta: { title: 'Контакты' } },
    { path: '/settings', component: AccountView, meta: { title: 'Настройки' } },
    { path: '/:pathMatch(.*)*', redirect: '/assignments' },
  ],
})
