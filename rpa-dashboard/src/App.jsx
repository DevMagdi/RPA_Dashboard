/**
 * Application composition root.
 *
 * Provider order matters: data → theme → toasts → branding → auth → router.
 * Routes are generated from `lib/routeMeta.js`, which is also what the sidebar,
 * the command palette and the prefetcher read, so a module is never declared
 * twice.  Every page is a separate chunk (lazy) and every guard failure renders
 * a translated state instead of a bare English string.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import AppShell from './components/layout/AppShell'
import RouteFallback from './components/common/RouteFallback'
import { Button, Card, EmptyState, ErrorBoundary, ErrorState } from './components/ui'
import { AuthProvider, useAuth } from './context/AuthProvider'
import { BrandingProvider } from './context/BrandingProvider'
import { ThemeProvider } from './context/ThemeProvider'
import { ToastProvider } from './context/ToastProvider'
import { queryClient } from './lib/queryClient'
import { ROUTES } from './lib/routeMeta'

const LoginPage = lazy(() => import('./pages/LoginPage'))

function Forbidden() {
  const { t } = useTranslation()
  return (
    <Card className="mx-auto max-w-xl">
      <EmptyState
        tone="warning"
        title="403"
        description={t('errors.forbiddenHint')}
        action={
          <Button variant="secondary" size="sm" onClick={() => window.history.back()}>
            {t('actions.close')}
          </Button>
        }
      />
    </Card>
  )
}

function NotFound() {
  const { t } = useTranslation()
  return (
    <Card className="mx-auto max-w-xl">
      <EmptyState tone="muted" title="404" description={t('errors.notFoundHint')} />
    </Card>
  )
}

function RequireAuth({ permission, children }) {
  const { isAuthenticated, isBootstrapping, has } = useAuth()
  const location = useLocation()
  const { t } = useTranslation()

  if (isBootstrapping) return <RouteFallback />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (permission && !has(permission) && !has('*')) return <Forbidden />
  return (
    <ErrorBoundary title={t('errors.sectionFailed')}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<RouteFallback />}>
            <LoginPage />
          </Suspense>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        {ROUTES.map((route) => {
          const Page = lazy(route.load)
          const element = (
            <RequireAuth permission={route.permission === '*' ? '*' : undefined}>
              <Page />
            </RequireAuth>
          )
          return route.path === '/' ? (
            <Route index key={route.id} element={element} />
          ) : (
            <Route path={route.path.replace(/^\//, '')} key={route.id} element={element} />
          )
        })}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <BrandingProvider>
            <AuthProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </AuthProvider>
          </BrandingProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export { ErrorState }
