import { describe, expect, it } from 'vitest'
import { resolveBrand } from './brand'

describe('configurable branding', () => {
  it('uses environment values rather than a hard-coded product name', () => {
    expect(resolveBrand({ VITE_APP_NAME: 'New Name', VITE_APP_SHORT_NAME: 'NN', VITE_APP_MARK: 'x' }))
      .toEqual({ name: 'New Name', shortName: 'NN', mark: 'x' })
  })
  it('has a neutral fallback for unconfigured development', () => {
    expect(resolveBrand({}).name).toBe('Example Application')
  })
})
