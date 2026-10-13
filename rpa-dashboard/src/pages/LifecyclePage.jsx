import { BadgeCheck, Boxes, GitBranch, KeyRound, Lock, Plus, Rocket, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import {
  useAddCredential,
  useApprovals,
  useCreateVersion,
  useCredentials,
  useDecideApproval,
  useDeleteCredential,
  useLifecycleOverview,
  useProcessOptions,
  usePromoteVersion,
  useRequestApproval,
  useRevealCredential,
  useRollbackVersion,
  useRotateVaultKey,
  useVaultStats,
  useVersions,
} from '../hooks/api'
import { ENVIRONMENTS } from '../lib/constants'
import { dateTime, relative } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  InfoTile,
  Input,
  Modal,
  Notice,
  SectionTitle,
  Select,
  Tabs,
  Textarea,
  Tooltip,
} from '../components/ui'

const ENV_TONE = { Production: 'success', UAT: 'info', Development: 'neutral', Retired: 'warning' }

export default function LifecyclePage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { has, user } = useAuth()

  const [tab, setTab] = useState('versions')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [createOpen, setCreateOpen] = useState(false)
  const [promoteTarget, setPromoteTarget] = useState(null)
  const [rollbackTarget, setRollbackTarget] = useState(null)
  const [approvalTarget, setApprovalTarget] = useState(null)
  const [vaultTarget, setVaultTarget] = useState(null)
  const [revealed, setRevealed] = useState(null)
  const [decision, setDecision] = useState({ target: null, approved: true })

  const versions = useVersions()
  const overview = useLifecycleOverview()
  const approvals = useApprovals(statusFilter === 'ALL' ? undefined : statusFilter)
  const credentials = useCredentials(vaultTarget?.VersionID)
  const vaultStats = useVaultStats()
  const processes = useProcessOptions()

  const createVersion = useCreateVersion()
  const promote = usePromoteVersion()
  const rollback = useRollbackVersion()
  const requestApproval = useRequestApproval()
  const decideApproval = useDecideApproval()
  const addCredential = useAddCredential()
  const revealCredential = useRevealCredential()
  const deleteCredential = useDeleteCredential()
  const rotateKey = useRotateVaultKey()

  const canGovern = has('lifecycle:write') || has('*')
  const isSuperAdmin = has('*') || user?.role === 'SuperAdmin'

  const counts = overview.data?.counts || {}
  const versionRows = useMemo(() => {
    const rows = versions.data || []
    return statusFilter === 'ALL' ? rows : rows.filter((row) => row.CurrentStatus === statusFilter)
  }, [versions.data, statusFilter])

  const onCreateVersion = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const result = await createVersion.mutateAsync({
        ProcessName: form.get('ProcessName'),
        VersionTag: form.get('VersionTag'),
        TargetMachineName: form.get('TargetMachineName') || undefined,
        Description: form.get('Description') || undefined,
        ArtifactUrl: form.get('ArtifactUrl') || undefined,
      })
      toast.success(t('lifecycle.versions'), result?.VersionTag || String(form.get('VersionTag')))
      setCreateOpen(false)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onPromote = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const result = await promote.mutateAsync({
        versionId: promoteTarget.VersionID,
        TargetEnvironment: form.get('TargetEnvironment'),
        Comment: form.get('Comment') || undefined,
        Force: form.get('Force') === 'on',
      })
      toast.success(
        result?.requires_approval ? t('lifecycle.workflow.fourEyes') : t('lifecycle.promote'),
        promoteTarget.VersionTag,
      )
      setPromoteTarget(null)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onRollback = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await rollback.mutateAsync({
        ProcessName: rollbackTarget.ProcessName,
        ToVersionID: Number(form.get('ToVersionID')),
        Reason: form.get('Reason'),
      })
      toast.success(t('lifecycle.rollback'), rollbackTarget.ProcessName)
      setRollbackTarget(null)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('lifecycle.title')}
        subtitle={t('lifecycle.subtitle')}
        actions={
          canGovern ? (
            <>
              <Button variant="secondary" icon={ShieldCheck} onClick={() => setApprovalTarget('new')}>
                {t('lifecycle.approvals')}
              </Button>
              <Button icon={Plus} onClick={() => setCreateOpen(true)}>
                {t('lifecycle.versions')}
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {ENVIRONMENTS.map((environment) => (
          <Card key={environment} className="p-3">
            <p className="text-[11px] text-muted">{t(`lifecycle.env.${environment}`)}</p>
            <p className="mt-1 text-lg font-semibold text-text">{counts[`${environment}Count`] ?? 0}</p>
          </Card>
        ))}
        <Card className="p-3">
          <p className="text-[11px] text-muted">{t('lifecycle.pendingApprovals')}</p>
          <p className="mt-1 text-lg font-semibold text-warning">{counts.PendingApprovals ?? 0}</p>
        </Card>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'versions', label: t('lifecycle.versions'), icon: Boxes, count: counts.TotalCount },
          { value: 'approvals', label: t('lifecycle.approvals'), icon: BadgeCheck, count: counts.PendingApprovals },
          { value: 'vault', label: t('lifecycle.vault'), icon: Lock, count: vaultStats.data?.total_credentials },
        ]}
      />

      {tab === 'versions' ? (
        <>
          <Card>
            <CardHeader
              title={t('lifecycle.versions')}
              subtitle={t('lifecycle.workflow.fourEyes')}
              icon={GitBranch}
              actions={
                <Select className="h-8 w-40 py-0 text-xs" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="ALL">{t('dashboard.filters.all')}</option>
                  {ENVIRONMENTS.map((environment) => (
                    <option key={environment} value={environment}>
                      {t(`lifecycle.env.${environment}`)}
                    </option>
                  ))}
                </Select>
              }
            />
            <DataTable
              loading={versions.isLoading}
              rows={versionRows}
              rowKey={(row) => row.VersionID}
              empty={<EmptyState icon={Boxes} title={t('dashboard.empty.table')} />}
              columns={[
                {
                  key: 'ProcessName',
                  header: t('processes.process'),
                  sortable: true,
                  render: (row) => (
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text">{row.ProcessName}</p>
                      <p className="truncate text-[11px] text-muted">{row.TargetMachineName || '—'}</p>
                    </div>
                  ),
                },
                { key: 'VersionTag', header: t('lifecycle.versionTag'), render: (row) => <span className="font-mono text-xs">{row.VersionTag}</span> },
                {
                  key: 'CurrentStatus',
                  header: t('lifecycle.currentStatus'),
                  sortable: true,
                  render: (row) => <Badge tone={ENV_TONE[row.CurrentStatus] || 'neutral'} dot>{t(`lifecycle.env.${row.CurrentStatus}`)}</Badge>,
                },
                { key: 'CreatorName', header: t('lifecycle.requestedBy'), render: (row) => <span className="text-xs">{row.CreatorName || row.CreatedBy || '—'}</span> },
                { key: 'CreatedAt', header: t('lifecycle.createdAt'), render: (row) => <span className="text-xs text-muted">{relative(row.CreatedAt)}</span> },
                { key: 'LastPromotedAt', header: t('lifecycle.history'), render: (row) => <span className="text-xs text-muted">{row.LastPromotedAt ? relative(row.LastPromotedAt) : '—'}</span> },
                {
                  key: 'CredentialsCount',
                  header: t('lifecycle.vault'),
                  align: 'center',
                  render: (row) => (
                    <Button size="sm" variant="ghost" onClick={() => setVaultTarget(row)}>
                      <KeyRound className="h-3.5 w-3.5" /> {row.CredentialsCount ?? 0}
                    </Button>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'end',
                  render: (row) =>
                    canGovern ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" icon={Rocket} onClick={() => setPromoteTarget(row)}>
                          {t('lifecycle.promote')}
                        </Button>
                        <Tooltip content={t('lifecycle.rollbackReason')}>
                          <Button size="icon" variant="ghost" onClick={() => setRollbackTarget(row)} aria-label={t('lifecycle.rollback')}>
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                      </div>
                    ) : null,
                },
              ]}
            />
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('lifecycle.liveDeployments')} icon={Rocket} />
              <CardBody className="space-y-2">
                {(overview.data?.live_deployments || []).map((row) => (
                  <div key={`${row.ProcessName}-${row.VersionTag}`} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2/60 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text">{row.ProcessName}</p>
                      <p className="font-mono text-[11px] text-muted">{row.VersionTag}</p>
                    </div>
                    <div className="text-end">
                      <Badge tone={ENV_TONE[row.CurrentStatus] || 'neutral'}>{row.CurrentStatus}</Badge>
                      <p className="mt-1 text-[11px] text-muted">{row.LastPromotedAt ? relative(row.LastPromotedAt) : t('common.never')}</p>
                    </div>
                  </div>
                ))}
                {!(overview.data?.live_deployments || []).length ? <EmptyState title={t('dashboard.empty.table')} className="py-6" /> : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t('lifecycle.history')} icon={GitBranch} />
              <CardBody className="space-y-2">
                {(overview.data?.recent_promotions || []).length ? (
                  (overview.data.recent_promotions || []).map((row, index) => (
                    <div key={`${row.ProcessName}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-text">
                        {row.ProcessName} → {row.TargetEnvironment || row.CurrentStatus}
                      </span>
                      <span className="text-muted">{row.PromotedAt ? relative(row.PromotedAt) : '—'}</span>
                    </div>
                  ))
                ) : (
                  <EmptyState title={t('dashboard.empty.table')} className="py-6" />
                )}
              </CardBody>
            </Card>
          </div>
        </>
      ) : null}

      {tab === 'approvals' ? (
        <Card>
          <CardHeader
            title={t('lifecycle.approvals')}
            subtitle={t('lifecycle.workflow.fourEyes')}
            icon={BadgeCheck}
            actions={
              <Select className="h-8 w-40 py-0 text-xs" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="ALL">{t('dashboard.filters.all')}</option>
                {['Pending', 'Approved', 'Rejected'].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            }
          />
          <DataTable
            loading={approvals.isLoading}
            rows={approvals.data || []}
            rowKey={(row) => row.ApprovalID}
            empty={<EmptyState title={t('dashboard.empty.table')} className="py-8" />}
            columns={[
              {
                key: 'ProcessName',
                header: t('processes.process'),
                render: (row) => (
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text">{row.ProcessName}</p>
                    <p className="font-mono text-[11px] text-muted">{row.VersionTag}</p>
                  </div>
                ),
              },
              { key: 'TargetEnvironment', header: t('lifecycle.currentStatus'), render: (row) => <Badge tone={ENV_TONE[row.TargetEnvironment] || 'neutral'}>{row.TargetEnvironment}</Badge> },
              { key: 'RequestedByName', header: t('lifecycle.requestedBy'), render: (row) => <span className="text-xs">{row.RequestedByName || row.RequestedBy}</span> },
              { key: 'RequestedAt', header: t('audit.when'), render: (row) => <span className="text-xs text-muted">{relative(row.RequestedAt)}</span> },
              { key: 'RiskNotes', header: t('lifecycle.riskNotes'), render: (row) => <span className="block max-w-[16rem] truncate text-xs text-muted">{row.RiskNotes || row.Comment || '—'}</span> },
              {
                key: 'Status',
                header: t('capacity.status'),
                render: (row) => <Badge tone={row.Status === 'Approved' ? 'success' : row.Status === 'Rejected' ? 'danger' : 'warning'}>{row.Status}</Badge>,
              },
              {
                key: 'actions',
                header: '',
                align: 'end',
                render: (row) =>
                  canGovern && row.Status === 'Pending' ? (
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="success" loading={decideApproval.isPending} onClick={() => setDecision({ target: row, approved: true })}>
                        {t('actions.approve')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDecision({ target: row, approved: false })}>
                        {t('actions.reject')}
                      </Button>
                    </div>
                  ) : row.ApprovedByName ? (
                    <span className="text-[11px] text-muted">{row.ApprovedByName}</span>
                  ) : null,
              },
            ]}
          />
        </Card>
      ) : null}

      {tab === 'vault' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title={t('lifecycle.vault')} subtitle={t('lifecycle.subtitle')} icon={Lock} />
            <CardBody>
              {vaultTarget ? (
                <>
                  <div className="mb-3 flex flex-wrap items-end gap-3">
                    <Field label={t('lifecycle.versions')}>
                      <Select className="h-9 min-w-[16rem] py-0 text-xs" value={vaultTarget.VersionID} onChange={(event) => setVaultTarget(versions.data.find((row) => String(row.VersionID) === event.target.value) || null)}>
                        {(versions.data || []).map((row) => (
                          <option key={row.VersionID} value={row.VersionID}>
                            {row.ProcessName} · {row.VersionTag} ({row.CurrentStatus})
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button
                      size="sm"
                      icon={Plus}
                      onClick={() => setVaultTarget({ ...vaultTarget, addOpen: true })}
                    >
                      {t('lifecycle.storeCredential')}
                    </Button>
                  </div>
                  <DataTable
                    loading={credentials.isLoading}
                    rows={credentials.data || []}
                    dense
                    rowKey={(row) => row.VaultID}
                    empty={<EmptyState title={t('dashboard.empty.table')} className="py-6" />}
                    columns={[
                      { key: 'CredentialName', header: t('lifecycle.credential'), render: (row) => <span className="text-xs font-medium">{row.CredentialName}</span> },
                      { key: 'Environment', header: t('lifecycle.environment'), render: (row) => <Badge tone={ENV_TONE[row.Environment] || 'neutral'}>{row.Environment}</Badge> },
                      { key: 'KeyVersion', header: 'Key', render: (row) => <span className="font-mono text-[11px]">v{row.KeyVersion}</span> },
                      { key: 'AccessCount', header: t('lifecycle.reveal'), align: 'center', render: (row) => <span className="text-xs">{row.AccessCount ?? 0}</span> },
                      { key: 'LastAccessedAt', header: t('lifecycle.lastAccessed'), render: (row) => <span className="text-xs text-muted">{row.LastAccessedAt ? relative(row.LastAccessedAt) : t('common.never')}</span> },
                      { key: 'CreatedAt', header: t('lifecycle.createdAt'), render: (row) => <span className="text-xs text-muted">{dateTime(row.CreatedAt)}</span> },
                      {
                        key: 'actions',
                        header: '',
                        align: 'end',
                        render: (row) => (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setRevealed({ vault: row, versionId: vaultTarget.VersionID })}>
                              {t('lifecycle.reveal')}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={async () => {
                                try {
                                  await deleteCredential.mutateAsync(row.VaultID)
                                  toast.success(t('actions.delete'), row.CredentialName)
                                } catch (error) {
                                  toast.error(t('errors.title'), error.message)
                                }
                              }}
                              aria-label={t('actions.delete')}
                            >
                              <RotateCcw className="h-3.5 w-3.5 text-danger" />
                            </Button>
                          </div>
                        ),
                      },
                    ]}
                  />
                </>
              ) : (
                <EmptyState title={t('lifecycle.vault')} description={t('lifecycle.storeCredential')} action={<Button variant="secondary" onClick={() => setVaultTarget((versions.data || [])[0] || null)}>{t('actions.showMore')}</Button>} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('lifecycle.vault')} icon={KeyRound} />
            <CardBody className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <InfoTile label={t('lifecycle.vault')} value={vaultStats.data?.total_credentials ?? 0} />
                <InfoTile label={t('lifecycle.reveal')} value={vaultStats.data?.total_reads ?? 0} />
                <InfoTile label={t('lifecycle.env.Production')} value={vaultStats.data?.production_credentials ?? 0} tone="success" />
                <InfoTile label={t('common.never')} value={vaultStats.data?.never_accessed ?? 0} tone="warning" />
              </div>
              <Notice tone="warning" title={t('lifecycle.rotation')}>
                {t('lifecycle.revealReason')}
              </Notice>
              {isSuperAdmin ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    loading={rotateKey.isPending}
                    onClick={async () => {
                      try {
                        const result = await rotateKey.mutateAsync(true)
                        toast.success(t('lifecycle.rotationDryRun'), JSON.stringify(result?.affected ?? result))
                      } catch (error) {
                        toast.error(t('errors.title'), error.message)
                      }
                    }}
                  >
                    {t('lifecycle.rotationDryRun')}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      try {
                        const result = await rotateKey.mutateAsync(false)
                        toast.success(t('lifecycle.rotation'), JSON.stringify(result?.affected ?? result))
                      } catch (error) {
                        toast.error(t('errors.title'), error.message)
                      }
                    }}
                  >
                    {t('lifecycle.rotation')}
                  </Button>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* ------------------------------------------------- create version */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('lifecycle.versions')} description={t('lifecycle.subtitle')} size="md">
        <form onSubmit={onCreateVersion} className="grid gap-3 sm:grid-cols-2">
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
          <Field label={t('lifecycle.versionTag')} required>
            <Input name="VersionTag" required placeholder="v1.2.0" />
          </Field>
          <Field label={t('runs.machine')}>
            <Input name="TargetMachineName" placeholder="Bot-01" />
          </Field>
          <Field label="Artifact URL">
            <Input name="ArtifactUrl" placeholder="\\fileshare\\bots\\v1.2.0.nupkg" />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('lifecycle.riskNotes')}>
              <Textarea name="Description" rows={3} />
            </Field>
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setCreateOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={createVersion.isPending}>
              {t('actions.create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* -------------------------------------------------------- promote */}
      <Modal open={Boolean(promoteTarget)} onClose={() => setPromoteTarget(null)} title={t('lifecycle.promote')} description={promoteTarget ? `${promoteTarget.ProcessName} · ${promoteTarget.VersionTag}` : ''} size="sm">
        {promoteTarget ? (
          <form onSubmit={onPromote} className="space-y-3">
            <Field label={t('lifecycle.environment')} required>
              <Select name="TargetEnvironment" defaultValue="UAT" required>
                {ENVIRONMENTS.filter((environment) => environment !== 'Retired').map((environment) => (
                  <option key={environment} value={environment}>
                    {t(`lifecycle.env.${environment}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('lifecycle.riskNotes')}>
              <Textarea name="Comment" rows={3} />
            </Field>
            {isSuperAdmin ? (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" name="Force" className="h-4 w-4 rounded border-border" />
                {t('lifecycle.workflow.breakGlass')}
              </label>
            ) : null}
            <Notice tone="info">{t('lifecycle.workflow.fourEyes')}</Notice>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setPromoteTarget(null)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={promote.isPending} icon={Rocket}>
                {t('lifecycle.promote')}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* ------------------------------------------------------- rollback */}
      <Modal open={Boolean(rollbackTarget)} onClose={() => setRollbackTarget(null)} title={t('lifecycle.rollback')} description={rollbackTarget?.ProcessName} size="sm">
        {rollbackTarget ? (
          <form onSubmit={onRollback} className="space-y-3">
            <Field label={t('lifecycle.versions')} required>
              <Select name="ToVersionID" required defaultValue="">
                <option value="" disabled>
                  —
                </option>
                {(versions.data || [])
                  .filter((row) => row.ProcessName === rollbackTarget.ProcessName && row.VersionID !== rollbackTarget.VersionID)
                  .map((row) => (
                    <option key={row.VersionID} value={row.VersionID}>
                      {row.VersionTag} ({row.CurrentStatus})
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('lifecycle.rollbackReason')} required>
              <Textarea name="Reason" rows={3} required />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setRollbackTarget(null)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" variant="danger" loading={rollback.isPending} icon={Undo2}>
                {t('lifecycle.rollback')}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* --------------------------------------------- request an approval */}
      <Modal open={approvalTarget === 'new'} onClose={() => setApprovalTarget(null)} title={t('lifecycle.approvals')} description={t('lifecycle.workflow.fourEyes')} size="sm">
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            try {
              await requestApproval.mutateAsync({
                VersionID: Number(form.get('VersionID')),
                TargetEnvironment: form.get('TargetEnvironment'),
                Comment: form.get('Comment') || undefined,
                RiskNotes: form.get('RiskNotes') || undefined,
              })
              toast.success(t('lifecycle.approvals'))
              setApprovalTarget(null)
            } catch (error) {
              toast.error(t('errors.title'), error.message)
            }
          }}
          className="space-y-3"
        >
          <Field label={t('lifecycle.versions')} required>
            <Select name="VersionID" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {(versions.data || []).map((row) => (
                <option key={row.VersionID} value={row.VersionID}>
                  {row.ProcessName} · {row.VersionTag} ({row.CurrentStatus})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('lifecycle.environment')} required>
            <Select name="TargetEnvironment" defaultValue="Production" required>
              {['UAT', 'Production'].map((environment) => (
                <option key={environment} value={environment}>
                  {t(`lifecycle.env.${environment}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('lifecycle.riskNotes')}>
            <Textarea name="RiskNotes" rows={3} />
          </Field>
          <Field label={t('lifecycle.revealReason')}>
            <Textarea name="Comment" rows={2} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setApprovalTarget(null)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={requestApproval.isPending}>
              {t('actions.create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ---------------------------------------------------- decide modal */}
      <Modal
        open={Boolean(decision.target)}
        onClose={() => setDecision({ target: null, approved: true })}
        title={decision.approved ? t('actions.approve') : t('actions.reject')}
        description={decision.target ? `${decision.target.ProcessName} → ${decision.target.TargetEnvironment}` : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision({ target: null, approved: true })}>
              {t('actions.cancel')}
            </Button>
            <Button
              variant={decision.approved ? 'success' : 'danger'}
              loading={decideApproval.isPending}
              onClick={async () => {
                try {
                  await decideApproval.mutateAsync({
                    approvalId: decision.target.ApprovalID,
                    approved: decision.approved,
                    comment: decision.comment,
                  })
                  toast.success(decision.approved ? t('actions.approve') : t('actions.reject'), decision.target.ProcessName)
                  setDecision({ target: null, approved: true, comment: '' })
                } catch (error) {
                  toast.error(t('errors.title'), error.message)
                }
              }}
            >
              {decision.approved ? t('actions.approve') : t('actions.reject')}
            </Button>
          </>
        }
      >
        <Field label={t('lifecycle.riskNotes')}>
          <Textarea value={decision.comment || ''} onChange={(event) => setDecision({ ...decision, comment: event.target.value })} rows={3} />
        </Field>
      </Modal>

      {/* ------------------------------------------------------ add secret */}
      <Modal
        open={Boolean(vaultTarget?.addOpen)}
        onClose={() => setVaultTarget({ ...vaultTarget, addOpen: false })}
        title={t('lifecycle.storeCredential')}
        description={vaultTarget ? `${vaultTarget.ProcessName} · ${vaultTarget.VersionTag}` : ''}
        size="sm"
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            try {
              await addCredential.mutateAsync({
                versionId: vaultTarget.VersionID,
                CredentialName: form.get('CredentialName'),
                Environment: form.get('Environment'),
                Value: form.get('Value'),
              })
              toast.success(t('lifecycle.storeCredential'))
              setVaultTarget({ ...vaultTarget, addOpen: false })
            } catch (error) {
              toast.error(t('errors.title'), error.message)
            }
          }}
          className="space-y-3"
        >
          <Field label={t('lifecycle.credential')} required>
            <Input name="CredentialName" required placeholder="SAP_LOGIN" />
          </Field>
          <Field label={t('lifecycle.environment')} required>
            <Select name="Environment" defaultValue="UAT" required>
              {ENVIRONMENTS.filter((environment) => environment !== 'Retired').map((environment) => (
                <option key={environment} value={environment}>
                  {t(`lifecycle.env.${environment}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('lifecycle.vault')} required hint="Encrypted with the tenant key; never logged.">
            <Input name="Value" type="password" required autoComplete="new-password" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setVaultTarget({ ...vaultTarget, addOpen: false })}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={addCredential.isPending} icon={Lock}>
              {t('actions.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ---------------------------------------------------------- reveal */}
      <Modal open={Boolean(revealed)} onClose={() => setRevealed(null)} title={t('lifecycle.reveal')} description={revealed?.vault?.CredentialName} size="sm">
        {revealed ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              try {
                const result = await revealCredential.mutateAsync({
                  versionId: revealed.versionId,
                  vaultId: revealed.vault.VaultID,
                  reason: form.get('Reason'),
                })
                setRevealed({ ...revealed, value: result?.value || result?.Value })
                toast.success(t('lifecycle.revealed'))
              } catch (error) {
                toast.error(t('errors.title'), error.message)
              }
            }}
            className="space-y-3"
          >
            <Notice tone="warning" title={t('lifecycle.revealReason')}>
              {t('audit.subtitle')}
            </Notice>
            <Field label={t('lifecycle.revealReason')} required>
              <Textarea name="Reason" rows={2} required />
            </Field>
            {revealed.value ? (
              <div className="rounded-xl border border-border bg-surface-2 p-3">
                <p className="break-all font-mono text-sm text-text">{revealed.value}</p>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setRevealed(null)}>
                {t('actions.close')}
              </Button>
              <Button type="submit" loading={revealCredential.isPending} icon={KeyRound}>
                {t('lifecycle.reveal')}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  )
}
