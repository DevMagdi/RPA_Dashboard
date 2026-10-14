/**
 * Route registry — the single source of truth for the shell.
 *
 * The sidebar, the command palette, the breadcrumb, the document title and the
 * route-level code-split prefetcher all read this table, so adding a module is
 * a one-line change instead of a five-file hunt.  `load()` doubles as the lazy
 * import used by `App.jsx` (Vite turns each one into its own chunk).
 */
import {
  Activity,
  BadgeCheck,
  Bell,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Server,
  Settings as SettingsIcon,
  Shield,
  Users,
  Workflow,
} from 'lucide-react'

export const ROUTE_SECTIONS = [
  { key: 'operations', labelKey: 'nav.sections.operations' },
  { key: 'governance', labelKey: 'nav.sections.governance' },
  { key: 'administration', labelKey: 'nav.sections.administration' },
]

export const ROUTES = [
  {
    path: '/',
    id: 'dashboard',
    labelKey: 'nav.dashboard',
    descriptionKey: 'dashboard.subtitle',
    icon: LayoutDashboard,
    section: 'operations',
    permission: 'dashboard:read',
    load: () => import('../pages/DashboardPage'),
    hotkey: 'g d',
  },
  {
    path: '/capacity',
    id: 'capacity',
    labelKey: 'nav.capacity',
    descriptionKey: 'capacity.subtitle',
    icon: Gauge,
    section: 'operations',
    permission: 'capacity:read',
    load: () => import('../pages/CapacityPage'),
    hotkey: 'g c',
  },
  {
    path: '/processes',
    id: 'processes',
    labelKey: 'nav.processes',
    descriptionKey: 'processes.subtitle',
    icon: Workflow,
    section: 'operations',
    permission: 'processes:read',
    load: () => import('../pages/ProcessesPage'),
    hotkey: 'g p',
  },
  {
    path: '/runs',
    id: 'runs',
    labelKey: 'nav.runs',
    descriptionKey: 'runs.subtitle',
    icon: Activity,
    section: 'operations',
    permission: 'runs:read',
    load: () => import('../pages/RunsPage'),
    hotkey: 'g r',
  },
  {
    path: '/infrastructure',
    id: 'infrastructure',
    labelKey: 'nav.infrastructure',
    descriptionKey: 'infra.subtitle',
    icon: Server,
    section: 'operations',
    permission: 'infrastructure:read',
    load: () => import('../pages/InfrastructurePage'),
    hotkey: 'g i',
  },
  {
    path: '/lifecycle',
    id: 'lifecycle',
    labelKey: 'nav.lifecycle',
    descriptionKey: 'lifecycle.subtitle',
    icon: BadgeCheck,
    section: 'governance',
    permission: 'lifecycle:read',
    load: () => import('../pages/LifecyclePage'),
    hotkey: 'g l',
  },
  {
    path: '/audit',
    id: 'audit',
    labelKey: 'nav.audit',
    descriptionKey: 'audit.subtitle',
    icon: ScrollText,
    section: 'governance',
    permission: 'audit:read',
    load: () => import('../pages/AuditPage'),
    hotkey: 'g a',
  },
  {
    path: '/health',
    id: 'health',
    labelKey: 'nav.health',
    descriptionKey: 'health.subtitle',
    icon: Shield,
    section: 'governance',
    permission: 'audit:read',
    load: () => import('../pages/HealthPage'),
  },
  {
    path: '/users',
    id: 'users',
    labelKey: 'nav.users',
    descriptionKey: 'users.subtitle',
    icon: Users,
    section: 'administration',
    permission: 'users:read',
    load: () => import('../pages/UsersPage'),
  },
  {
    path: '/organization',
    id: 'organization',
    labelKey: 'nav.organization',
    descriptionKey: 'organization.subtitle',
    icon: KeyRound,
    section: 'administration',
    permission: '*',
    load: () => import('../pages/OrganizationPage'),
  },
  {
    path: '/alerts',
    id: 'alerts',
    labelKey: 'nav.alerts',
    descriptionKey: 'alerts.subtitle',
    icon: Bell,
    section: 'administration',
    permission: null,
    load: () => import('../pages/AlertsPage'),
  },
  {
    path: '/settings',
    id: 'settings',
    labelKey: 'nav.settings',
    descriptionKey: 'settings.subtitle',
    icon: SettingsIcon,
    section: 'administration',
    permission: null,
    load: () => import('../pages/SettingsPage'),
  },
]

/** Routes a principal may see (`has('*')` is the SuperAdmin wildcard). */
export function routesFor(has) {
  return ROUTES.filter((route) => !route.permission || has(route.permission))
}

export function sectionsFor(has) {
  const allowed = routesFor(has)
  return ROUTE_SECTIONS.map((section) => ({
    ...section,
    routes: allowed.filter((route) => route.section === section.key),
  })).filter((section) => section.routes.length > 0)
}

/** Longest-prefix match so nested paths highlight the right module. */
export function matchRoute(pathname) {
  if (pathname === '/') return ROUTES[0]
  return (
    ROUTES.filter((route) => route.path !== '/' && pathname.startsWith(route.path)).toSorted(
      (a, b) => b.path.length - a.path.length,
    )[0] || null
  )
}

/**
 * Warm a route chunk before the user clicks.
 *
 * Called from the sidebar (hover/focus) and from an idle callback after the
 * dashboard settles; both are best-effort and swallow failures because a failed
 * prefetch must never surface to the operator.
 */
const prefetched = new Set()
export function prefetchRoute(route) {
  if (!route?.load || prefetched.has(route.path)) return Promise.resolve()
  prefetched.add(route.path)
  return route.load().catch(() => {
    prefetched.delete(route.path)
  })
}

export function prefetchAll(has, concurrency = 2) {
  const targets = routesFor(has).filter((route) => route.id !== 'settings')
  let index = 0
  const next = () => {
    if (index >= targets.length) return
    const route = targets[index]
    index += 1
    prefetchRoute(route).finally(() => next())
  }
  for (let i = 0; i < concurrency; i += 1) next()
}
