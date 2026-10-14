/** Shared enumerations and palettes used across pages. */

export const ROLES = [
  'SuperAdmin',
  'CoE_Manager',
  'TeamLead',
  'Senior_Developer',
  'Developer',
  'Support',
  'TestAnalyst',
  'Auditor',
]

export const RUNNER_TYPES = ['Unattended', 'Attended', 'TestBot']

export const ENVIRONMENTS = ['Development', 'UAT', 'Production', 'Retired']

export const ENVIRONMENT_ORDER = { Development: 0, UAT: 1, Production: 2, Retired: 3 }

export const RUN_STATUSES = ['Running', 'Completed', 'Failed', 'Stopped', 'Pending']

export const RECOMMENDATION_STATUSES = ['Open', 'Acknowledged', 'Requested', 'Applied', 'Dismissed', 'Resolved']

export const COMMANDS = [
  { value: 'RUN_BOT', labelKey: 'infra.commandValues.RUN_BOT', needsProcess: true },
  { value: 'STOP_BOT', labelKey: 'infra.commandValues.STOP_BOT', needsProcess: true },
  { value: 'PING', labelKey: 'infra.commandValues.PING' },
  { value: 'REFRESH_CONFIG', labelKey: 'infra.commandValues.REFRESH_CONFIG' },
  { value: 'UPDATE_AGENT', labelKey: 'infra.commandValues.UPDATE_AGENT' },
]

export const DATE_RANGES = [
  { value: 1, labelKey: 'dashboard.filters.days', count: 1 },
  { value: 7, labelKey: 'dashboard.filters.days', count: 7 },
  { value: 30, labelKey: 'dashboard.filters.days', count: 30 },
  { value: 90, labelKey: 'dashboard.filters.days', count: 90 },
  { value: 365, labelKey: 'dashboard.filters.days', count: 365 },
]

/** Chart palettes resolve to CSS variables so they follow the organization brand. */
export const CHART_COLORS = {
  brand: 'var(--brand)',
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  muted: 'var(--text-muted)',
  grid: 'var(--border)',
  axis: 'var(--text-muted)',
}

export const OUTCOME_COLORS = {
  Completed: CHART_COLORS.success,
  Failed: CHART_COLORS.danger,
  Stopped: CHART_COLORS.warning,
  Running: CHART_COLORS.info,
  Pending: CHART_COLORS.muted,
}

/**
 * Default dashboard widget layout (react-grid-layout, 12 columns).
 *
 * This grid holds the **analytics tier only**. The decision tier (verdict,
 * triage queue, health board) is pinned above it and is deliberately *not*
 * draggable: an operator must be able to rely on those blocks always being in
 * the same place, on a laptop and on a wallboard alike.
 */
export const DEFAULT_WIDGET_LAYOUT = [
  { i: 'volume', x: 0, y: 0, w: 8, h: 6, minW: 4, minH: 4 },
  { i: 'capacity', x: 8, y: 0, w: 4, h: 6, minW: 3, minH: 4 },
  { i: 'health', x: 0, y: 6, w: 4, h: 5, minW: 3, minH: 4 },
  { i: 'savings', x: 4, y: 6, w: 8, h: 5, minW: 4, minH: 4 },
  { i: 'runs', x: 0, y: 11, w: 8, h: 6, minW: 4, minH: 4 },
  { i: 'sla', x: 8, y: 11, w: 4, h: 6, minW: 3, minH: 4 },
]

export const PERMISSION_GROUPS = {
  dashboard: 'dashboard:read',
  capacityRead: 'capacity:read',
  capacityAct: 'capacity:act',
  processes: 'processes:read',
  roiWrite: 'roi:write',
  slaWrite: 'sla:write',
  runs: 'runs:read',
  runsWrite: 'runs:write',
  infrastructure: 'infrastructure:read',
  infrastructureWrite: 'infrastructure:write',
  lifecycleRead: 'lifecycle:read',
  lifecycleWrite: 'lifecycle:write',
  lifecyclePromote: 'lifecycle:promote',
  lifecycleApprove: 'lifecycle:approve',
  audit: 'audit:read',
  export: 'export:read',
  users: 'users:read',
  usersWrite: 'users:write',
}
