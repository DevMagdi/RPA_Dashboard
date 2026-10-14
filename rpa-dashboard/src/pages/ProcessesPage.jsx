import { LayoutGrid, List, Pencil, Power, Search, Trash2, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import {
  useDeleteProcess,
  useDepartments,
  useProcesses,
  useRoiSummary,
  useSetProcessActive,
  useUpdateRoi,
  useUpdateSla,
} from '../hooks/api'
import { useDebouncedValue, usePersistentState } from '../hooks/ui'
import { markOnboardingStep } from '../lib/onboarding'
import { compactNumber, currency, percent } from '../lib/format'
import ExportMenu from '../components/features/ExportMenu'
import ProcessCard from '../components/processes/ProcessCard'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  SectionTitle,
  Select,
  SegmentedControl,
  Skeleton,
  Switch,
  ErrorState,
} from '../components/ui'

const DEFAULT_PAGE_SIZE = 25

const CRITICALITY_TONE = { Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral' }

export default function ProcessesPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { has } = useAuth()
  const [searchParams] = useSearchParams()
  const processQuery = searchParams.get('process') || ''

  const [search, setSearch] = useState(processQuery)
  const [department, setDepartment] = useState('ALL')
  const [includeInactive, setIncludeInactive] = useState(true)
  const [viewMode, setViewMode] = usePersistentState('processes.view', 'table')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [sort, setSort] = useState({ key: 'ProcessName', dir: 'asc' })
  const [roiTarget, setRoiTarget] = useState(null)
  const [slaTarget, setSlaTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const debounced = useDebouncedValue(search)
  const filters = useMemo(
    () => ({
      search: debounced || undefined,
      department: department === 'ALL' ? undefined : department,
      include_inactive: includeInactive,
      // Offset paging: the API answers with `items` + `total`, so the page
      // numbers and the rows-per-page selector stay in sync with the server.
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sort_by: sort.key,
      sort_dir: sort.dir,
    }),
    [debounced, department, includeInactive, page, pageSize, sort],
  )

  const processes = useProcesses(filters)
  const roi = useRoiSummary({ days: 30 })
  const departments = useDepartments()

  const setActive = useSetProcessActive()
  const remove = useDeleteProcess()
  const updateRoi = useUpdateRoi()
  const updateSla = useUpdateSla()

  const canWrite = has('processes:write') || has('*')

  const roiByProcess = useMemo(() => {
    const map = new Map()
    ;(roi.data || []).forEach((row) => map.set(row.process_name || row.ProcessName, row))
    return map
  }, [roi.data])

  const rows = processes.data?.items || []
  const total = processes.data?.total || 0

  const toggleActive = async (row) => {
    try {
      await setActive.mutateAsync({ name: row.ProcessName, isActive: !row.IsActive })
      toast.success(row.IsActive ? t('processes.deactivate') : t('processes.activate'), row.ProcessName)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const confirmDelete = async () => {
    try {
      await remove.mutateAsync(deleteTarget.ProcessName)
      toast.success(t('actions.delete'), deleteTarget.ProcessName)
      setDeleteTarget(null)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const saveRoi = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await updateRoi.mutateAsync({
        ProcessName: roiTarget.ProcessName,
        EmpMinutesPerRequest: Number(form.get('EmpMinutesPerRequest')),
        EmpCostPerRequest: Number(form.get('EmpCostPerRequest')),
        BotCostPerRequest: Number(form.get('BotCostPerRequest')),
        ExpectedRunsPerDay: Number(form.get('ExpectedRunsPerDay')),
        Department: roiTarget.Department,
        BotName: roiTarget.BotName,
      })
      toast.success(t('actions.save'), roiTarget.ProcessName)
      setRoiTarget(null)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const saveSla = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await updateSla.mutateAsync({
        ProcessName: slaTarget.ProcessName,
        SLATargetMinutes: Number(form.get('SLATargetMinutes')),
        AvgItemProcessingSeconds: Number(form.get('AvgItemProcessingSeconds')),
        SLAWarningRatio: Number(form.get('SLAWarningRatio')),
      })
      toast.success(t('actions.save'), slaTarget.ProcessName)
      setSlaTarget(null)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  // A command-palette process jump is reflected in the search filter on arrival.
  useEffect(() => {
    if (!processQuery) return
    setSearch(processQuery)
    setPage(1)
  }, [processQuery])

  // Hooks stay unconditional even when the API returns an error state.
  // Reaching this module completes the getting-started step.
  useEffect(() => markOnboardingStep('stepProcesses'), [])

  if (processes.isError) {
    return (
      <Card>
        <ErrorState error={processes.error} onRetry={() => processes.refetch()} />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('processes.title')}
        subtitle={t('processes.subtitle')}
        actions={<ExportMenu days={30} />}
      />

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('actions.search')}</span>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                className="h-9 w-56 ps-9 text-xs"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder={t('processes.process')}
              />
            </div>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('processes.department')}</span>
            <Select
              className="h-9 w-44 py-0 text-xs"
              value={department}
              onChange={(event) => {
                setDepartment(event.target.value)
                setPage(1)
              }}
            >
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
          <div className="flex h-9 items-center">
            <Switch
              checked={includeInactive}
              onChange={(value) => {
                setIncludeInactive(value)
                setPage(1)
              }}
              label={t('processes.inactive')}
            />
          </div>
          <div className="ms-auto flex items-center gap-2" role="group" aria-label={t('processes.viewMode')}>
            <span className="hidden text-xs text-muted sm:inline">{t('processes.viewMode')}</span>
            <SegmentedControl
              value={viewMode === 'cards' ? 'cards' : 'table'}
              onValueChange={setViewMode}
              size="sm"
              items={[
                { value: 'table', label: t('processes.tableView'), icon: List },
                { value: 'cards', label: t('processes.cardsView'), icon: LayoutGrid },
              ]}
            />
          </div>
        </div>
      </Card>

      {viewMode === 'cards' ? (
        <>
          {processes.isLoading && !rows.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <Card key={index} className="space-y-3 p-4">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-16" />
                  <Skeleton className="h-3" />
                </Card>
              ))}
            </div>
          ) : !rows.length ? (
            <Card>
              <EmptyState icon={Workflow} title={t('dashboard.empty.table')} description={t('processes.missingConfig')} />
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((row) => (
                  <ProcessCard
                    key={row.ConfigID ?? row.ProcessName}
                    process={row}
                    stats={roiByProcess.get(row.ProcessName)}
                    canWrite={canWrite}
                    onEditRoi={setRoiTarget}
                    onEditSla={setSlaTarget}
                    onToggleActive={toggleActive}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
              <Card className="p-3">
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size)
                    setPage(1)
                  }}
                  labels={{ of: t('common.of'), none: t('common.na') }}
                />
              </Card>
            </>
          )}
        </>
      ) : (
        <Card>
        <DataTable
          loading={processes.isLoading}
          rows={rows}
          // Sorting is done by the server so it stays correct across pages.
          sort={sort}
          onSortChange={(next) => {
            setSort(next)
            setPage(1)
          }}
          rowKey={(row) => row.ConfigID}
          empty={<EmptyState icon={Workflow} title={t('dashboard.empty.table')} description={t('processes.missingConfig')} />}
          columns={[
            {
              key: 'ProcessName',
              header: t('processes.process'),
              sortable: true,
              render: (row) => (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{row.ProcessName}</p>
                  <p className="truncate text-[11px] text-muted">
                    {row.BotName || row.Provider} · {row.Department}
                  </p>
                </div>
              ),
            },
            {
              key: 'Criticality',
              header: t('processes.criticality'),
              render: (row) => <Badge tone={CRITICALITY_TONE[row.Criticality] || 'neutral'}>{row.Criticality || '—'}</Badge>,
            },
            {
              key: 'ExpectedRunsPerDay',
              header: t('processes.expectedRuns'),
              align: 'end',
              sortable: true,
              render: (row) => <span className="tabular-nums">{compactNumber(row.ExpectedRunsPerDay || 0)}</span>,
            },
            {
              key: 'actual_runs_per_day',
              header: t('processes.actualRuns'),
              align: 'end',
              render: (row) => {
                const stats = roiByProcess.get(row.ProcessName)
                return <span className="tabular-nums">{compactNumber(stats?.actual_runs_per_day || 0)}</span>
              },
            },
            {
              key: 'target_attainment_percent',
              header: t('processes.targetAttainment'),
              align: 'end',
              render: (row) => {
                const stats = roiByProcess.get(row.ProcessName)
                const value = Number(stats?.target_attainment_percent || 0)
                return <span className={value >= 90 ? 'text-success' : value >= 60 ? 'text-warning' : 'text-danger'}>{percent(value)}</span>
              },
            },
            {
              key: 'hours_saved',
              header: t('processes.hoursSaved'),
              align: 'end',
              render: (row) => {
                const stats = roiByProcess.get(row.ProcessName)
                return <span className="tabular-nums">{compactNumber(stats?.hours_saved || 0)}</span>
              },
            },
            {
              key: 'cost_saved',
              header: t('processes.costSaved'),
              align: 'end',
              render: (row) => {
                const stats = roiByProcess.get(row.ProcessName)
                return <span className="tabular-nums text-success">{currency(stats?.cost_saved || 0)}</span>
              },
            },
            {
              key: 'SLATargetMinutes',
              header: t('processes.slaTarget'),
              align: 'end',
              render: (row) => <span className="tabular-nums">{row.SLATargetMinutes ?? '—'}</span>,
            },
            {
              key: 'IsActive',
              header: t('processes.active'),
              align: 'center',
              render: (row) => <Badge tone={row.IsActive ? 'success' : 'neutral'} dot>{row.IsActive ? t('common.yes') : t('common.no')}</Badge>,
            },
            {
              key: 'actions',
              header: '',
              align: 'end',
              render: (row) =>
                canWrite ? (
                  <div className="flex items-center justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setRoiTarget(row)} aria-label={t('processes.editRoi')} title={t('processes.editRoi')}>
                      <Pencil className="h-3.5 w-3.5"  aria-hidden/>
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setSlaTarget(row)} aria-label={t('processes.editSla')} title={t('processes.editSla')}>
                      <span className="text-[10px] font-semibold">SLA</span>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toggleActive(row)}
                      aria-label={row.IsActive ? t('processes.deactivate') : t('processes.activate')}
                      title={row.IsActive ? t('processes.deactivate') : t('processes.activate')}
                    >
                      <Power className={row.IsActive ? 'h-3.5 w-3.5 text-success' : 'h-3.5 w-3.5 text-muted'}  aria-hidden/>
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(row)} aria-label={t('processes.delete')} title={t('processes.delete')}>
                      <Trash2 className="h-3.5 w-3.5 text-danger"  aria-hidden/>
                    </Button>
                  </div>
                ) : null,
            },
          ]}
          footer={
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size)
                setPage(1)
              }}
              labels={{ of: t('common.of'), none: t('common.na') }}
            />
          }
        />
        </Card>
      )}

      {/* --------------------------------------------------------- ROI model */}
      <Modal open={Boolean(roiTarget)} onClose={() => setRoiTarget(null)} title={t('processes.editRoi')} description={roiTarget?.ProcessName} size="sm">
        {roiTarget ? (
          <form id="roi-form" onSubmit={saveRoi} className="space-y-3">
            <Field label={t('processes.expectedRuns')} required>
              <Input name="ExpectedRunsPerDay" type="number" min="0" step="1" defaultValue={roiTarget.ExpectedRunsPerDay ?? 0} required />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('fields.minutesPerRequest')} required>
                <Input name="EmpMinutesPerRequest" type="number" min="0" step="0.1" defaultValue={roiTarget.EmpMinutesPerRequest ?? 0} required />
              </Field>
              <Field label={t('fields.manualCost')} required>
                <Input name="EmpCostPerRequest" type="number" min="0" step="0.01" defaultValue={roiTarget.EmpCostPerRequest ?? 0} required />
              </Field>
              <Field label={t('fields.botCost')} required>
                <Input name="BotCostPerRequest" type="number" min="0" step="0.01" defaultValue={roiTarget.BotCostPerRequest ?? 0} required />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" type="button" onClick={() => setRoiTarget(null)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={updateRoi.isPending}>
                {t('actions.save')}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* ----------------------------------------------------------- SLA */}
      <Modal open={Boolean(slaTarget)} onClose={() => setSlaTarget(null)} title={t('processes.editSla')} description={slaTarget?.ProcessName} size="sm">
        {slaTarget ? (
          <form onSubmit={saveSla} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('processes.slaTarget')} required>
                <Input name="SLATargetMinutes" type="number" min="1" step="1" defaultValue={slaTarget.SLATargetMinutes ?? 60} required />
              </Field>
              <Field label={t('capacity.predictedWait')} hint={t('fields.avgItemSeconds')} required>
                <Input name="AvgItemProcessingSeconds" type="number" min="1" step="1" defaultValue={30} required />
              </Field>
            </div>
            <Field label={t('fields.warningRatio')} hint={t('fields.warningRatioHint')}>
              <Input name="SLAWarningRatio" type="number" min="0.1" max="1" step="0.05" defaultValue={slaTarget.SLAWarningRatio ?? 0.8} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" type="button" onClick={() => setSlaTarget(null)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={updateSla.isPending}>
                {t('actions.save')}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={remove.isPending}
        title={t('processes.delete')}
        message={t('processes.deleteConfirm')}
        confirmLabel={t('actions.delete')}
      />
    </div>
  )
}
