import { motion } from 'framer-motion'
import { Activity, Cpu, HardDrive, Plug, RefreshCw, Server, ServerCog, ShieldOff, Terminal, Wifi } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import {
  useCommands,
  useConnectedAgents,
  useDeleteMachine,
  useInfrastructure,
  useInfrastructureSummary,
  usePlatformHealth,
  usePlatformSync,
  useRegisterMachine,
  useRegenerateEnrollmentCode,
  useRevokeAgentToken,
  useSendCommand,
  useSyncHistory,
} from '../hooks/api'
import { COMMANDS, RUNNER_TYPES } from '../lib/constants'
import { compactNumber, dateTime, heartbeatState, machineStatusColor, percent, relative } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  InfoTile,
  Input,
  Modal,
  Notice,
  ProgressBar,
  SectionTitle,
  Select,
  Skeleton,
  Switch,
  Textarea,
  Tooltip,
} from '../components/ui'

const EMPTY_STATS = {}

function MachineUsage({ value, icon: Icon, label }) {
  const usage = Number(value || 0)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <Icon className="h-3 w-3" aria-hidden />
          {label}
        </span>
        <span className="tabular-nums">{percent(usage, 0)}</span>
      </div>
      <ProgressBar value={usage} />
    </div>
  )
}

export default function InfrastructurePage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { has } = useAuth()

  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [commandTarget, setCommandTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [enrolment, setEnrolment] = useState(null)
  const [expanded, setExpanded] = useState(null)

  const machines = useInfrastructure({ include_deleted: includeDeleted })
  const summary = useInfrastructureSummary()
  const platformHealth = usePlatformHealth()
  const syncHistory = useSyncHistory()
  const agents = useConnectedAgents()
  const commands = useCommands({ limit: 50 })

  const register = useRegisterMachine()
  const sendCommand = useSendCommand()
  const regenerate = useRegenerateEnrollmentCode()
  const revoke = useRevokeAgentToken()
  const removeMachine = useDeleteMachine()
  const sync = usePlatformSync()

  const canWrite = has('infrastructure:write') || has('commands:write') || has('*')
  const rows = machines.data || []
  // `/api/platform/health` returns the configured provider (an object) — normalise
  const providers = Array.isArray(platformHealth.data) ? platformHealth.data : platformHealth.data ? [platformHealth.data] : []

  const stats = summary.data || EMPTY_STATS
  const tiles = useMemo(
    () => [
      { label: t('capacity.onlineRunners'), value: `${stats.online ?? 0} / ${stats.total ?? 0}`, tone: 'success' },
      { label: t('infra.statusValues.Offline'), value: stats.offline ?? 0, tone: 'neutral' },
      { label: t('infra.statusValues.Warning'), value: `${stats.warning ?? 0} · ${stats.critical ?? 0}`, tone: 'warning' },
      { label: t('infra.cpu'), value: percent(stats.avg_cpu || 0), tone: 'info' },
      { label: t('infra.ram'), value: percent(stats.avg_ram || 0), tone: 'info' },
      { label: t('infra.capacity'), value: `${compactNumber(stats.license_capacity || 0)} · ${agents.data?.agents?.length ?? agents.data?.count ?? '—'}`, tone: 'brand' },
    ],
    [stats, agents.data, t],
  )

  const onRegister = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const result = await register.mutateAsync({
        MachineName: form.get('MachineName'),
        AssignedBot: form.get('AssignedBot') || undefined,
        RunnerType: form.get('RunnerType'),
        TotalRAM_GB: Number(form.get('TotalRAM_GB')),
        TotalHDD_GB: Number(form.get('TotalHDD_GB')),
        Platform: 'generic_sql',
        RobotCapacity: Number(form.get('RobotCapacity') || 1),
      })
      setEnrolment(result)
      toast.success(t('infra.register'), result?.MachineName || String(form.get('MachineName')))
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onCommand = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const command = form.get('Command')
    try {
      await sendCommand.mutateAsync({
        machineName: commandTarget.MachineName,
        Command: command,
        ProcessName: form.get('ProcessName') || undefined,
        Reason: form.get('Reason') || undefined,
        TimeoutSeconds: Number(form.get('TimeoutSeconds') || 60),
      })
      toast.success(t('infra.sendCommand'), `${command} → ${commandTarget.MachineName}`)
      setCommandTarget(null)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onSync = async () => {
    try {
      const result = await sync.mutateAsync({ lookback_days: 7 })
      toast.success(t('infra.syncNow'), result?.message || undefined)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('infra.title')}
        subtitle={t('infra.subtitle')}
        actions={
          canWrite ? (
            <>
              <Button variant="secondary" icon={RefreshCw} loading={sync.isPending} onClick={onSync}>
                {t('infra.syncNow')}
              </Button>
              <Button icon={Server} onClick={() => setRegisterOpen(true)}>
                {t('infra.register')}
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <Card key={tile.label} className="p-3">
            <p className="text-[11px] text-muted">{tile.label}</p>
            <p className="mt-1 text-lg font-semibold text-text">{summary.isLoading && !summary.data ? <Skeleton className="h-6 w-12" /> : tile.value}</p>
          </Card>
        ))}
      </div>

      {/* ------------------------------------------------------- vendors */}
      <Card>
        <CardHeader
          title={t('infra.platformHealth')}
          subtitle={t('infra.platform')}
          icon={Plug}
          actions={
            <span className="text-[11px] text-muted">
              {t('infra.syncHistory')}: {(syncHistory.data || []).length}
            </span>
          }
        />
        <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {platformHealth.isLoading ? <Skeleton className="h-24 md:col-span-2 xl:col-span-3" /> : null}
          {!providers.length && !platformHealth.isLoading ? (
            <EmptyState title={t('infra.empty')} className="md:col-span-2 xl:col-span-3" />
          ) : null}
          {providers.map((provider) => (
            <motion.div key={provider.provider} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-surface-2/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-text">{provider.display_name || provider.provider}</p>
                <Badge tone={provider.ok ? 'success' : 'danger'} dot>
                  {provider.ok ? t('health.allGood') : t('health.problems')}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted">{provider.message}</p>
              <p className="mt-1 text-[11px] text-muted">
                {t('health.latency')}: {provider.latency_ms ?? '—'} ms
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(provider.capabilities || {})
                  .filter(([, enabled]) => enabled)
                  .map(([capability]) => (
                    <Badge key={capability} tone="neutral">
                      {capability.replace(/_/g, ' ')}
                    </Badge>
                  ))}
              </div>
            </motion.div>
          ))}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------ machines */}
      <Card>
        <CardHeader
          title={t('infra.title')}
          subtitle={`${rows.length} · ${t('health.agents')}: ${agents.data?.count ?? agents.data?.agents?.length ?? '—'}`}
          icon={Cpu}
          actions={<Switch checked={includeDeleted} onChange={setIncludeDeleted} label={t('actions.showMore')} />}
        />
        <DataTable
          loading={machines.isLoading}
          rows={rows}
          rowKey={(row) => row.MachineID}
          empty={<EmptyState icon={Server} title={t('infra.empty')} description={t('infra.registerHint')} />}
          onRowClick={(row) => setExpanded(expanded === row.MachineID ? null : row.MachineID)}
          columns={[
            {
              key: 'MachineName',
              header: t('infra.machine'),
              sortable: true,
              render: (row) => {
                const beat = heartbeatState(row.LastPing)
                return (
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: machineStatusColor(row.Status) }} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text">{row.MachineName}</p>
                      <p className="truncate text-[11px] text-muted">
                        {row.AssignedBot || row.AssignedProcess || '—'} · {row.RunnerType}
                      </p>
                    </div>
                    {row.IsStale ? <Badge tone="danger">{t('app.offline')}</Badge> : null}
                    {beat.seconds !== null && beat.seconds > 300 ? null : null}
                  </div>
                )
              },
            },
            {
              key: 'HealthStatus',
              header: t('infra.status'),
              render: (row) => (
                <Badge tone={row.IsOnline ? (row.HealthStatus === 'Warning' ? 'warning' : 'success') : 'danger'} dot>
                  {row.HealthStatus || (row.IsOnline ? t('infra.statusValues.Online') : t('infra.statusValues.Offline'))}
                </Badge>
              ),
            },
            {
              key: 'CPU_Usage',
              header: t('infra.cpu'),
              width: 150,
              render: (row) => <MachineUsage value={row.CPU_Usage} icon={Cpu} label="CPU" />,
            },
            {
              key: 'RAM_Usage',
              header: t('infra.ram'),
              width: 150,
              render: (row) => <MachineUsage value={row.RAM_Usage} icon={ServerCog} label="RAM" />,
            },
            {
              key: 'HDD_Usage',
              header: t('infra.hdd'),
              width: 150,
              render: (row) => <MachineUsage value={row.HDD_Usage} icon={HardDrive} label="HDD" />,
            },
            {
              key: 'LastPing',
              header: t('infra.lastPing'),
              render: (row) => (
                <Tooltip content={dateTime(row.LastPing)}>
                  <span className={`text-xs ${row.IsStale ? 'text-danger' : 'text-muted'}`}>{relative(row.LastPing)}</span>
                </Tooltip>
              ),
            },
            { key: 'LastIP', header: t('infra.ip'), render: (row) => <span className="font-mono text-xs">{row.LastIP || '—'}</span> },
            { key: 'OSName', header: 'OS', render: (row) => <span className="text-xs text-muted">{row.OSName || '—'}</span> },
            {
              key: 'actions',
              header: '',
              align: 'end',
              render: (row) =>
                canWrite ? (
                  <div className="flex items-center justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setCommandTarget(row)} aria-label={t('infra.sendCommand')} title={t('infra.sendCommand')}>
                      <Terminal className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          const result = await regenerate.mutateAsync(row.MachineName)
                          setEnrolment(result)
                          toast.success(t('infra.enrollmentCode'))
                        } catch (error) {
                          toast.error(t('errors.title'), error.message)
                        }
                      }}
                      aria-label={t('infra.regenerate')}
                      title={t('infra.regenerate')}
                    >
                      <Wifi className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await revoke.mutateAsync(row.MachineName)
                          toast.success(t('infra.revoke'), row.MachineName)
                        } catch (error) {
                          toast.error(t('errors.title'), error.message)
                        }
                      }}
                      aria-label={t('infra.revoke')}
                      title={t('infra.revoke')}
                    >
                      <ShieldOff className="h-3.5 w-3.5 text-warning" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(row)} aria-label={t('actions.delete')} title={t('actions.delete')}>
                      <ShieldOff className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </div>
                ) : null,
            },
          ]}
        />

        {expanded ? (
          <div className="border-t border-border p-4">
            {(() => {
              const row = rows.find((item) => item.MachineID === expanded)
              if (!row) return null
              return (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                  <InfoTile label={t('infra.capacity')} value={row.RobotCapacity ?? '—'} />
                  <InfoTile label={t('infra.platform')} value={row.Platform || '—'} />
                  <InfoTile label="RAM" value={row.TotalRAM_GB ? `${row.TotalRAM_GB} GB` : '—'} />
                  <InfoTile label="HDD" value={row.TotalHDD_GB ? `${row.TotalHDD_GB} GB` : '—'} />
                  <InfoTile label="Agent" value={row.AgentVersion || '—'} />
                  <InfoTile label={t('infra.lastPing')} value={dateTime(row.LastPing)} />
                </div>
              )
            })()}
          </div>
        ) : null}
      </Card>

      {/* ------------------------------------------------------ commands */}
      <Card>
        <CardHeader title={t('infra.commandHistory')} subtitle={t('infra.commands')} icon={Activity} />
        <DataTable
          loading={commands.isLoading}
          rows={commands.data || []}
          rowKey={(row) => row.CommandID}
          dense
          empty={<EmptyState title={t('dashboard.empty.table')} className="py-8" />}
          columns={[
            { key: 'CommandID', header: '#', render: (row) => <span className="font-mono text-xs">{row.CommandID}</span> },
            { key: 'MachineName', header: t('infra.machine') },
            { key: 'Command', header: t('infra.commands'), render: (row) => <Badge tone="info">{row.Command}</Badge> },
            { key: 'Status', header: t('infra.status'), render: (row) => <Badge tone={row.Status === 'Acknowledged' ? 'success' : row.Status === 'Failed' ? 'danger' : 'neutral'}>{row.Status}</Badge> },
            { key: 'IssuedAt', header: t('runs.started'), render: (row) => <span className="text-xs text-muted">{relative(row.IssuedAt)}</span> },
            { key: 'IssuedBy', header: t('audit.who'), render: (row) => <span className="text-xs">{row.IssuedBy || '—'}</span> },
            { key: 'Result', header: t('audit.details'), render: (row) => <span className="block max-w-[16rem] truncate text-xs text-muted">{row.Result || row.Error || '—'}</span> },
          ]}
        />
      </Card>

      {/* ------------------------------------------------------ register */}
      <Modal open={registerOpen} onClose={() => setRegisterOpen(false)} title={t('infra.register')} description={t('infra.registerHint')} size="md">
        <form onSubmit={onRegister} className="grid gap-3 sm:grid-cols-2">
          <Field label={t('infra.machine')} required>
            <Input name="MachineName" required placeholder="Bot-07" />
          </Field>
          <Field label={t('infra.assignedProcess')}>
            <Input name="AssignedBot" placeholder="Invoice_Processing" />
          </Field>
          <Field label={t('infra.runnerType')} required>
            <Select name="RunnerType" defaultValue="Unattended" required>
              {RUNNER_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('infra.capacity')}>
            <Input name="RobotCapacity" type="number" min="1" max="10" defaultValue={1} />
          </Field>
          <Field label="RAM (GB)" required>
            <Input name="TotalRAM_GB" type="number" min="1" step="1" defaultValue={16} required />
          </Field>
          <Field label="HDD (GB)" required>
            <Input name="TotalHDD_GB" type="number" min="1" step="1" defaultValue={256} required />
          </Field>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setRegisterOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={register.isPending}>
              {t('infra.register')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------ enrolment code */}
      <Modal
        open={Boolean(enrolment)}
        onClose={() => setEnrolment(null)}
        title={t('infra.enrollmentCode')}
        description={t('infra.registerHint')}
        size="sm"
        footer={
          <Button variant="primary" onClick={() => setEnrolment(null)}>
            {t('actions.close')}
          </Button>
        }
      >
        {enrolment ? (
          <div className="space-y-3">
            <Notice tone="info">
              {t('infra.machine')}: <strong>{enrolment.MachineName}</strong>
            </Notice>
            <div className="rounded-xl border border-border bg-surface-2 p-3 text-center">
              <p className="font-mono text-2xl tracking-widest text-text">{enrolment.EnrollmentCode || enrolment.enrollment_code}</p>
              <p className="mt-1 text-[11px] text-muted">
                {t('health.lastRun')}: {enrolment.ExpiresAt || enrolment.expires_at ? dateTime(enrolment.ExpiresAt || enrolment.expires_at) : '—'}
              </p>
            </div>
            <p className="text-[11px] text-muted">
              POST /api/agent/enroll → {`{ "MachineName": "...", "EnrollmentCode": "..." }`}
            </p>
          </div>
        ) : null}
      </Modal>

      {/* -------------------------------------------------- run a command */}
      <Modal open={Boolean(commandTarget)} onClose={() => setCommandTarget(null)} title={t('infra.sendCommand')} description={commandTarget?.MachineName} size="sm">
        {commandTarget ? (
          <form onSubmit={onCommand} className="space-y-3">
            <Field label={t('infra.commands')} required>
              <Select name="Command" defaultValue="PING" required>
                {COMMANDS.map((command) => (
                  <option key={command.value} value={command.value}>
                    {t(command.labelKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('processes.process')} hint={t('infra.commandValues.RUN_BOT')}>
              <Input name="ProcessName" />
            </Field>
            <Field label="Timeout (seconds)">
              <Input name="TimeoutSeconds" type="number" min="5" max="600" defaultValue={60} />
            </Field>
            <Field label={t('lifecycle.riskNotes')}>
              <Textarea name="Reason" rows={2} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setCommandTarget(null)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={sendCommand.isPending} icon={Terminal}>
                {t('infra.sendCommand')}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          try {
            await removeMachine.mutateAsync(deleteTarget.MachineName)
            toast.success(t('actions.delete'), deleteTarget.MachineName)
            setDeleteTarget(null)
          } catch (error) {
            toast.error(t('errors.title'), error.message)
          }
        }}
        loading={removeMachine.isPending}
        title={t('actions.delete')}
        message={`${deleteTarget?.MachineName || ''} — ${t('processes.deleteConfirm')}`}
        confirmLabel={t('actions.delete')}
      />
    </div>
  )
}
