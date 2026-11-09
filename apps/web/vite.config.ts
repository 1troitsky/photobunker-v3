import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const name = env.VITE_APP_NAME?.trim() || 'Example Application'
  const shortName = env.VITE_APP_SHORT_NAME?.trim() || 'Example'
  const accent = env.VITE_APP_THEME_COLOR?.trim() || '#1ed760'

  return {
    plugins: [
      vue(),
      VitePWA({
        // P0 intentionally does not install/activate a Service Worker.
        // Signed-release trust design must be approved before registration.
        injectRegister: false,
        registerType: 'prompt',
        manifest: {
          id: '/',
          name,
          short_name: shortName,
          description: 'A private media workspace.',
          display: 'standalone',
          start_url: '/assignments',
          scope: '/',
          theme_color: accent,
          background_color: '#121212',
          icons: [
            { src: '/icons/app.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
      }),
    ],
    server: {
      host: '127.0.0.1', port: 5173,
      proxy: {
        '/identity/v2': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/photos/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/shares/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/assignments/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
      },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  }
})
