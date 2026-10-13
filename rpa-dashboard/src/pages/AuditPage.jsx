import { motion } from 'framer-motion'
import { Activity, Bell, ChevronDown, ScrollText, Send, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'

import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { useAuditLogs, useAuditSummary, useDepartments, useNotificationStats, useNotifications, useSendTestNotification } from '../hooks/api'
import { useDebouncedValue } from '../hooks/ui'
import { CHART_COLORS, DATE_RANGES } from '../lib/constants'
import { dateTime, relative } from '../lib/format'
import ExportMenu from '../components/features/ExportMenu'
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, InfoTile, Input, SearchInput, SectionTitle, Select, Skeleton, Switch } from '../components/ui'

const COMMON_ACTIONS = [
  'Login_Success',
  'Login_Failed',
  'Login_MFA_Challenge',
  'Logout',
  'Run_Started',
  'Run_Completed',
  'Runs_Reaped',
  'Process_Updated',
  'Process_Deleted',
  'Recommendation_Generated',
  'Recommendation_StatusChanged',
  'Version_Promoted',
  'Version_Rollback',
  'Approval_Requested',
  'Approval_Decided',
  'Vault_Read',
  'Vault_Rotate_Key',
  'Organization_Branding_Updated',
  'Organization_Platform_Configured',
  'User_Created',
  'User_Disabled',
  'Dashboard_Refreshed',
]

function JsonDiff({ before, after }) {
  const { t } = useTranslation()
  const parse = (value) => {
    if (!value) return null
    if (typeof value === 'object') return value
    try {
      return JSON.parse(value)
    } catch {
      return { value }
    }
  }
  const beforeObj = parse(before)
  const afterObj = parse(after)
  if (!beforeObj && !afterObj) return null

  const keys = [...new Set([...Object.keys(beforeObj || {}), ...Object.keys(afterObj || {})])]
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted">{t('audit.details')} — {t('common.no')}</p>
        <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-surface-2 p-2 text-[11px] text-muted">
          {JSON.stringify(beforeObj, null, 2) || '—'}
        </pre>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted">{t('audit.details')} — {t('common.yes')}</p>
        <pre className="mt-1 overflow-x-auto rounded-lg border border-success/40 bg-success-soft p-2 text-[11px] text-text">
          {JSON.stringify(afterObj, null, 2) || '—'}
        </pre>
      </div>
      <p className="text-[11px] text-muted md:col-span-2">
        {keys.length} field(s) · {keys.join(', ')}
      </p>
    </div>
  )
}

