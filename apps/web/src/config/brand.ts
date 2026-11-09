export interface Brand {
  readonly name: string
  readonly shortName: string
  readonly mark: string
}

export function resolveBrand(source: { VITE_APP_NAME?: string; VITE_APP_SHORT_NAME?: string; VITE_APP_MARK?: string }): Brand {
  return {
    name: source.VITE_APP_NAME?.trim() || 'Example Application',
    shortName: source.VITE_APP_SHORT_NAME?.trim() || 'Example',
    mark: source.VITE_APP_MARK?.trim() || 'app',
  }
}
export const brand = resolveBrand(import.meta.env)
