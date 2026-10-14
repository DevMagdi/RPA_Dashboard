/**
 * Data-access hooks — one place that knows the API contract.
 *
 * Every read goes through React Query (caching, retries, invalidation) and
 * every write invalidates exactly the queries it affects, so the console stays
 * consistent without manual refreshes.  Realtime events are wired in
 * `useRealtimeSync`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import api from '../lib/api'
import { qk } from '../lib/queryClient'
import { onRealtime } from '../lib/realtime'

const DEFAULT_STALE = 20_000

function queryString(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, value)
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}

/* ------------------------------------------------------------------ reads */

export function useDashboard(filters) {
  const { department, process, days } = filters
  return useQuery({
    queryKey: qk.dashboard(filters),
    queryFn: () =>
      api.get(`/api/dashboard-data${queryString({ department, process, days })}`),
    staleTime: DEFAULT_STALE,
    placeholderData: (previous) => previous,
  })
}

export function useCapacityInsights(filters = {}) {
  return useQuery({
    queryKey: qk.capacityInsights(filters),
    queryFn: () => api.get(`/api/capacity/insights${queryString(filters)}`),
    staleTime: DEFAULT_STALE,
    placeholderData: (previous) => previous,
  })
}

export function useRecommendations(filters = {}) {
  return useQuery({
    queryKey: qk.capacityRecommendations(filters),
    queryFn: () => api.get(`/api/capacity/recommendations${queryString(filters)}`),
    staleTime: DEFAULT_STALE,
  })
}

export function useCapacityHistory(filters = {}) {
  return useQuery({
    queryKey: qk.capacityHistory(filters),
    queryFn: () => api.get(`/api/capacity/history${queryString(filters)}`),
    staleTime: 60_000,
  })
}

export function useProcesses(filters = {}) {
  return useQuery({
    queryKey: qk.processes(filters),
    queryFn: () => api.get(`/api/processes${queryString(filters)}`),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })
}

export function useProcessOptions(department) {
  return useQuery({
    queryKey: qk.processOptions(department),
    queryFn: () => api.get(`/api/dashboard/process-options${queryString({ department })}`),
    staleTime: 5 * 60_000,
  })
}

export function useRoiSummary(filters = {}) {
  return useQuery({
    queryKey: qk.roiSummary(filters),
    queryFn: () => api.get(`/api/processes-meta/roi-summary${queryString(filters)}`),
    staleTime: 60_000,
  })
}

export function useSlaWorkload(process) {
  return useQuery({
    queryKey: qk.slaWorkload(process),
    queryFn: () => api.get(`/api/sla-workload${queryString({ process })}`),
    staleTime: DEFAULT_STALE,
  })
}

export function useBacklogTrend(filters = {}) {
  return useQuery({
    queryKey: qk.backlogTrend(filters),
    queryFn: () => api.get(`/api/dashboard/backlog-trend${queryString(filters)}`),
    staleTime: 60_000,
  })
}

export function useRuns(filters = {}) {
  return useQuery({
    queryKey: qk.runs(filters),
    queryFn: () => api.get(`/api/runs${queryString(filters)}`),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  })
}

export function useRunStatistics(days = 30) {
  return useQuery({
    queryKey: qk.runStatistics(days),
    queryFn: () => api.get(`/api/runs/statistics${queryString({ days })}`),
    staleTime: 60_000,
  })
}

export function useTopFailures(days = 7) {
  return useQuery({
    queryKey: qk.topFailures(days),
    queryFn: () => api.get(`/api/runs/top-failures${queryString({ days })}`),
    staleTime: 60_000,
  })
}

export function useInfrastructure(filters = {}) {
  return useQuery({
    queryKey: qk.infrastructure(filters),
    queryFn: () => api.get(`/api/infrastructure${queryString(filters)}`),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  })
}

export function useInfrastructureSummary() {
  return useQuery({
    queryKey: qk.infrastructureSummary,
    queryFn: () => api.get('/api/infrastructure/summary'),
    staleTime: 15_000,
  })
}

export function useCommands(filters = {}) {
  return useQuery({
    queryKey: qk.commands(filters),
    queryFn: () => api.get(`/api/commands${queryString(filters)}`),
    staleTime: 5_000,
  })
}

export function usePlatformProviders() {
  return useQuery({
    queryKey: qk.platformProviders,
    queryFn: () => api.get('/api/platform/providers'),
    staleTime: 30 * 60_000,
  })
}

export function usePlatformHealth() {
  return useQuery({
    queryKey: qk.platformHealth,
    queryFn: () => api.get('/api/platform/health'),
    staleTime: 60_000,
  })
}

