import { Building2, Check, Palette, Plug, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useToast } from '../context/ToastProvider'
import {
  useConfigurePlatform,
  useCreateTenant,
  useProviderCatalogue,
  useRunRetention,
  useSetTenantActive,
  useTenant,
  useTenants,
  useTestPlatformConfig,
  useUpdateBranding,
} from '../hooks/api'
import { dateTime } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  InfoTile,
  Input,
  Modal,
  Notice,
  SectionTitle,
  Select,
  Textarea,
} from '../components/ui'

const SAMPLE_CONFIGS = {
  uipath: `{\n  "base_url": "https://orchestrator.bank.local",\n  "tenant_name": "Default",\n  "folder_id": 12345,\n  "personal_access_token": "vault:UIPATH_PAT"\n}`,
  automation_anywhere: `{\n  "base_url": "https://community.cloud.automationanywhere.digital",\n  "username": "coe-bot",\n  "password": "vault:AA_PASSWORD",\n  "api_version": "v3"\n}`,
  generic_sql: `{\n  "schema": "dbo",\n  "runs_table": "AgentRuns",\n  "processes_table": "ProcessConfig"\n}`,
}

export default function TenantsPage() {
  const { t } = useTranslation()
  const toast = useToast()

  const tenants = useTenants(true)
  const providers = useProviderCatalogue()
  const createTenant = useCreateTenant()
  const updateBranding = useUpdateBranding()
  const configurePlatform = useConfigurePlatform()
  const testPlatform = useTestPlatformConfig()
  const setActive = useSetTenantActive()
  const runRetention = useRunRetention()

  const [createOpen, setCreateOpen] = useState(false)
  const [brandingTarget, setBrandingTarget] = useState(null)
  const [platformTarget, setPlatformTarget] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [testResult, setTestResult] = useState(null)

  const detail = useTenant(detailId)

  const rows = tenants.data || []

  const onCreate = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const result = await createTenant.mutateAsync({
        TenantKey: form.get('TenantKey'),
        Name: form.get('Name'),
        CompanyName: form.get('CompanyName'),
        PrimaryColor: form.get('PrimaryColor') || '#4b367c',
        AccentColor: form.get('AccentColor') || '#f37920',
        Locale: form.get('Locale') || 'en',
        Provider: form.get('Provider') || 'generic_sql',
        AdminUsername: form.get('AdminUsername') || undefined,
        AdminPassword: form.get('AdminPassword') || undefined,
        AdminEmail: form.get('AdminEmail') || undefined,
      })
      toast.success(t('tenants.createTenant'), result?.TenantKey || String(form.get('TenantKey')))
      setCreateOpen(false)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onBranding = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await updateBranding.mutateAsync({
        tenantId: brandingTarget.TenantID,
        Name: form.get('Name') || undefined,
        CompanyName: form.get('CompanyName') || undefined,
        PrimaryColor: form.get('PrimaryColor'),
        AccentColor: form.get('AccentColor'),
        LogoUrl: form.get('LogoUrl') || undefined,
        Locale: form.get('Locale'),
      })
      toast.success(t('tenants.branding'), brandingTarget.CompanyName || brandingTarget.Name)
      setBrandingTarget(null)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onPlatform = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    let config
    try {
      config = JSON.parse(String(form.get('Config') || '{}'))
    } catch {
      toast.error(t('errors.title'), 'Invalid JSON')
      return
    }
    try {
      await configurePlatform.mutateAsync({ tenantId: platformTarget.TenantID, provider: form.get('Provider'), config })
      toast.success(t('tenants.platformConfig'), platformTarget.TenantKey)
      setPlatformTarget(null)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('tenants.title')}
        subtitle={t('tenants.subtitle')}
        actions={
          <Button icon={Plus} onClick={() => setCreateOpen(true)}>
            {t('tenants.createTenant')}
          </Button>
        }
      />

      <Notice tone="info" icon={ShieldCheck} title={t('tenants.configHint')} />

      <Card>
        <DataTable
          loading={tenants.isLoading}
          rows={rows}
          rowKey={(row) => row.TenantID}
          empty={<EmptyState icon={Building2} title={t('dashboard.empty.table')} />}
          onRowClick={(row) => setDetailId(row.TenantID)}
          columns={[
            {
              key: 'CompanyName',
              header: t('tenants.companyName'),
              render: (row) => (
                <div className="flex items-center gap-3">
                  <span className="h-8 w-8 shrink-0 rounded-lg border border-border" style={{ background: row.BrandPrimaryColor || 'var(--brand)' }} aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text">{row.CompanyName || row.Name}</p>
                    <p className="truncate font-mono text-[11px] text-muted">{row.TenantKey}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'PlatformProvider',
              header: t('tenants.provider'),
              render: (row) => <Badge tone="info">{row.PlatformProvider || 'generic_sql'}</Badge>,
            },
            {
              key: 'Locale',
              header: t('tenants.locale'),
              render: (row) => <span className="text-xs">{row.Locale || 'en'}</span>,
            },
            {
              key: 'colors',
              header: t('tenants.branding'),
              render: (row) => (
                <span className="flex items-center gap-1">
                  <span className="h-4 w-4 rounded" style={{ background: row.BrandPrimaryColor || 'var(--brand)' }} />
                  <span className="h-4 w-4 rounded" style={{ background: row.BrandAccentColor || 'var(--accent)' }} />
                </span>
              ),
            },
            {
              key: 'IsActive',
              header: t('tenants.activation'),
              align: 'center',
              render: (row) => (
                <Badge tone={row.IsActive ? 'success' : 'neutral'} dot>
                  {row.IsActive ? t('processes.active') : t('processes.inactive')}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              align: 'end',
              render: (row) => (
                <div className="flex items-center justify-end gap-1">
                  <Button size="icon" variant="ghost" onClick={(event) => { event.stopPropagation(); setBrandingTarget(row) }} aria-label={t('tenants.branding')} title={t('tenants.branding')}>
                    <Palette className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={(event) => { event.stopPropagation(); setPlatformTarget(row) }} aria-label={t('tenants.platformConfig')} title={t('tenants.platformConfig')}>
                    <Plug className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async (event) => {
                      event.stopPropagation()
                      try {
                        await setActive.mutateAsync({ tenantId: row.TenantID, isActive: !row.IsActive })
                        toast.success(row.IsActive ? t('processes.deactivate') : t('processes.activate'), row.TenantKey)
                      } catch (error) {
                        toast.error(t('errors.title'), error.message)
                      }
                    }}
                    aria-label={t('tenants.activation')}
                  >
                    <Check className={row.IsActive ? 'h-3.5 w-3.5 text-success' : 'h-3.5 w-3.5 text-muted'} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async (event) => {
                      event.stopPropagation()
                      try {
                        const result = await runRetention.mutateAsync({ tenantId: row.TenantID, retentionDays: 730 })
                        toast.success(t('tenants.runRetention'), JSON.stringify(result?.purged ?? result))
                      } catch (error) {
                        toast.error(t('errors.title'), error.message)
                      }
                    }}
                    aria-label={t('tenants.runRetention')}
                    title={t('tenants.retention')}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-warning" />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* ------------------------------------------------------- detail */}
      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detail.data?.CompanyName || detail.data?.Name || t('tenants.title')}
        description={detail.data?.TenantKey}
        size="md"
        footer={
          <Button variant="secondary" icon={RefreshCw} onClick={() => detail.refetch()}>
            {t('actions.refresh')}
          </Button>
        }
      >
        {detail.data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <InfoTile label={t('tenants.users')} value={detail.data.stats?.users ?? '—'} />
              <InfoTile label={t('tenants.processes')} value={detail.data.stats?.processes ?? '—'} />
              <InfoTile label={t('runs.machine')} value={detail.data.stats?.machines ?? '—'} />
              <InfoTile label={t('tenants.runs')} value={detail.data.stats?.runs ?? '—'} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <InfoTile label={t('tenants.locale')} value={detail.data.Locale || 'en'} />
              <InfoTile label={t('tenants.provider')} value={detail.data.PlatformProvider || '—'} />
              <InfoTile label={t('lifecycle.createdAt')} value={dateTime(detail.data.CreatedAt)} />
              <InfoTile label={t('tenants.activation')} value={detail.data.IsActive ? t('common.yes') : t('common.no')} tone={detail.data.IsActive ? 'success' : 'warning'} />
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ------------------------------------------------------- create */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('tenants.createTenant')} description={t('tenants.subtitle')} size="md">
        <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
          <Field label={t('tenants.tenantKey')} required>
            <Input name="TenantKey" required placeholder="retail-bank" />
          </Field>
          <Field label={t('tenants.companyName')} required>
            <Input name="CompanyName" required placeholder="Retail Bank" />
          </Field>
          <Field label="Name">
            <Input name="Name" placeholder="Retail Banking CoE" />
          </Field>
          <Field label={t('tenants.provider')}>
            <Select name="Provider" defaultValue="generic_sql">
              {(providers.data || []).map((provider) => (
                <option key={provider.provider || provider} value={provider.provider || provider}>
                  {provider.display_name || provider.provider || provider}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tenants.primaryColor')}>
            <Input name="PrimaryColor" type="color" defaultValue="#4b367c" className="h-10 p-1" />
          </Field>
          <Field label={t('tenants.accentColor')}>
            <Input name="AccentColor" type="color" defaultValue="#f37920" className="h-10 p-1" />
          </Field>
          <Field label={t('tenants.locale')}>
            <Select name="Locale" defaultValue="en">
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          </Field>
          <Field label={t('users.username')} hint={t('users.temporaryPasswordHint')}>
            <Input name="AdminUsername" placeholder="admin" autoComplete="off" />
          </Field>
          <Field label={t('users.temporaryPassword')}>
            <Input name="AdminPassword" type="text" autoComplete="off" minLength={12} />
          </Field>
          <Field label={t('users.email')}>
            <Input name="AdminEmail" type="email" autoComplete="off" />
          </Field>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setCreateOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={createTenant.isPending} icon={Plus}>
              {t('actions.create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------------ branding */}
      <Modal open={Boolean(brandingTarget)} onClose={() => setBrandingTarget(null)} title={t('tenants.branding')} description={brandingTarget?.TenantKey} size="sm">
        {brandingTarget ? (
          <form onSubmit={onBranding} className="space-y-3">
            <Field label={t('tenants.companyName')}>
              <Input name="CompanyName" defaultValue={brandingTarget.CompanyName || ''} />
            </Field>
            <Field label="Name">
              <Input name="Name" defaultValue={brandingTarget.Name || ''} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('tenants.primaryColor')}>
                <Input name="PrimaryColor" type="color" defaultValue={brandingTarget.BrandPrimaryColor || '#4b367c'} className="h-10 p-1" />
              </Field>
              <Field label={t('tenants.accentColor')}>
                <Input name="AccentColor" type="color" defaultValue={brandingTarget.BrandAccentColor || '#f37920'} className="h-10 p-1" />
              </Field>
            </div>
            <Field label="Logo URL" hint="PNG/SVG hosted on the bank intranet">
              <Input name="LogoUrl" placeholder="https://intranet.bank/logo.svg" />
            </Field>
            <Field label={t('tenants.locale')}>
              <Select name="Locale" defaultValue={brandingTarget.Locale || 'en'}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setBrandingTarget(null)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={updateBranding.isPending}>
                {t('actions.save')}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      {/* -------------------------------------------------- platform cfg */}
      <Modal open={Boolean(platformTarget)} onClose={() => setPlatformTarget(null)} title={t('tenants.platformConfig')} description={platformTarget?.TenantKey} size="md">
        {platformTarget ? (
          <form onSubmit={onPlatform} className="space-y-3">
            <Field label={t('tenants.provider')} required>
              <Select name="Provider" defaultValue={platformTarget.PlatformProvider || 'uipath'} required>
                {(providers.data || []).map((provider) => (
                  <option key={provider.provider || provider} value={provider.provider || provider}>
                    {provider.display_name || provider.provider || provider}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Configuration (JSON)" hint={t('tenants.configHint')} required>
              <Textarea
                name="Config"
                rows={10}
                defaultValue={SAMPLE_CONFIGS[platformTarget.PlatformProvider] || SAMPLE_CONFIGS.uipath}
                className="font-mono text-xs"
                required
              />
            </Field>
            {testResult ? (
              <Notice tone={testResult.ok ? 'success' : 'danger'} title={testResult.message}>
                {testResult.latency_ms ? `${testResult.latency_ms} ms` : null}
              </Notice>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                type="button"
                loading={testPlatform.isPending}
                onClick={async () => {
                  try {
                    const result = await testPlatform.mutateAsync(platformTarget.TenantID)
                    setTestResult(result)
                  } catch (error) {
                    toast.error(t('errors.title'), error.message)
                  }
                }}
              >
                {t('tenants.testConnection')}
              </Button>
              <Button type="submit" loading={configurePlatform.isPending}>
                {t('actions.save')}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  )
}
