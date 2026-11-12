/** Build/runtime brand contract. No network request, no account/crypto identifier rewriting. */
export interface Brand {
  readonly name: string
  readonly shortName: string
  readonly slug: string
  readonly mark: string
  readonly publicUrl: string
  readonly themeColor: string
  readonly iconUrl: string
}
export interface BrandSource {
  readonly VITE_APP_NAME?: string
  readonly VITE_APP_SHORT_NAME?: string
  readonly VITE_APP_SLUG?: string
  readonly VITE_APP_MARK?: string
  readonly VITE_APP_PUBLIC_URL?: string
  readonly VITE_APP_THEME_COLOR?: string
  readonly VITE_APP_ICON_URL?: string
}

function value(input: string | undefined, fallback: string): string {
  return input?.trim() || fallback
}
function publicOrigin(input: string): string {
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Invalid VITE_APP_PUBLIC_URL') }
  const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!loopback && url.protocol !== 'https:') || !url.hostname ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Invalid VITE_APP_PUBLIC_URL: expected a clean HTTPS origin (or HTTP loopback for development)')
  }
  return url.origin
}
function iconPath(input: string): string {
  // Only same-origin, explicitly shipped SVG icons; never a remote URL or traversal.
  if (!/^\/icons\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.svg$/.test(input)) {
    throw new Error('Invalid VITE_APP_ICON_URL: expected /icons/*.svg')
  }
  return input
}
export function resolveBrand(source: BrandSource): Brand {
  const slug = value(source.VITE_APP_SLUG, 'example-app')
  const themeColor = value(source.VITE_APP_THEME_COLOR, '#1ed760')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid VITE_APP_SLUG')
  if (!/^#[a-fA-F0-9]{6}$/.test(themeColor)) throw new Error('Invalid VITE_APP_THEME_COLOR')
  return {
    name: value(source.VITE_APP_NAME, 'Example Application'),
    shortName: value(source.VITE_APP_SHORT_NAME, 'Example'),
    slug,
    mark: value(source.VITE_APP_MARK, 'app'),
    publicUrl: publicOrigin(value(source.VITE_APP_PUBLIC_URL, 'https://example.invalid')),
    themeColor,
    iconUrl: iconPath(value(source.VITE_APP_ICON_URL, '/icons/app.svg')),
  }
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}
function replaceRequired(html: string, pattern: RegExp, replacement: string, marker: string): string {
  if (!pattern.test(html)) throw new Error('Missing brand HTML marker: ' + marker)
  return html.replace(pattern, replacement)
}
/** Vite transforms the actual initial HTML in development and production. */
export function renderBrandHtml(html: string, config: Brand): string {
  let result = replaceRequired(html, /<title>[^<]*<\/title>/i,
    '<title>' + escapeHtml(config.name) + '</title>', 'title')
  result = replaceRequired(result, /<meta name="theme-color" content="[^"]*">/i,
    '<meta name="theme-color" content="' + escapeHtml(config.themeColor) + '">', 'theme-color')
  result = replaceRequired(result, /<link rel="icon" type="image\/svg\+xml" href="[^"]*">/i,
    '<link rel="icon" type="image/svg+xml" href="' + escapeHtml(config.iconUrl) + '">', 'favicon')
  return result
}