export function useSyncHistory() {
  return useQuery({
    queryKey: qk.syncHistory,
    queryFn: () => api.get('/api/platform/sync-history'),
    staleTime: 30_000,
  })
}

export function useAuditLogs(filters = {}) {
  return useQuery({
    queryKey: qk.audit(filters),
    queryFn: () => api.get(`/api/audit-logs${queryString(filters)}`),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  })
}

export function useAuditSummary(days = 7) {
  return useQuery({
    queryKey: qk.auditSummary(days),
    queryFn: () => api.get(`/api/audit-logs/summary${queryString({ days })}`),
    staleTime: 60_000,
  })
}

export function useVersions(filters = {}) {
  return useQuery({
    queryKey: qk.versions(filters),
    queryFn: () => api.get(`/api/bot-versions${queryString(filters)}`),
    staleTime: 30_000,
  })
}

export function useLifecycleOverview() {
  return useQuery({
    queryKey: qk.lifecycleOverview,
    queryFn: () => api.get('/api/bot-versions/live-status'),
    staleTime: 30_000,
  })
}

export function useApprovals(status) {
  return useQuery({
    queryKey: qk.approvals(status),
    queryFn: () => api.get(`/api/approvals${queryString({ status })}`),
    staleTime: 15_000,
  })
}

export function useCredentials(versionId) {
  return useQuery({
    queryKey: qk.credentials(versionId),
    queryFn: () => api.get(`/api/bot-versions/${versionId}/credentials`),
    enabled: Boolean(versionId),
    staleTime: 30_000,
  })
}

export function useVaultStats() {
  return useQuery({
    queryKey: qk.vaultStats,
    queryFn: () => api.get('/api/vault/statistics'),
    staleTime: 60_000,
  })
}

export function useOrganization() {
  return useQuery({
    queryKey: qk.organization,
    queryFn: () => api.get('/api/organization'),
    staleTime: 60_000,
  })
}

export function useAlerts(filters = {}, { enabled = true } = {}) {
  return useQuery({
    queryKey: qk.alerts(filters),
    queryFn: () => api.get(`/api/alerts${queryString({ status: filters.status, limit: filters.limit || 100 })}`),
    staleTime: 15_000,
    enabled,
  })
}

export function useAlertCount() {
  return useQuery({
    queryKey: qk.alertCount,
    queryFn: () => api.get('/api/alerts/count'),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
}

export function useUsers() {
  return useQuery({
    queryKey: qk.users,
    queryFn: () => api.get('/api/users'),
    staleTime: 30_000,
  })
}

export function useSessions() {
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => api.get('/api/auth/sessions'),
    staleTime: 15_000,
  })
}

export function useHealthDetail(enabled = true) {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => api.get('/health/detail'),
    enabled,
    staleTime: 20_000,
  })
}


export function useDepartments() {
  return useQuery({
    queryKey: qk.departments,
    queryFn: () => api.get('/api/processes-meta/departments'),
    staleTime: 10 * 60_000,
  })
}

export function useSlaSummary(days = 30) {
  return useQuery({
    queryKey: qk.slaSummary(days),
    queryFn: () => api.get(`/api/dashboard/sla-summary${queryString({ days })}`),
    staleTime: DEFAULT_STALE,
  })
}

export function useProcess(name) {
  return useQuery({
    queryKey: qk.process(name),
    queryFn: () => api.get(`/api/processes/${encodeURIComponent(name)}`),
    enabled: Boolean(name),
    staleTime: 60_000,
  })
}

export function useVersionHistory(processName) {
  return useQuery({
    queryKey: qk.versionHistory(processName),
    queryFn: () => api.get(`/api/bot-versions/${encodeURIComponent(processName)}/history`),
    enabled: Boolean(processName),
    staleTime: 30_000,
  })
}

export function useRealtimeSnapshot() {
  return useQuery({
    queryKey: ['realtime', 'status'],
    queryFn: () => api.get('/api/realtime/status'),
    staleTime: 15_000,
  })
}

export function useConnectedAgents({ refetchInterval } = {}) {
  return useQuery({
    queryKey: ['agents', 'connected'],
    queryFn: () => api.get('/api/agents/connected'),
    staleTime: 10_000,
    refetchInterval,
  })
}

export function useProviderCatalogue() {
  return useQuery({
    queryKey: ['organization', 'providers'],
    queryFn: () => api.get('/api/organization/meta/providers'),
    staleTime: 30 * 60_000,
  })
}

/* --------------------------------------------------------------- mutations */

function useInvalidator() {
  const client = useQueryClient()
  return (keys) => keys.forEach((key) => client.invalidateQueries({ queryKey: key }))
}

