import { QueryClient } from '@tanstack/react-query'

import { ApiError } from './api'

/**
 * React Query configuration tuned for an operations console:
 *  - short stale times for operational data, longer for reference data;
 *  - no retry on 4xx (a 403 will never fix itself, and retry storms during an
 *    incident are the last thing the API needs);
 *  - window-focus refetch disabled: the realtime stream keeps data fresh and
 *    focus events would fire on every Alt-Tab.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 2
      },
      retryDelay: (attempt) => Math.min(4000, 500 * 2 ** attempt),
    },
    mutations: {
      retry: 0,
    },
  },
})

/** Query key factory — keeps invalidation explicit and typo-proof. */
export const qk = {
  branding: ['branding'],
  me: ['me'],
  version: ['api-version'],
  dashboard: (filters) => ['dashboard', filters],
  capacityInsights: (filters) => ['capacity', 'insights', filters],
  capacityRecommendations: (filters) => ['capacity', 'recommendations', filters],
  capacityHistory: (filters) => ['capacity', 'history', filters],
  processes: (filters) => ['processes', filters],
  process: (name) => ['processes', name],
  processOptions: (scope) => ['process-options', scope],
  departments: ['processes', 'departments'],
  slaSummary: (days) => ['sla-summary', days],
  versionHistory: (process) => ['lifecycle', 'history', process],
  roiSummary: (filters) => ['roi-summary', filters],
  slaWorkload: (process) => ['sla-workload', process],
  backlogTrend: (filters) => ['backlog-trend', filters],
  runs: (filters) => ['runs', filters],
  runStatistics: (days) => ['runs', 'statistics', days],
  topFailures: (days) => ['runs', 'top-failures', days],
  infrastructure: (filters) => ['infrastructure', filters],
  infrastructureSummary: ['infrastructure', 'summary'],
  commands: (filters) => ['commands', filters],
  platformProviders: ['platform', 'providers'],
  platformHealth: ['platform', 'health'],
  syncHistory: ['platform', 'sync-history'],
  audit: (filters) => ['audit', filters],
  auditSummary: (days) => ['audit', 'summary', days],
  versions: (filters) => ['lifecycle', 'versions', filters],
  lifecycleOverview: ['lifecycle', 'overview'],
  approvals: (status) => ['lifecycle', 'approvals', status],
  credentials: (versionId) => ['lifecycle', 'credentials', versionId],
  vaultStats: ['lifecycle', 'vault-stats'],
  tenants: (includeInactive) => ['tenants', includeInactive],
  tenant: (id) => ['tenants', id],
  users: ['users'],
  sessions: ['auth', 'sessions'],
  health: ['health', 'detail'],
}

export default queryClient
