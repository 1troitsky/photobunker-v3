import { resolveBrand } from './brand-build'
export { resolveBrand } from './brand-build'
export type { Brand } from './brand-build'

// The HTML/PWA build and live Shell/Help read the same validated contract.
// Public URL is configuration only: never rewrite established account/media IDs.
export const brand = resolveBrand({
  VITE_APP_NAME: import.meta.env.VITE_APP_NAME,
  VITE_APP_SHORT_NAME: import.meta.env.VITE_APP_SHORT_NAME,
  VITE_APP_SLUG: import.meta.env.VITE_APP_SLUG,
  VITE_APP_MARK: import.meta.env.VITE_APP_MARK,
  VITE_APP_PUBLIC_URL: import.meta.env.VITE_APP_PUBLIC_URL,
  VITE_APP_THEME_COLOR: import.meta.env.VITE_APP_THEME_COLOR,
  VITE_APP_ICON_URL: import.meta.env.VITE_APP_ICON_URL,
})
