import { motion } from 'framer-motion'
import { AlertTriangle, Gauge, ListChecks, Sparkles, Timer, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'

import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { useCapacityHistory, useCapacityInsights, useGenerateRecommendations, useUpdateRecommendationStatus } from '../hooks/api'
import { CHART_COLORS, RECOMMENDATION_STATUSES } from '../lib/constants'
import { compactNumber, currency, durationFromMinutes, percent, relative, severityColor } from '../lib/format'
import ExportMenu from '../components/features/ExportMenu'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  InfoTile,
  Modal,
  Notice,
  ProgressBar,
  SectionTitle,
  Select,
  SeverityBadge,
  Skeleton,
  Textarea,
} from '../components/ui'
import { CapacitySummaryTiles } from '../components/dashboard/Widgets'

const toneForSla = (status) => (status === 'Breach_Risk' || status === 'Breach' ? 'danger' : status === 'Warning' ? 'warning' : 'success')

export default function CapacityPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { has } = useAuth()

  const insights = useCapacityInsights()
  const history = useCapacityHistory({ days: 30 })
  const generate = useGenerateRecommendations()
  const decide = useUpdateRecommendationStatus()

  const [severity, setSeverity] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')

  const data = insights.data
  const canAct = has('capacity:act') || has('*')

  const recommendations = useMemo(() => {
    let rows = data?.recommendations || []
    if (severity !== 'ALL') rows = rows.filter((row) => row.severity === severity)
    if (status !== 'ALL') rows = rows.filter((row) => row.status === status)
    return rows
  }, [data, severity, status])

  const decideRecommendation = async (recommendation, nextStatus, note) => {
    try {
      await decide.mutateAsync({ id: recommendation.id, status: nextStatus, comment: note })
      toast.success(t(`capacity.statuses.${nextStatus}`), recommendation.process_name)
      setSelected(null)
      setComment('')
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  if (insights.isError) {
    return (
      <Card>
        <ErrorState error={insights.error} onRetry={() => insights.refetch()} retryLabel={t('actions.retry')} />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('capacity.title')}
        subtitle={t('capacity.subtitle')}
        actions={
          <>
            <ExportMenu days={30} />
            {canAct ? (
              <Button icon={Sparkles} loading={generate.isPending} onClick={() => generate.mutate()}>
                {generate.isPending ? t('capacity.generating') : t('capacity.generate')}
              </Button>
            ) : null}
          </>
        }
      />

      <CapacitySummaryTiles summary={data?.summary} loading={insights.isLoading} />

      {data?.summary?.generated_at ? (
        <p className="text-[11px] text-muted">
          {t('app.lastUpdated', { time: relative(data.summary.generated_at) })} ·{' '}
          {t('capacity.projectedRelief')}: {currency(data.summary.potential_savings_7d || 0)}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ------------------------------------------------- utilization */}
        <Card className="xl:col-span-2">
          <CardHeader title={t('capacity.utilisation')} subtitle={`${t('capacity.slaTarget')} · ${t('capacity.queueDepth')}`} icon={Gauge} />
          <DataTable
            loading={insights.isLoading}
            rows={data?.utilization || []}
            rowKey={(row) => row.process_name}
            empty={<EmptyState title={t('capacity.noInsights')} className="py-8" />}
            columns={[
              {
                key: 'process_name',
                header: t('processes.process'),
                render: (row) => (
                  <div>
                    <p className="text-sm font-medium text-text">{row.process_name}</p>
                    <p className="text-[11px] text-muted">
                      {row.department} · {row.criticality}
                    </p>
                  </div>
                ),
              },
              {
                key: 'utilization_percent',
                header: t('capacity.utilisation'),
                width: 160,
                render: (row) => (
                  <div className="space-y-1">
                    <ProgressBar value={row.utilization_percent} showLabel />
                  </div>
                ),
              },
              {
                key: 'queue_depth',
                header: t('capacity.queueDepth'),
                align: 'end',
                render: (row) => <span className="tabular-nums">{compactNumber(row.queue_depth || 0)}</span>,
              },
              {
                key: 'predicted_wait_minutes',
                header: t('capacity.predictedWait'),
                align: 'end',
                render: (row) => (
                  <span className={row.predicted_wait_minutes > (row.sla_target_minutes || 0) ? 'font-medium text-danger' : ''}>
                    {durationFromMinutes(row.predicted_wait_minutes)}
                    <span className="ms-1 text-[11px] text-muted">/ {durationFromMinutes(row.sla_target_minutes)}</span>
                  </span>
                ),
              },
              {
                key: 'sla_status',
                header: t('capacity.status'),
                render: (row) => <Badge tone={toneForSla(row.sla_status)}>{String(row.sla_status || 'Healthy').replace('_', ' ')}</Badge>,
              },
              {
                key: 'online_runners',
                header: t('capacity.onlineRunners'),
                align: 'center',
                render: (row) => <span className="tabular-nums">{row.online_runners}</span>,
              },
              {
                key: 'cost_saved_7d',
                header: t('processes.costSaved'),
                align: 'end',
                render: (row) => <span className="tabular-nums text-success">{currency(row.cost_saved_7d || 0)}</span>,
              },
            ]}
          />
        </Card>

        {/* ------------------------------------------------- bottlenecks */}
        <Card>
          <CardHeader title={t('capacity.bottlenecks')} icon={Timer} />
          <CardBody className="space-y-3">
            {insights.isLoading ? <Skeleton className="h-32" /> : null}
            {!insights.isLoading && !(data?.bottlenecks || []).length ? (
              <EmptyState title={t('capacity.noInsights')} className="py-6" />
            ) : null}
            {(data?.bottlenecks || []).map((row) => (
              <div key={row.process_name} className="rounded-xl border border-border bg-surface-2/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-text">{row.process_name}</p>
                  <Badge tone={toneForSla(row.sla_status)}>{String(row.sla_status).replace('_', ' ')}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <InfoTile label={t('capacity.queueDepth')} value={compactNumber(row.queue_depth)} />
                  <InfoTile
                    label={t('capacity.predictedWait')}
                    value={durationFromMinutes(row.predicted_wait_minutes)}
                    tone={row.predicted_wait_minutes > row.sla_target_minutes ? 'danger' : 'success'}
                  />
                  <InfoTile label={t('capacity.slaTarget')} value={durationFromMinutes(row.sla_target_minutes)} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* ------------------------------------------------- recommendations */}
      <Card>
        <CardHeader
          title={t('capacity.insights')}
          subtitle={t('capacity.recommendations')}
          icon={ListChecks}
          actions={
            <div className="flex items-center gap-2">
              <Select className="h-8 w-32 py-0 text-xs" value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label={t('capacity.severity.Critical')}>
                <option value="ALL">{t('dashboard.filters.all')}</option>
                {['Info', 'Warning', 'Critical'].map((level) => (
                  <option key={level} value={level}>
                    {t(`capacity.severity.${level}`)}
                  </option>
                ))}
              </Select>
              <Select className="h-8 w-40 py-0 text-xs" value={status} onChange={(event) => setStatus(event.target.value)} aria-label={t('capacity.status')}>
                <option value="ALL">{t('dashboard.filters.all')}</option>
                {RECOMMENDATION_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {t(`capacity.statuses.${item}`)}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <CardBody className="space-y-3">
          {insights.isLoading ? <Skeleton className="h-24" /> : null}
          {!insights.isLoading && recommendations.length === 0 ? (
            <EmptyState
              title={t('capacity.noInsights')}
              description={t('capacity.subtitle')}
              className="py-8"
            />
          ) : null}
          {recommendations.map((item, index) => (
            <motion.article
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: Math.min(index * 0.03, 0.2) }}
              className="rounded-2xl border border-border bg-surface-2/50 p-4"
              style={{ borderInlineStartWidth: 4, borderInlineStartColor: severityColor(item.severity) }}
            >
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-text">{item.title}</h3>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {item.process_name} · {item.department} · {relative(item.created_at)}
                    {item.kind ? ` · ${item.kind.replace(/_/g, ' ')}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={item.severity} label={t(`capacity.severity.${item.severity}`)} />
                  <Badge tone="neutral">{t(`capacity.statuses.${item.status}`) || item.status}</Badge>
                </div>
              </header>

              <p className="mt-2 text-xs leading-relaxed text-text/90">{item.detail}</p>

              {item.metrics && Object.keys(item.metrics).length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(item.metrics).map(([key, value]) => (
                    <InfoTile key={key} label={key.replace(/_/g, ' ')} value={typeof value === 'number' ? Number(value).toFixed(1) : String(value)} />
                  ))}
                </div>
              ) : null}

              {item.suggested_action ? (
                <Notice tone="info" className="mt-3">
                  {item.suggested_action}
                </Notice>
              ) : null}

              {canAct ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelected(item)}>
                    {t('actions.requestCapacity')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decideRecommendation(item, 'Acknowledged')}>
                    {t('actions.acknowledge')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decideRecommendation(item, 'Applied')}>
                    {t('actions.markApplied')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decideRecommendation(item, 'Dismissed')}>
                    {t('actions.dismiss')}
                  </Button>
                  {item.acknowledged_by ? (
                    <span className="text-[11px] text-muted">
                      {t('actions.acknowledge')}: {item.acknowledged_by}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </motion.article>
          ))}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------- history */}
      <Card>
        <CardHeader title={t('capacity.history')} subtitle={t('capacity.queueDepth')} icon={TrendingUp} />
        <CardBody>
          {history.isLoading ? (
            <Skeleton className="h-56" />
          ) : !(history.data || []).length ? (
            <EmptyState title={t('dashboard.empty.chart')} className="py-8" />
          ) : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history.data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                  <XAxis dataKey="date" stroke={CHART_COLORS.axis} fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke={CHART_COLORS.axis} fontSize={11} tickLine={false} axisLine={false} />
                  <ChartTooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="avg_pending" stroke={CHART_COLORS.warning} fill={CHART_COLORS.warning} fillOpacity={0.15} strokeWidth={2} name="avg pending" />
                  <Area type="monotone" dataKey="max_pending" stroke={CHART_COLORS.danger} fill="transparent" strokeWidth={2} name="max pending" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---------------------------------------------- request capacity */}
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={t('actions.requestCapacity')}
        description={selected?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              {t('actions.cancel')}
            </Button>
            <Button
              loading={decide.isPending}
              onClick={() => selected && decideRecommendation(selected, 'Requested', comment)}
            >
              {t('actions.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {selected ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <InfoTile label={t('capacity.utilisation')} value={percent(selected.metrics?.utilization_percent || 0)} />
                <InfoTile label={t('capacity.recommendedAdd')} value={selected.action_payload?.runners_to_add ?? selected.metrics?.runners_to_add ?? '—'} />
                <InfoTile label={t('capacity.predictedWait')} value={durationFromMinutes(selected.metrics?.predicted_wait_minutes || 0)} />
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-2 text-xs text-brand">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                {selected.detail}
              </div>
              <Field label={t('lifecycle.riskNotes')} hint={t('lifecycle.workflow.fourEyes')}>
                <Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} />
              </Field>
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