export default function AuditPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { has } = useAuth()

  const [search, setSearch] = useState('')
  const [actionType, setActionType] = useState('')
  const [department, setDepartment] = useState('ALL')
  const [days, setDays] = useState(30)
  const [onlyFailures, setOnlyFailures] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const debounced = useDebouncedValue(search)
  const departments = useDepartments()

  const filters = useMemo(
    () => ({
      search: debounced || undefined,
      action_type: actionType || undefined,
      department: department === 'ALL' ? undefined : department,
      days,
      limit: 200,
    }),
    [debounced, actionType, department, days],
  )

  const logs = useAuditLogs(filters)
  const summary = useAuditSummary(days)
  const notifications = useNotifications({ limit: 50 })
  const notificationStats = useNotificationStats(days)
  const sendTest = useSendTestNotification()

  const items = useMemo(() => {
    const rows = logs.data?.items || []
    return onlyFailures ? rows.filter((row) => !row.IsSuccess) : rows
  }, [logs.data, onlyFailures])

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        actions={<ExportMenu days={days} />}
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <Card className="xl:col-span-3">
          <CardHeader title={t('audit.activity', { days })} icon={Activity} />
          <CardBody>
            {!(summary.data?.activity || []).length ? (
              <EmptyState title={t('dashboard.empty.chart')} className="py-8" />
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.data?.activity || []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                    <XAxis dataKey="day" stroke={CHART_COLORS.axis} fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke={CHART_COLORS.axis} fontSize={11} tickLine={false} axisLine={false} />
                    <ChartTooltip
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                    />
                    <Bar dataKey="events" fill={CHART_COLORS.brand} radius={[6, 6, 0, 0]} name="# events" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('audit.failures')} icon={ShieldAlert} />
          <CardBody className="space-y-2">
            {summary.isLoading ? <Skeleton className="h-32" /> : null}
            {!(summary.data?.recent_failures || []).length && !summary.isLoading ? (
              <EmptyState title={t('audit.empty')} className="py-6" />
            ) : null}
            {(summary.data?.recent_failures || []).slice(0, 8).map((failure) => (
              <motion.div key={failure.LogID || `${failure.ActionType}-${failure.ActionDate}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-danger/30 bg-danger-soft/60 p-2.5">
                <p className="text-xs font-medium text-text">{failure.ActionType}</p>
                <p className="text-[11px] text-muted">
                  {failure.Username} · {relative(failure.ActionDate)} · {failure.IPAddress}
                </p>
              </motion.div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('actions.search')}</span>
            <SearchInput
              className="w-56"
              value={search}
              onChange={setSearch}
              onClear={() => setSearch('')}
              placeholder={t('audit.entity')}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('audit.action')}</span>
            <Input
              className="h-10 w-56 text-xs"
              list="audit-actions"
              value={actionType}
              onChange={(event) => setActionType(event.target.value)}
              placeholder="Run_Completed"
            />
            <datalist id="audit-actions">
              {COMMON_ACTIONS.map((action) => (
                <option key={action} value={action} />
              ))}
            </datalist>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('processes.department')}</span>
            <Select className="h-10 w-44 py-0 text-xs" value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="ALL">{t('dashboard.filters.all')}</option>
              {(departments.data || []).map((row) => {
                const name = typeof row === 'string' ? row : row.Department || row.department || row.name
                return (
                  <option key={name} value={name}>
                    {name}
                  </option>
                )
              })}
            </Select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('dashboard.filters.range')}</span>
            <Select className="h-10 w-36 py-0 text-xs" value={days} onChange={(event) => setDays(Number(event.target.value))}>
              {DATE_RANGES.map((range) => (
                <option key={range.value} value={range.value}>
                  {t('dashboard.filters.days', { count: range.count })}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex h-10 items-center">
            <Switch checked={onlyFailures} onChange={setOnlyFailures} label={t('audit.failed')} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('audit.title')} subtitle={`${items.length} / ${logs.data?.count ?? '—'}`} icon={ScrollText} />
        <DataTable
          loading={logs.isLoading}
          rows={items}
          dense
          rowKey={(row) => row.LogID}
          empty={<EmptyState title={t('audit.empty')} />}
          onRowClick={(row) => setExpanded(expanded === row.LogID ? null : row.LogID)}
          columns={[
            {
              key: 'ActionDate',
              header: t('audit.when'),
              sortable: true,
              width: 170,
              render: (row) => (
                <span className="text-xs text-muted" title={dateTime(row.ActionDate)}>
                  {relative(row.ActionDate)}
                </span>
              ),
            },
            { key: 'Username', header: t('audit.who'), render: (row) => <span className="text-xs font-medium">{row.Username}</span> },
            {
              key: 'ActionType',
              header: t('audit.action'),
              render: (row) => (
                <span className="inline-flex items-center gap-1">
                  <Badge tone={row.IsSuccess ? 'brand' : 'danger'}>{row.ActionType}</Badge>
                  {(row.OldValues || row.NewValues) && expanded !== row.LogID ? <ChevronDown className="h-3 w-3 text-muted" /> : null}
                </span>
              ),
            },
            {
              key: 'EntityType',
              header: t('audit.entity'),
              render: (row) => (
                <span className="text-xs">
                  {row.EntityType || row.ProcessName || '—'}
                  {row.EntityID ? <span className="ms-1 text-muted">#{row.EntityID}</span> : null}
                </span>
              ),
            },
            { key: 'IPAddress', header: t('audit.ip'), render: (row) => <span className="font-mono text-[11px]">{row.IPAddress || '—'}</span> },
            {
              key: 'IsSuccess',
              header: t('audit.result'),
              align: 'center',
              render: (row) => (
                <Badge tone={row.IsSuccess ? 'success' : 'danger'} dot>
                  {row.IsSuccess ? t('audit.success') : t('audit.failed')}
                </Badge>
              ),
            },
          ]}
          footer={
            expanded ? (
              <div className="p-2">
                <JsonDiff before={logs.data?.items?.find((row) => row.LogID === expanded)?.OldValues} after={logs.data?.items?.find((row) => row.LogID === expanded)?.NewValues} />
              </div>
            ) : null
          }
        />
      </Card>

      {/* -------------------------------------------------- notifications */}
      <Card>
        <CardHeader
          title={t('nav.audit')}
          subtitle={`${notificationStats.data?.sent ?? 0} / ${notificationStats.data?.total ?? 0}`}
          icon={Bell}
          actions={
            has('*') ? (
              <Button
                size="sm"
                variant="secondary"
                icon={Send}
                loading={sendTest.isPending}
                onClick={async () => {
                  try {
                    await sendTest.mutateAsync('Info')
                    toast.success(t('app.live'))
                  } catch (error) {
                    toast.error(t('errors.title'), error.message)
                  }
                }}
              >
                Test
              </Button>
            ) : null
          }
        />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <InfoTile label={t('audit.success')} value={notificationStats.data?.success_rate !== undefined ? `${notificationStats.data.success_rate}%` : '—'} tone="success" />
            <InfoTile label={t('audit.failed')} value={notificationStats.data?.failed ?? 0} tone={notificationStats.data?.failed ? 'danger' : 'neutral'} />
            <InfoTile label="Skipped" value={notificationStats.data?.skipped ?? 0} />
            <InfoTile label="Channels" value={(notificationStats.data?.configured_channels || []).join(', ') || '—'} />
          </div>
          <DataTable
            loading={notifications.isLoading}
            rows={notifications.data || []}
            dense
            rowKey={(row) => row.NotificationID}
            empty={<EmptyState title={t('dashboard.empty.table')} className="py-6" />}
            columns={[
              { key: 'Channel', header: 'Channel', render: (row) => <Badge tone="info">{row.Channel}</Badge> },
              { key: 'Subject', header: t('audit.details'), render: (row) => <span className="block max-w-[24rem] truncate text-xs">{row.Subject}</span> },
              {
                key: 'Status',
                header: t('audit.result'),
                render: (row) => <Badge tone={row.Status === 'Sent' ? 'success' : row.Status === 'Failed' ? 'danger' : 'neutral'}>{row.Status}</Badge>,
              },
              { key: 'Error', header: 'Error', render: (row) => <span className="block max-w-[18rem] truncate text-[11px] text-muted">{row.Error || '—'}</span> },
              { key: 'CreatedAt', header: t('audit.when'), render: (row) => <span className="text-xs text-muted">{relative(row.CreatedAt)}</span> },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  )
}
