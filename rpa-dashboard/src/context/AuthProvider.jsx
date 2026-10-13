import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import api, { ApiError, getAccessToken, hasSessionHint, setAccessToken, setUnauthenticatedHandler, silentRefresh } from '../lib/api'
import { qk, queryClient } from '../lib/queryClient'
import { startRealtime, stopRealtime } from '../lib/realtime'

const AuthContext = createContext(null)

const PUBLIC_USER = Object.freeze({
  user_id: 0,
  username: 'anonymous',
  role: 'Anonymous',
  department: 'ALL',
  permissions: [],
})

/**
 * Authentication state for the SPA.
 *
 * The access token lives in memory (see lib/api.js) and the refresh token in an
 * HttpOnly cookie, so a page reload silently re-establishes the session with
 * `POST /api/auth/refresh` — no token ever touches localStorage.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('bootstrapping')
  const [mfaChallenge, setMfaChallenge] = useState(null)
  const [lastError, setLastError] = useState(null)

  const clearSession = useCallback((message) => {
    setAccessToken(null)
    setUser(null)
    setMfaChallenge(null)
    setStatus('anonymous')
    stopRealtime()
    if (message) setLastError(message)
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'branding' })
  }, [])

  // Boot: restore the session without ever guaranteeing a 401.
  // Order: (1) an in-memory token (e.g. right after login) is validated
  // directly; (2) otherwise ONE silent, single-flight refresh runs first
  // and /auth/me is only called once a token was actually obtained.
  // A 401 from either bootstrap call must not trigger a second refresh
  // loop, hence `retryAuth: false` + `silent: true` on the /me calls and
  // silentRefresh() (which never invokes the unauthenticated handler).
  useEffect(() => {
    let cancelled = false
    setUnauthenticatedHandler(() => clearSession('session_expired'))

    const bootstrap = async () => {
      if (getAccessToken()) {
        try {
          const me = await api.get('/api/auth/me', { retryAuth: false, silent: true })
          if (cancelled) return
          setUser(me)
          setStatus('authenticated')
          startRealtime()
          queryClient.setQueryData(qk.me, me)
          return
        } catch {
          // In-memory token rejected — fall through to one silent refresh.
        }
      } else if (!hasSessionHint()) {
        // Fresh profile: no csrf companion cookie => no refresh cookie
        // either, so any refresh/me call would 401 by construction.
        if (!cancelled) setStatus('anonymous')
        return
      }

      const refreshed = await silentRefresh()
      if (cancelled) return
      if (!refreshed) {
        // Quiet logged-out transition (also where RequireAuth routes to
        // /login) — no console errors, no retry storm.
        setStatus('anonymous')
        return
      }
      try {
        const me = await api.get('/api/auth/me', { retryAuth: false, silent: true })
        if (cancelled) return
        setUser(me)
        setStatus('authenticated')
        startRealtime()
        queryClient.setQueryData(qk.me, me)
      } catch {
        if (!cancelled) clearSession()
      }
    }
    bootstrap()
    return () => {
      cancelled = true
    }
  }, [clearSession])

  const finishLogin = useCallback(async (data) => {
    setAccessToken(data.access_token)
    const me = await api.get('/api/auth/me')
    setUser(me)
    setMfaChallenge(null)
    setLastError(null)
    setStatus('authenticated')
    startRealtime()
    queryClient.setQueryData(qk.me, me)
    return me
  }, [])

  /**
   * First factor. Returns `{ mfaRequired: true }` when the account has MFA
   * enabled — the caller then asks for the six-digit code.
   */
  const login = useCallback(
    async ({ username, password }) => {
      setLastError(null)
      try {
        const data = await api.post('/api/auth/login', { username, password })
        if (data.mfa_required) {
          setMfaChallenge({ token: data.mfa_token, user: data.user })
          setStatus('mfa_required')
          return { mfaRequired: true }
        }
        await finishLogin(data)
        return { mfaRequired: false }
      } catch (error) {
        setLastError(error instanceof ApiError ? error : new ApiError('Login failed'))
        throw error
      }
    },
    [finishLogin],
  )

  const verifyMfa = useCallback(
    async (code) => {
      if (!mfaChallenge) throw new ApiError('MFA challenge missing', { code: 'mfa_not_started' })
      const data = await api.post('/api/auth/mfa/verify', { mfa_token: mfaChallenge.token, code })
      return finishLogin(data)
    },
    [mfaChallenge, finishLogin],
  )

  const cancelMfa = useCallback(() => {
    setMfaChallenge(null)
    setStatus('anonymous')
  }, [])

  const logout = useCallback(
    async ({ silent = false } = {}) => {
      try {
        await api.post('/api/auth/logout', {})
      } catch (error) {
        if (!silent) {
          // Even a failed revoke must end the local session
          console.warn('logout failed', error)
        }
      }
      clearSession()
    },
    [clearSession],
  )

  const refreshUser = useCallback(async () => {
    const me = await api.get('/api/auth/me')
    setUser(me)
    queryClient.setQueryData(qk.me, me)
    return me
  }, [])

  const has = useCallback(
    (permission) => {
      if (!permission) return true
      const principal = user || PUBLIC_USER
      const permissions = principal.permissions || []
      if (permissions.includes('*')) return true
      if (Array.isArray(permission)) return permission.some((item) => permissions.includes(item) || permissions.includes('*'))
      return permissions.includes(permission)
    },
    [user],
  )

  const hasAnyGroup = useCallback(
    (...permissions) => permissions.some((permission) => has(permission)),
    [has],
  )

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated',
      isBootstrapping: status === 'bootstrapping',
      mfaChallenge,
      lastError,
      login,
      verifyMfa,
      cancelMfa,
      logout,
      refreshUser,
      has,
      hasAnyGroup,
      clearError: () => setLastError(null),
    }),
    [user, status, mfaChallenge, lastError, login, verifyMfa, cancelMfa, logout, refreshUser, has, hasAnyGroup],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}

export default AuthProvider
