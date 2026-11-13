import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { renderBrandHtml, resolveBrand } from './src/config/brand-build.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const configuredBrand = resolveBrand({
    VITE_APP_NAME: env.VITE_APP_NAME,
    VITE_APP_SHORT_NAME: env.VITE_APP_SHORT_NAME,
    VITE_APP_SLUG: env.VITE_APP_SLUG,
    VITE_APP_MARK: env.VITE_APP_MARK,
    VITE_APP_PUBLIC_URL: env.VITE_APP_PUBLIC_URL,
    VITE_APP_THEME_COLOR: env.VITE_APP_THEME_COLOR,
    VITE_APP_ICON_URL: env.VITE_APP_ICON_URL,
  })

  // Manifest and favicon must refer to an actual bundled, same-origin asset.
  const iconFile = resolvePath(process.cwd(), 'public', configuredBrand.iconUrl.slice(1))
  if (!existsSync(iconFile)) throw new Error('Branded PWA icon does not exist: ' + configuredBrand.iconUrl)

  return {
    plugins: [
      vue(),
      {
        name: 'pb3-brand-initial-html',
        transformIndexHtml(html: string) { return renderBrandHtml(html, configuredBrand) },
      },
      VitePWA({
        // P0 intentionally does not install/activate a Service Worker.
        // Signed-release trust design must be approved before registration.
        injectRegister: false,
        registerType: 'prompt',
        manifest: {
          id: '/',
          name: configuredBrand.name,
          short_name: configuredBrand.shortName,
          description: 'A private media workspace.',
          display: 'standalone',
          start_url: '/assignments',
          scope: '/',
          theme_color: configuredBrand.themeColor,
          background_color: '#121212',
          icons: [
            { src: configuredBrand.iconUrl, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
      }),
    ],
    server: {
      host: '127.0.0.1', port: 5173,
      proxy: {
        // Backend exposes the verified own-account entitlement under this
        // path. Without this proxy the PWA silently got Vite 404 and kept
        // Free13 forever, even for verified Go/Pro subscribers.
        '/billing/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/identity/v2': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/photos/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/media/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/media-shares/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/media-file-preview/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/shares/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/assignments/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/teams/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/teams/v2': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/notifications/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/folders/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
        '/browser/v1': { target:'http://127.0.0.1:8000', changeOrigin:false },
      },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  }
})
