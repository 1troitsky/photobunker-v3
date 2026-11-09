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

// Explicit keys satisfy TypeScript's structural check for optional-only inputs.
export const brand = resolveBrand({
  VITE_APP_NAME: import.meta.env.VITE_APP_NAME,
  VITE_APP_SHORT_NAME: import.meta.env.VITE_APP_SHORT_NAME,
  VITE_APP_MARK: import.meta.env.VITE_APP_MARK,
})
