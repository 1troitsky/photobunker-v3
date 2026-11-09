import { createRouter, createWebHistory } from 'vue-router'
import FoundationScreen from './views/FoundationScreen.vue'
import AccountView from './views/AccountView.vue'
import CaptureView from './views/CaptureView.vue'
import PhotoBrowserView from './views/PhotoBrowserView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/assignments' },
    { path: '/assignments', component: FoundationScreen, meta: { title: 'Задания' } },
    { path: '/browser', component: PhotoBrowserView, meta: { title: 'Browser' } },
    { path: '/camera', component: CaptureView, meta: { title: 'Камера' } },
    { path: '/contacts', component: FoundationScreen, meta: { title: 'Контакты' } },
    { path: '/settings', component: AccountView, meta: { title: 'Настройки' } },
    { path: '/:pathMatch(.*)*', redirect: '/assignments' },
  ],
})
