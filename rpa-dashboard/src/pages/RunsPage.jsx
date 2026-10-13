import { Activity, Download, PlayCircle, RotateCcw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'

import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { useCompleteRun, useInfrastructure, useProcessOptions, useReapStaleRuns, useRunStatistics, useRuns, useStartRun, useTopFailures } from '../hooks/api'
import { useDebouncedValue } from '../hooks/ui'
import { CHART_COLORS, DATE_RANGES, RUN_STATUSES } from '../lib/constants'
import { compactNumber, currency, dateTime, durationFromMinutes, relative, runStatusColor } from '../lib/format'
import ExportMenu from '../components/features/ExportMenu'
import { TopFailuresList } from '../components/dashboard/Widgets'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  Pagination,
  SectionTitle,
  Select,
  Textarea,
} from '../components/ui'

const PAGE_SIZE = 50

const STATUS_TONE = { Completed: 'success', Failed: 'danger', Stopped: 'warning', Running: 'info', Pending: 'neutral' }

export default function RunsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { has } = useAuth()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [days, setDays] = useState(30)
  const [page, setPage] = useState(1)
  const [startOpen, setStartOpen] = useState(false)
  const [completeTarget, setCompleteTarget] = useState(null)

  const debounced = useDebouncedValue(search)
  const processes = useProcessOptions()
  const machines = useInfrastructure()

  const filters = useMemo(
    () => ({
      process: debounced || undefined,
      status: status === 'ALL' ? undefined : status,
      since_hours: days * 24,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [debounced, status, days, page],
  )

  const runs = useRuns(filters)
  const statistics = useRunStatistics(days)
  const failures = useTopFailures(days)

  const startRun = useStartRun()
  const completeRun = useCompleteRun()
  const reap = useReapStaleRuns()

  const canRun = has('runs:write') || has('commands:write') || has('*')
  const rows = runs.data?.items || []
  const total = runs.data?.total || 0

  const onStart = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const result = await startRun.mutateAsync({
        ProcessName: form.get('ProcessName'),
        MachineName: form.get('MachineName') || undefined,
        Trigger: 'Manual',
        Reason: form.get('Reason') || undefined,
      })
      toast.success(t('runs.started'), result?.RunID ? `#${result.RunID}` : undefined)
      setStartOpen(false)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onComplete = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await completeRun.mutateAsync({
        runId: completeTarget.RunID,
        Status: form.get('Status'),
        TransactionsCount: Number(form.get('TransactionsCount') || 0),
        SuccessCount: Number(form.get('SuccessCount') || 0),
        FailedCount: Number(form.get('FailedCount') || 0),
        FailureReason: form.get('FailureReason') || undefined,
      })
      toast.success(t('actions.save'), `#${completeTarget.RunID}`)
      setCompleteTarget(null)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onReap = async () => {
    try {
      const result = await reap.mutateAsync()
      toast.success(t('runs.reaped', { count: result?.closed ?? result?.count ?? 0 }))
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('runs.title')}
        subtitle={t('runs.subtitle')}
        actions={
          <>
            <ExportMenu days={days} />
            {canRun ? (
              <>
                <Button variant="secondary" icon={RotateCcw} loading={reap.isPending} onClick={onReap}>
                  {t('runs.reapStale')}
                </Button>
                <Button icon={PlayCircle} onClick={() => setStartOpen(true)}>
                  {t('runs.startRun')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t('runs.statistics')} icon={Activity} />
          <CardBody>
            {!(statistics.data?.daily || []).length ? (
              <EmptyState title={t('dashboard.empty.chart')} className="py-8" />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statistics.data?.daily || []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                    <XAxis dataKey="date" stroke={CHART_COLORS.axis} fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke={CHART_COLORS.axis} fontSize={11} tickLine={false} axisLine={false} />
                    <ChartTooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="completed" stackId="a" fill={CHART_COLORS.success} radius={[0, 0, 0, 0]} name={t('audit.success')} />
                    <Bar dataKey="failed" stackId="a" fill={CHART_COLORS.danger} radius={[4, 4, 0, 0]} name={t('audit.failed')} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('runs.topFailures')} icon={RotateCcw} />
          <CardBody>
            <TopFailuresList rows={failures.data} loading={failures.isLoading} />
          </CardBody>
        </Card>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('processes.process')}</span>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                className="h-9 w-52 ps-9 text-xs"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder={t('actions.search')}
              />
            </div>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('runs.status')}</span>
            <Select
              className="h-9 w-40 py-0 text-xs"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
              }}
            >
              <option value="ALL">{t('dashboard.filters.all')}</option>
              {RUN_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('dashboard.filters.range')}</span>
            <Select
              className="h-9 w-36 py-0 text-xs"
              value={days}
              onChange={(event) => {
                setDays(Number(event.target.value))
                setPage(1)
              }}
            >
              {DATE_RANGES.map((range) => (
                <option key={range.value} value={range.value}>
                  {t('dashboard.filters.days', { count: range.count })}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      <Card>
        <DataTable
          loading={runs.isLoading}
          rows={rows}
          rowKey={(row) => row.RunID}
          empty={<EmptyState title={t('dashboard.empty.runs')} />}
          columns={[
            {
              key: 'Status',
              header: t('runs.status'),
              width: 130,
              render: (row) => (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: runStatusColor(row.Status) }} />
                  <span className="text-xs">{row.Status}</span>
                </span>
              ),
            },
            {
              key: 'ProcessName',
              header: t('processes.process'),
              sortable: true,
              render: (row) => (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{row.ProcessName}</p>
                  <p className="truncate font-mono text-[11px] text-muted">{row.RequestID}</p>
                </div>
              ),
            },
            { key: 'MachineName', header: t('runs.machine'), render: (row) => row.MachineName || '—' },
            {
              key: 'StartTime',
              header: t('runs.started'),
              sortable: true,
              render: (row) => (
                <span className="text-xs text-muted" title={dateTime(row.StartTime)}>
                  {relative(row.StartTime)}
                </span>
              ),
            },
            {
              key: 'DurationMinutes',
              header: t('runs.duration'),
              align: 'end',
              sortable: true,
              render: (row) => <span className="tabular-nums text-xs">{durationFromMinutes(row.DurationMinutes)}</span>,
            },
            {
              key: 'TransactionsCount',
              header: t('runs.transactions'),
              align: 'end',
              render: (row) => (
                <span className="tabular-nums text-xs">
                  {compactNumber(row.TransactionsCount || 0)}
                  {row.FailedCount ? <span className="ms-1 text-danger">({row.FailedCount})</span> : null}
                </span>
              ),
            },
            {
              key: 'TimeSavedHours',
              header: t('dashboard.timeSaved'),
              align: 'end',
              render: (row) => <span className="tabular-nums text-xs">{Number(row.TimeSavedHours || 0).toFixed(1)}h</span>,
            },
            {
              key: 'CostSaved',
              header: t('processes.costSaved'),
              align: 'end',
              sortable: true,
              render: (row) => <span className="tabular-nums text-xs text-success">{currency(row.CostSaved || 0)}</span>,
            },
            {
              key: 'FailureReason',
              header: t('runs.failureReason'),
              render: (row) =>
                row.FailureReason ? (
                  <span className="block max-w-[18rem] truncate text-xs text-danger" title={row.FailureReason}>
                    {row.FailureReason}
                  </span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'actions',
              header: '',
              align: 'end',
              render: (row) =>
                canRun && ['Running', 'Pending'].includes(row.Status) ? (
                  <Button size="sm" variant="ghost" onClick={() => setCompleteTarget(row)}>
                    {t('actions.confirm')}
                  </Button>
                ) : (
                  <Badge tone={STATUS_TONE[row.Status] || 'neutral'}>{row.Status}</Badge>
                ),
            },
          ]}
          footer={
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={() => setPage(1)}
              labels={{ of: t('common.of'), none: t('common.na') }}
            />
          }
        />
      </Card>

      {/* ------------------------------------------------------- start job */}
      <Modal
        open={startOpen}
        onClose={() => setStartOpen(false)}
        title={t('runs.startRun')}
        description={t('runs.manualStart')}
        size="sm"
      >
        <form onSubmit={onStart} className="space-y-3">
          <Field label={t('processes.process')} required>
            <Select name="ProcessName" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {(processes.data || []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('runs.machine')}>
            <Select name="MachineName" defaultValue="">
              <option value="">{t('dashboard.filters.all')}</option>
              {(machines.data || [])
                .filter((machine) => machine.IsOnline)
                .map((machine) => (
                  <option key={machine.MachineName} value={machine.MachineName}>
                    {machine.MachineName}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('lifecycle.riskNotes')} hint={t('audit.title')}>
            <Textarea name="Reason" rows={2} />
          </Field>
          <Notice tone="info">{t('lifecycle.workflow.breakGlass')}</Notice>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setStartOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={startRun.isPending} icon={Download}>
              {t('runs.startRun')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* --------------------------------------------------- complete run */}
      <Modal open={Boolean(completeTarget)} onClose={() => setCompleteTarget(null)} title={t('actions.confirm')} description={completeTarget ? `#${completeTarget.RunID} · ${completeTarget.ProcessName}` : ''} size="sm">
        {completeTarget ? (
          <form onSubmit={onComplete} className="space-y-3">
            <Field label={t('runs.status')} required>
              <Select name="Status" defaultValue="Completed" required>
                {['Completed', 'Failed', 'Stopped'].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('runs.transactions')}>
                <Input name="TransactionsCount" type="number" min="0" defaultValue={completeTarget.TransactionsCount || 0} />
              </Field>
              <Field label={t('audit.success')}>
                <Input name="SuccessCount" type="number" min="0" defaultValue={completeTarget.SuccessCount || 0} />
              </Field>
              <Field label={t('audit.failed')}>
                <Input name="FailedCount" type="number" min="0" defaultValue={completeTarget.FailedCount || 0} />
              </Field>
            </div>
            <Field label={t('runs.failureReason')}>
              <Input name="FailureReason" defaultValue={completeTarget.FailureReason || ''} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setCompleteTarget(null)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={completeRun.isPending}>
                {t('actions.save')}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  )
}
