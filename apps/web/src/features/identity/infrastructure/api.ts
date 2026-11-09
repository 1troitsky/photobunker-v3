// Same-origin, CSRF-protected transport. Keys, signatures and ciphertext are never logged.
let csrfToken: string | null = null
let csrfPromise: Promise<string> | null = null

export function resetCsrf(): void {
  csrfToken = null
  csrfPromise = null
}

async function csrf(): Promise<string> {
  if (csrfToken) return csrfToken
  if (!csrfPromise) {
    csrfPromise = fetch('/identity/v2/csrf', {
      credentials: 'same-origin', cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw new Error('identity.csrf_unavailable')
      const value = await response.json() as { csrfToken: string }
      if (typeof value.csrfToken !== 'string' || value.csrfToken.length < 20)
        throw new Error('identity.csrf_invalid')
      csrfToken = value.csrfToken
      return value.csrfToken
    }).finally(() => { csrfPromise = null })
  }
  return csrfPromise
}

async function request(path: string, method: 'GET'|'POST'|'PUT', data?: unknown): Promise<Response> {
  const headers: Record<string,string> = { Accept: 'application/json' }
  if (method !== 'GET') headers['X-CSRF-TOKEN'] = await csrf()
  let body: BodyInit | undefined
  if (data instanceof Blob) {
    headers['Content-Type'] = 'application/octet-stream'
    body = data
  } else if (data !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(data)
  }
  const response = await fetch(path, {
    method, body, headers, credentials: 'same-origin', cache: 'no-store',
  })
  if (!response.ok) {
    if (response.status === 419) resetCsrf()
    throw new Error('api.http_' + String(response.status))
  }
  return response
}

export async function jsonApi<T>(path: string, method: 'GET'|'POST' = 'GET', data?: unknown): Promise<T> {
  const response = await request(path,method,data)
  return response.json() as Promise<T>
}

export async function putCiphertext(path: string, blob: Blob): Promise<void> {
  await request(path, 'PUT', blob)
}

export async function readCiphertext(path: string): Promise<{ blob:Blob; digest:string | null }> {
  const response = await request(path,'GET')
  return { blob:await response.blob(), digest:response.headers.get('X-Cipher-SHA256') }
}
