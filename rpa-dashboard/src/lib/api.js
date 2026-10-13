/**
 * API client.
 *
 * Rules that make this production-grade for a bank deployment:
 *  - **Relative URLs only** (`/api/...`): works behind any reverse proxy and
 *    through the sandbox preview host; there is no baked-in `API_BASE`.
 *  - **Access token in memory only** (never localStorage) — XSS cannot steal a
 *    long-lived credential; the refresh token lives in an HttpOnly cookie.
 *  - **Double-submit CSRF**: the `csrf_token` cookie is echoed in
 *    `X-CSRF-Token` on state-changing requests.
 *  - **Single-flight refresh**: parallel 401s wait for one rotation, so the
 *    refresh-token family is never invalidated by a race.
 *  - **Typed errors**: every failure becomes an `ApiError` with a code, so the
 *    UI can render actionable Arabic/English messages.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network_error', details = [], requestId = '' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }

  get isAuth() {
    return this.status === 401
  }

  /** Field-level messages for form rendering. */
  get fieldErrors() {
    const out = {}
    for (const item of this.details || []) {
      if (item && item.field) out[item.field] = item.message
    }
    return out
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

let accessToken = null
let refreshPromise = null
let onUnauthenticated = null

export function setAccessToken(token) {
  accessToken = token || null
}

export function getAccessToken() {
  return accessToken
}

export function setUnauthenticatedHandler(handler) {
  onUnauthenticated = handler
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

function tenantKey() {
  try {
    return localStorage.getItem('rpa.tenant') || ''
  } catch {
    return ''
  }
}

async function parse(response) {
  const type = response.headers.get('content-type') || ''
  if (type.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }
  return response.text()
}

function toError(payload, response) {
  const error = payload && typeof payload === 'object' ? payload.error : null
  if (error) {
    return new ApiError(error.message || 'Request failed', {
      status: response.status,
      code: error.code || 'error',
      details: error.details || [],
      requestId: error.request_id || response.headers.get('x-correlation-id') || '',
    })
  }
  return new ApiError(typeof payload === 'string' && payload ? payload : 'Request failed', {
    status: response.status,
    requestId: response.headers.get('x-correlation-id') || '',
  })
}

async function rotateRefreshToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': readCookie('csrf_token'),
          ...(tenantKey() ? { 'X-Tenant-Key': tenantKey() } : {}),
        },
        body: JSON.stringify({}),
      })
      if (!response.ok) throw toError(await parse(response), response)
      const data = await response.json()
      setAccessToken(data.access_token)
      return data
    })()
      .catch((error) => {
        setAccessToken(null)
        if (onUnauthenticated) onUnauthenticated(error)
        throw error
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

/**
 * Perform an authenticated request.
 *
 * @param {string} path - absolute API path, e.g. `/api/dashboard-data`
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object|FormData} [options.body]
 * @param {boolean} [options.retryAuth] - internal: prevents refresh loops
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<any>}
 */
export async function request(path, options = {}) {
  const { method = 'GET', body, headers = {}, retryAuth = true, signal, raw = false } = options
  const upper = method.toUpperCase()

  const finalHeaders = { Accept: 'application/json', ...headers }
  if (accessToken) finalHeaders.Authorization = `Bearer ${accessToken}`
  const tenant = tenantKey()
  if (tenant) finalHeaders['X-Tenant-Key'] = tenant
  if (!SAFE_METHODS.has(upper)) finalHeaders['X-CSRF-Token'] = readCookie('csrf_token')

  let payload
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(path, {
      method: upper,
      headers: finalHeaders,
      body: payload,
      credentials: 'include',
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError('تعذّر الاتصال بالخادم — تأكد من الشبكة', { code: 'network_error' })
  }

  if (response.status === 401 && retryAuth && !path.includes('/api/auth/refresh')) {
    await rotateRefreshToken()
    return request(path, { ...options, retryAuth: false })
  }

  if (!response.ok) {
    throw toError(await parse(response), response)
  }

  if (raw) return response
  if (response.status === 204) return null
  return parse(response)
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  del: (path, options) => request(path, { ...options, method: 'DELETE' }),

  /** Download a binary export (Excel/PDF) and trigger the browser save dialog. */
  async download(path, filename) {
    const response = await request(path, { raw: true })
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename || 'export'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  },
}

export default api
