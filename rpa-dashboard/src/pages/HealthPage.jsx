import { Activity, CheckCircle2, Database, HardDrive, KeyRound, Radio, ShieldCheck, Timer, XCircle, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useHealthDetail, useRealtimeSnapshot } from '../hooks/api'
import { durationFromSeconds, percent, relative, severityColor } from '../lib/format'
import { Badge, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, InfoTile, Notice, SectionTitle, Skeleton, cx } from '../components/ui'

function StatusPill({ ok, label }) {
  return (
    <Badge tone={ok ? 'success' : 'danger'} dot>
      {label || (ok ? 'OK' : 'Down')}
    </Badge>
  )
}

function StatCard({ title, icon: Icon, children, ok }) {
  return (
    <Card className="h-full">
      <CardHeader
        title={title}
        icon={Icon}
        actions={ok === undefined ? null : <StatusPill ok={ok} />}
      />
      <CardBody className="space-y-2">{children}</CardBody>
    </Card>
  )
}

export default function HealthPage() {
  const { t } = useTranslation()
  const health = useHealthDetail()
  const realtime = useRealtimeSnapshot()
  const data = health.data

  if (health.isError) {
    return (
      <Card>
        <ErrorState error={health.error} onRetry={() => health.refetch()} retryLabel={t('actions.retry')} />
      </Card>
    )
  }

  if (health.isLoading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      </div>
    )
  }

  const schema = data?.schema || {}
  const security = data?.security || {}
  const problems = Array.isArray(security.security_problems) ? security.security_problems : []
  const schedulerJobs = Array.isArray(data?.scheduler?.jobs) ? data.scheduler.jobs : []
  // The API currently reports `jobs` as a count. Keep supporting a jobs array
  // too, so the page remains compatible if the API starts returning job details.
  const schedulerJobCount = Number.isFinite(data?.scheduler?.jobs)
    ? data.scheduler.jobs
    : schedulerJobs.length

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('health.title')}
        subtitle={t('health.subtitle')}
        actions={
          <span className="text-xs text-muted">
            {data?.service?.name} v{data?.service?.version} · {data?.service?.environment}
          </span>
        }
      />

      {problems.length ? (
        <Notice tone="warning" title={t('health.problems')}>
          <ul className="list-inside list-disc space-y-0.5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice tone="success" icon={CheckCircle2} title={t('health.allGood')} />
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <StatCard title={t('health.service')} icon={Activity} ok={(data?.service?.uptime_seconds ?? 0) > 0}>
          <InfoTile label={t('health.uptime')} value={durationFromSeconds(data?.service?.uptime_seconds || 0)} />
          <InfoTile label={t('settings.apiVersion')} value={data?.service?.version || '—'} />
          <InfoTile label={t('runs.machine')} value={data?.service?.environment || '—'} />
        </StatCard>

        <StatCard title={t('health.database')} icon={Database} ok={data?.database?.ok}>
          <InfoTile label="Dialect" value={data?.database?.dialect || '—'} />
          <InfoTile label={t('health.latency')} value={`${data?.database?.latency_ms ?? '—'} ms`} tone={(data?.database?.latency_ms || 0) > 200 ? 'warning' : 'success'} />
          <InfoTile label={t('health.schema')} value={`${schema.existing ?? 0} / ${schema.expected ?? 0}`} tone={(schema.missing || []).length ? 'danger' : 'success'} />
        </StatCard>

        <StatCard title={t('health.cache')} icon={HardDrive} ok={data?.cache?.ok}>
          <InfoTile label={t('health.cache')} value={data?.cache?.backend || '—'} />
          <InfoTile label={t('health.secrets')} value={data?.secrets?.backend || '—'} tone={data?.secrets?.ok ? 'success' : 'danger'} />
          <InfoTile label={t('health.realtime')} value={`${data?.realtime?.subscribers ?? realtime.data?.subscribers ?? 0} ${t('health.subscribers')}`} />
        </StatCard>

        <StatCard title={t('health.realtime')} icon={Radio} ok={data?.realtime !== undefined}>
          <InfoTile label={t('health.subscribers')} value={data?.realtime?.subscribers ?? 0} />
          <InfoTile label={t('health.agents')} value={data?.realtime?.agents_connected ?? 0} tone={(data?.realtime?.agents_connected || 0) > 0 ? 'success' : 'neutral'} />
          <div className="flex flex-wrap gap-1">
            {(data?.realtime?.agents || []).slice(0, 8).map((agent) => (
              <Badge key={agent.MachineName || agent} tone="info">
                {agent.MachineName || agent}
              </Badge>
            ))}
          </div>
        </StatCard>

        <StatCard title={t('health.scheduler')} icon={Timer} ok={data?.scheduler?.running}>
          <InfoTile label={t('health.jobs')} value={schedulerJobCount} />
          <div className="space-y-1">
            {schedulerJobs.map((job, index) => (
              <div key={job.id || job.name || index} className="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="truncate">{job.id || job.name || job}</span>
                <span className="tabular-nums">{job.next_run_time || job.next || '—'}</span>
              </div>
            ))}
          </div>
        </StatCard>

        <StatCard title={t('health.security')} icon={ShieldCheck} ok={problems.length === 0}>
          <div className="grid grid-cols-2 gap-2">
            <InfoTile label="MFA" value={security.mfa_enabled ? t('common.yes') : t('common.no')} tone={security.mfa_enabled ? 'success' : 'warning'} />
            <InfoTile label="CSRF" value={security.csrf_enabled ? t('common.yes') : t('common.no')} tone={security.csrf_enabled ? 'success' : 'warning'} />
            <InfoTile label="Secure cookie" value={security.cookie_secure ? t('common.yes') : t('common.no')} tone={security.cookie_secure ? 'success' : 'warning'} />
            <InfoTile label="IP allowlist" value={security.ip_allowlist ? t('common.yes') : t('common.no')} />
            <InfoTile label="Access token" value={`${security.access_token_minutes ?? '—'} min`} />
            <InfoTile label="Refresh token" value={`${security.refresh_token_days ?? '—'} d`} />
          </div>
        </StatCard>
      </div>

      <Card>
        <CardHeader title={t('health.schema')} subtitle={`${schema.existing ?? 0} / ${schema.expected ?? 0}`} icon={KeyRound} />
        <CardBody className="space-y-3">
          {(schema.missing || []).length ? (
            <Notice tone="danger" title={t('health.schemaDrift', { count: schema.missing.length })}>
              <div className="flex flex-wrap gap-1">
                {schema.missing.map((table) => (
                  <Badge key={table} tone="danger">
                    {table}
                  </Badge>
                ))}
              </div>
            </Notice>
          ) : (
            <div className="flex items-center gap-2 text-xs text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {t('health.allGood')}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader title={t('health.platforms')} icon={Zap} />
          <CardBody className="space-y-2">
            {(data?.platforms || []).map((provider) => (
              <div key={provider.provider} className="rounded-xl border border-border bg-surface-2/60 p-3" style={{ borderInlineStartWidth: 3, borderInlineStartColor: provider.ok ? 'var(--success)' : 'var(--danger)' }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-text">{provider.display_name || provider.provider}</p>
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-muted">{provider.latency_ms} ms</span>
                    {provider.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-danger" />}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted">{provider.message}</p>
              </div>
            ))}
            {!(data?.platforms || []).length ? <EmptyState title={t('dashboard.empty.table')} className="py-6" /> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('health.features')} icon={ShieldCheck} />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(data?.features || {}).map(([feature, enabled]) => (
                <div key={feature} className="flex items-center justify-between rounded-lg border border-border bg-surface-2/60 px-3 py-2">
                  <span className="text-xs capitalize text-text">{feature.replace(/_/g, ' ')}</span>
                  <span className={cx('h-2 w-2 rounded-full', enabled ? 'bg-success' : 'bg-muted')} style={{ background: enabled ? severityColor('Info') : undefined }} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(data?.available_providers || []).map((provider) => (
                <InfoTile key={provider.provider} label={provider.display_name || provider.provider} value={provider.provider} />
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t('health.scheduler')} subtitle={t('health.lastRun')} icon={Timer} />
        <DataTable
          rows={Object.entries(data?.scheduler?.last_runs || {}).map(([job, info]) => ({ job, ...(typeof info === 'object' ? info : { at: info }) }))}
          dense
          rowKey={(row) => row.job}
          empty={<EmptyState title={t('dashboard.empty.table')} className="py-6" />}
          columns={[
            { key: 'job', header: t('health.jobs') },
            { key: 'at', header: t('health.lastRun'), render: (row) => <span className="text-xs text-muted">{row.at ? relative(row.at) : '—'}</span> },
            { key: 'ok', header: t('audit.result'), render: (row) => (row.ok === undefined ? '—' : <StatusPill ok={row.ok} />) },
            { key: 'duration_ms', header: t('health.latency'), align: 'end', render: (row) => (row.duration_ms ? `${row.duration_ms} ms` : '—') },
          ]}
        />
      </Card>

      <p className="text-[11px] text-muted">
        {t('health.subscribers')}: {percent(data?.realtime?.subscribers ? 100 : 0, 0)} · {t('app.live')} · {t('app.version', { version: data?.service?.version || '—' })}
      </p>
    </div>
  )
}
