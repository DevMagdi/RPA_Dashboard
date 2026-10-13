import { QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import AppShell from './components/layout/AppShell'
import { AuthProvider, useAuth } from './context/AuthProvider'
import { BrandingProvider } from './context/BrandingProvider'
import { ThemeProvider } from './context/ThemeProvider'
import { ToastProvider } from './context/ToastProvider'
import { queryClient } from './lib/queryClient'
import { Card, EmptyState, Skeleton } from './components/ui'

/* Route-level code splitting keeps the first paint under the 1.5 s budget. */
const LoginPage = lazy(() => import('./pages/LoginPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const CapacityPage = lazy(() => import('./pages/CapacityPage'))
const ProcessesPage = lazy(() => import('./pages/ProcessesPage'))
const RunsPage = lazy(() => import('./pages/RunsPage'))
const InfrastructurePage = lazy(() => import('./pages/InfrastructurePage'))
const LifecyclePage = lazy(() => import('./pages/LifecyclePage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const HealthPage = lazy(() => import('./pages/HealthPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const OrganizationPage = lazy(() => import('./pages/OrganizationPage'))
const AlertsPage = lazy(() => import('./pages/AlertsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function PageFallback() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}

function RequireAuth({ permission, children }) {
  const { isAuthenticated, isBootstrapping, has } = useAuth()
  const location = useLocation()

  if (isBootstrapping) return <PageFallback />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (permission && !has(permission) && !has('*')) {
    return (
      <Card>
        <EmptyState title="403" description="You do not have permission to view this page." />
      </Card>
    )
  }
  return children
}

function NotFound() {
  return (
    <Card>
      <EmptyState title="404" description="The page you asked for does not exist." />
    </Card>
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
                <Suspense fallback={<PageFallback />}>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route
                      element={
                        <RequireAuth>
                          <AppShell />
                        </RequireAuth>
                      }
                    >
                      <Route index element={<DashboardPage />} />
                      <Route path="capacity" element={<CapacityPage />} />
                      <Route path="processes" element={<ProcessesPage />} />
                      <Route path="runs" element={<RunsPage />} />
                      <Route path="infrastructure" element={<InfrastructurePage />} />
                      <Route path="lifecycle" element={<LifecyclePage />} />
                      <Route path="audit" element={<AuditPage />} />
                      <Route path="health" element={<HealthPage />} />
                      <Route path="users" element={<RequireAuth permission="users:read"><UsersPage /></RequireAuth>} />
                      <Route path="organization" element={<RequireAuth permission="*"><OrganizationPage /></RequireAuth>} />
                      <Route path="alerts" element={<AlertsPage />} />
                      <Route path="settings" element={<SettingsPage />} />
                      <Route path="*" element={<NotFound />} />
                    </Route>
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </AuthProvider>
          </BrandingProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
