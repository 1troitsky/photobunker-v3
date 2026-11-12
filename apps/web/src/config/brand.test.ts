import { describe, expect, it } from 'vitest'
import { renderBrandHtml, resolveBrand } from './brand-build'

describe('configurable branding', () => {
  it('changes user-facing brand and public origin without editing product code', () => {
    expect(resolveBrand({
      VITE_APP_NAME: 'Example Beta',
      VITE_APP_SHORT_NAME: 'Beta',
      VITE_APP_SLUG: 'example-beta',
      VITE_APP_MARK: 'B',
      VITE_APP_PUBLIC_URL: 'https://beta.example.org/',
      VITE_APP_THEME_COLOR: '#123456',
      VITE_APP_ICON_URL: '/icons/beta.svg',
    })).toEqual({
      name: 'Example Beta',
      shortName: 'Beta',
      slug: 'example-beta',
      mark: 'B',
      publicUrl: 'https://beta.example.org',
      themeColor: '#123456',
      iconUrl: '/icons/beta.svg',
    })
  })
  it('uses an unbranded neutral fallback', () => {
    expect(resolveBrand({})).toMatchObject({
      name: 'Example Application', slug: 'example-app',
      iconUrl: '/icons/app.svg', publicUrl: 'https://example.invalid',
    })
  })
  it('updates initial HTML title, favicon, and install theme together', () => {
    const html = '<head><title>Application</title><meta name="theme-color" content="#121212"><link rel="icon" type="image/svg+xml" href="/icons/app.svg"></head>'
    const config = resolveBrand({VITE_APP_NAME: 'A&B <Safe>', VITE_APP_THEME_COLOR: '#abcdef', VITE_APP_ICON_URL: '/icons/beta.svg'})
    const branded = renderBrandHtml(html, config)
    expect(branded).toContain('<title>A&amp;B &lt;Safe&gt;</title>')
    expect(branded).toContain('content="#abcdef"')
    expect(branded).toContain('href="/icons/beta.svg"')
    expect(branded).not.toContain('<Safe>')
    expect(() => renderBrandHtml('<head></head>', config)).toThrow(/marker/)
  })
  it('rejects credentials, cross-origin icons, script schemes, and malformed colors', () => {
    for (const unsafe of ['javascript:alert(1)', 'http://external.example', 'https://user:pass@example.org', 'https://example.org/?secret=x']) {
      expect(() => resolveBrand({VITE_APP_PUBLIC_URL: unsafe})).toThrow(/VITE_APP_PUBLIC_URL/)
    }
    for (const icon of ['https://evil.example/icon.svg', '//evil.example/icon.svg', '/icons/../secret.svg', '/icons/a.svg?x=1']) {
      expect(() => resolveBrand({VITE_APP_ICON_URL: icon})).toThrow(/VITE_APP_ICON_URL/)
    }
    expect(() => resolveBrand({VITE_APP_THEME_COLOR: 'red; background:url(x)'})).toThrow(/VITE_APP_THEME_COLOR/)
    expect(() => resolveBrand({VITE_APP_SLUG: '../media'})).toThrow(/VITE_APP_SLUG/)
  })
  it('permits HTTP loopback for local Vite development only', () => {
    expect(resolveBrand({VITE_APP_PUBLIC_URL:'http://127.0.0.1:5173'}).publicUrl)
      .toBe('http://127.0.0.1:5173')
  })
})