export function useGenerateRecommendations() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: () => api.post('/api/capacity/generate', {}),
    onSuccess: () => invalidate([['capacity'], ['dashboard']]),
  })
}

export function useUpdateRecommendationStatus() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ id, status, comment }) =>
      api.post(`/api/capacity/recommendations/${id}/status`, { Status: status, Comment: comment }),
    onSuccess: () => invalidate([['capacity'], ['dashboard']]),
  })
}

export function useUpdateRoi() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload) => api.post('/api/update-roi', payload),
    onSuccess: () => invalidate([['processes'], ['roi-summary'], ['dashboard']]),
  })
}

export function useUpdateSla() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload) => api.post('/api/update-sla', payload),
    onSuccess: () => invalidate([['processes'], ['sla-workload'], ['dashboard'], ['capacity']]),
  })
}

export function useSetProcessActive() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ name, isActive }) =>
      api.patch(`/api/processes/${encodeURIComponent(name)}/active`, { IsActive: isActive }),
    onSuccess: () => invalidate([['processes'], ['dashboard'], ['process-options']]),
  })
}

export function useDeleteProcess() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (name) => api.del(`/api/processes/${encodeURIComponent(name)}`),
    onSuccess: () => invalidate([['processes'], ['dashboard'], ['process-options'], ['roi-summary']]),
  })
}

export function useStartRun() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload) => api.post('/api/runs/start', payload),
    onSuccess: () => invalidate([['runs'], ['dashboard']]),
  })
}

export function useCompleteRun() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ runId, ...payload }) => api.post(`/api/runs/${runId}/complete`, payload),
    onSuccess: () => invalidate([['runs'], ['dashboard']]),
  })
}

export function useReapStaleRuns() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: () => api.post('/api/runs/reap-stale', {}),
    onSuccess: () => invalidate([['runs'], ['dashboard']]),
  })
}

export function useRegisterMachine() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload) => api.post('/api/register-machine', payload),
    onSuccess: () => invalidate([['infrastructure']]),
  })
}

export function useUpdateMachine() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ machineName, ...payload }) =>
      api.post(`/api/update-machine${queryString({ machine_name: machineName })}`, payload),
    onSuccess: () => invalidate([['infrastructure']]),
  })
}

export function useDeleteMachine() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (machineName) => api.del(`/api/machines/${encodeURIComponent(machineName)}`),
    onSuccess: () => invalidate([['infrastructure']]),
  })
}

export function useRegenerateEnrollmentCode() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (machineName) => api.post(`/api/regenerate-enrollment-code/${encodeURIComponent(machineName)}`, {}),
    onSuccess: () => invalidate([['infrastructure']]),
  })
}

export function useRevokeAgentToken() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (machineName) => api.post(`/api/machines/${encodeURIComponent(machineName)}/revoke-token`, {}),
    onSuccess: () => invalidate([['infrastructure']]),
  })
}

export function useSendCommand() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ machineName, ...payload }) => api.post(`/api/machines/${encodeURIComponent(machineName)}/commands`, payload),
    onSuccess: () => invalidate([['commands']]),
  })
}

export function usePlatformSync() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload = {}) => api.post('/api/platform/sync', payload),
    onSuccess: () => invalidate([['platform', 'sync-history'], ['dashboard'], ['processes'], ['runs']]),
  })
}

export function useStartJob() {
  return useMutation({ mutationFn: (payload) => api.post('/api/jobs/start', payload) })
}

export function useStopJob() {
  return useMutation({ mutationFn: ({ externalId, reason }) => api.post(`/api/jobs/${externalId}/stop`, { reason }) })
}

export function useCreateVersion() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload) => api.post('/api/bot-versions', payload),
    onSuccess: () => invalidate([['lifecycle']]),
  })
}

export function usePromoteVersion() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ versionId, ...payload }) => api.post(`/api/bot-versions/${versionId}/promote`, payload),
    onSuccess: () => invalidate([['lifecycle'], ['dashboard']]),
  })
}

export function useRollbackVersion() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload) => api.post('/api/bot-versions/rollback', payload),
    onSuccess: () => invalidate([['lifecycle']]),
  })
}

export function useRequestApproval() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload) => api.post('/api/approvals', payload),
    onSuccess: () => invalidate([['lifecycle']]),
  })
}

export function useDecideApproval() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ approvalId, approved, comment }) =>
      api.post(`/api/approvals/${approvalId}/decide`, { Approved: approved, Comment: comment }),
    onSuccess: () => invalidate([['lifecycle']]),
  })
}

