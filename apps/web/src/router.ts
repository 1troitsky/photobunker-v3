import { createRouter, createWebHistory } from 'vue-router'
import FoundationScreen from './views/FoundationScreen.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/assignments' },
    { path: '/assignments', component: FoundationScreen, meta: { title: 'Задания' } },
    { path: '/browser', component: FoundationScreen, meta: { title: 'Browser' } },
    { path: '/camera', component: FoundationScreen, meta: { title: 'Камера' } },
    { path: '/contacts', component: FoundationScreen, meta: { title: 'Контакты' } },
    { path: '/settings', component: FoundationScreen, meta: { title: 'Настройки' } },
    { path: '/:pathMatch(.*)*', redirect: '/assignments' },
  ],
})
