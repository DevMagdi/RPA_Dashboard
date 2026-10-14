/**
 * API client / data-layer integration.
 *
 * The client is the single choke point between the SPA and the bank's API, so
 * this file pins the security-relevant behaviour rather than the happy path:
 * CSRF on state-changing verbs, an access token that never touches
 * `localStorage`, a **single-flight** refresh (the refresh-token family must
 * not be invalidated by a race between parallel 401s) and status-aware errors
 * the UI can translate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, apiUrl, getAccessToken, request, setAccessToken, setUnauthenticatedHandler, silentRefresh } from '../api/client'
import { queryClient } from '../lib/queryClient'

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function setCookie(name, value) {
  document.cookie = `${name}=${value}; path=/`
}

describe('api client', () => {
  beforeEach(() => {
    setAccessToken(null)
    setUnauthenticatedHandler(null)
    document.cookie = 'csrf_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds relative URLs (works behind any reverse proxy)', () => {
    expect(apiUrl('/api/dashboard-data')).toBe('/api/dashboard-data')
    expect(apiUrl('http://bank.example/api')).toBe('http://bank.example/api')
  })

  it('sends the CSRF token on state-changing verbs only', async () => {
    setCookie('csrf_token', 'csrf-123')
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url, options })
      return jsonResponse({ ok: true })
    }))

    await api.get('/api/audit-logs')
    await api.post('/api/auth/login', { username: 'ops' })

    const headers = calls.map((call) => new Headers(call.options.headers))
    expect(headers[0].get('X-CSRF-Token')).toBeNull()
    expect(headers[1].get('X-CSRF-Token')).toBe('csrf-123')
    expect(headers[1].get('content-type')).toBe('application/json')
  })

  it('keeps the access token in memory (never in localStorage)', async () => {
    setAccessToken('token-abc')
    expect(getAccessToken()).toBe('token-abc')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))

    await request('/api/me')

    expect(JSON.stringify(window.localStorage)).not.toContain('token-abc')
    expect(Object.values(window.localStorage).join(' ')).not.toContain('token-abc')
  })

  it('refreshes once for parallel 401s and replays the original request', async () => {
    setCookie('csrf_token', 'csrf-123')
    let refreshCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/auth/refresh')) {
        refreshCalls += 1
        return jsonResponse({ access_token: 'fresh-token' })
      }
      return getAccessToken() === 'fresh-token' ? jsonResponse({ items: [] }) : jsonResponse({ error: { message: 'expired' } }, { status: 401 })
    }))

    const [first, second] = await Promise.all([request('/api/runs'), request('/api/alerts')])

    expect(refreshCalls).toBe(1)
    expect(first).toEqual({ items: [] })
    expect(second).toEqual({ items: [] })
    expect(getAccessToken()).toBe('fresh-token')
  })

  it('notifies the app exactly once when the session is gone', async () => {
    const onUnauthenticated = vi.fn()
    setUnauthenticatedHandler(onUnauthenticated)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'no session' } }, { status: 401 })))

    await expect(request('/api/runs')).rejects.toBeInstanceOf(ApiError)
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })

  it('never throws from silentRefresh (bootstrap must stay quiet)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'nope' } }, { status: 401 })))
    await expect(silentRefresh()).resolves.toBeNull()
  })

  it('surfaces API error shape: code, details, request id and field errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      {
        error: {
          message: 'Validation failed',
          code: 'validation_error',
          details: [{ field: 'Username', message: 'مطلوب' }],
          request_id: 'req-42',
        },
      },
      { status: 422, headers: { 'x-correlation-id': 'req-42' } },
    )))

    const error = await request('/api/users', { method: 'POST', body: {} }).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    expect(error.code).toBe('validation_error')
    expect(error.requestId).toBe('req-42')
    expect(error.fieldErrors).toEqual({ Username: 'مطلوب' })
    expect(error.isAuth).toBe(false)
  })

  it('does not retry client errors but retries transient failures twice', async () => {
    const retry = queryClient.getDefaultOptions().queries.retry
    expect(retry(0, new ApiError('forbidden', { status: 403 }))).toBe(false)
    expect(retry(0, new ApiError('not found', { status: 404 }))).toBe(false)
    expect(retry(0, new ApiError('boom', { status: 503 }))).toBe(true)
    expect(retry(2, new ApiError('boom', { status: 503 }))).toBe(false)
    // Focus events must not refetch: the realtime channel keeps data fresh.
    expect(queryClient.getDefaultOptions().queries.refetchOnWindowFocus).toBe(false)
  })
})