export function useAddCredential() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ versionId, ...payload }) => api.post(`/api/bot-versions/${versionId}/credentials`, payload),
    onSuccess: () => invalidate([['lifecycle']]),
  })
}

export function useRevealCredential() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ versionId, vaultId, reason }) =>
      api.post(`/api/bot-versions/${versionId}/decrypt/${vaultId}`, { Reason: reason }),
    onSuccess: () => invalidate([['lifecycle']]),
  })
}

export function useDeleteCredential() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (vaultId) => api.del(`/api/vault/${vaultId}`),
    onSuccess: () => invalidate([['lifecycle']]),
  })
}

export function useRotateVaultKey() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (dryRun = true) => api.post(`/api/vault/rotate-key${queryString({ dry_run: dryRun })}`, {}),
    onSuccess: () => invalidate([['lifecycle']]),
  })
}

export function useUpdateBranding() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload) => api.patch('/api/organization/branding', payload),
    onSuccess: () => invalidate([['organization'], ['branding']]),
  })
}

export function useConfigurePlatform() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ provider, config }) => api.post('/api/organization/platform', { Provider: provider, Config: config }),
    onSuccess: () => invalidate([['organization'], ['platform']]),
  })
}

export function useTestPlatformConfig() {
  return useMutation({ mutationFn: () => api.post('/api/organization/platform/test', {}) })
}

export function useRunRetention() {
  return useMutation({
    mutationFn: ({ retentionDays = 730 } = {}) =>
      api.post(`/api/organization/retention/run${queryString({ retention_days: retentionDays })}`, {}),
  })
}

export function useSetAlertStatus() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ id, status }) => api.patch(`/api/alerts/${id}`, { Status: status }),
    onSuccess: () => invalidate([['alerts']]),
  })
}

export function useEvaluateAlerts() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: () => api.post('/api/alerts/evaluate', {}),
    onSuccess: () => invalidate([['alerts']]),
  })
}

export function useCreateUser() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (payload) => api.post('/api/users', payload),
    onSuccess: () => invalidate([['users']]),
  })
}

export function useSetUserActive() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: ({ userId, isActive }) => api.patch(`/api/users/${userId}/active`, { is_active: isActive }),
    onSuccess: () => invalidate([['users']]),
  })
}

export function useDeleteUser() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (userId) => api.del(`/api/users/${userId}`),
    onSuccess: () => invalidate([['users']]),
  })
}

export function useRevokeSession() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (sessionId) => api.del(`/api/auth/sessions/${sessionId}`),
    onSuccess: () => invalidate([['auth', 'sessions']]),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (payload) => api.post('/api/auth/change-password', payload),
  })
}

export function useSendTestNotification() {
  return useMutation({
    mutationFn: (severity = 'Info') => api.post('/api/notifications/test', { Severity: severity }),
  })
}

export function useNotifications(filters = {}) {
  return useQuery({
    queryKey: ['notifications', filters],
    queryFn: () => api.get(`/api/notifications${queryString(filters)}`),
    staleTime: 30_000,
  })
}

export function useNotificationStats(days = 7) {
  return useQuery({
    queryKey: ['notifications', 'stats', days],
    queryFn: () => api.get(`/api/notifications/statistics${queryString({ days })}`),
    staleTime: 60_000,
  })
}

/* ------------------------------------------------- realtime ↔ query bridge */

/**
 * Map realtime events onto React Query invalidations so every panel updates
 * live without polling.  Cheap for the API (one stream per browser) and
 * consistent for the operator.
 */
export function useRealtimeSync() {
  const client = useQueryClient()

  useEffect(() => {
    const unsubscribe = onRealtime('*', (payload, name) => {
      switch (name) {
        case 'kpi_update':
        case 'dashboard_update':
          client.invalidateQueries({ queryKey: ['dashboard'] })
          break
        case 'capacity_update':
        case 'recommendation_updated':
          client.invalidateQueries({ queryKey: ['capacity'] })
          client.invalidateQueries({ queryKey: ['dashboard'] })
          break
        case 'run_started':
        case 'run_completed':
          client.invalidateQueries({ queryKey: ['runs'] })
          client.invalidateQueries({ queryKey: ['dashboard'] })
          break
        case 'agent_heartbeat':
          client.invalidateQueries({ queryKey: ['infrastructure'] })
          break
        case 'command_ack':
          client.invalidateQueries({ queryKey: ['commands'] })
          break
        default:
          break
      }
      if (name === 'connected' && payload && typeof payload === 'object') {
        client.setQueryData(['realtime', 'server-time'], payload.server_time)
      }
    })
    return unsubscribe
  }, [client])
}
