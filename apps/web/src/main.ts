import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { brand } from './config/brand'
import './styles.css'

document.title = brand.name
// P0 deliberately does NOT register a Service Worker pending signed-release design.
// Navigation and this shell are available without waiting for any network identity call.
createApp(App).use(router).mount('#app')
