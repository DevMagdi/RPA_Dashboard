import { Check, Palette, Plug, RefreshCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useToast } from '../context/ToastProvider'
import {
  useConfigurePlatform,
  useOrganization,
  useProviderCatalogue,
  useRunRetention,
  useTestPlatformConfig,
  useUpdateBranding,
} from '../hooks/api'
import { Badge, Button, Card, CardBody, CardHeader, Field, InfoTile, Input, Notice, SectionTitle, Select, Textarea, ErrorState} from '../components/ui'

const SAMPLE_CONFIGS = {
  uipath: `{\n  "base_url": "https://orchestrator.bank.local",\n  "folder_path": "Finance",\n  "auth_mode": "pat",\n  "personal_access_token": "vault:UIPATH_PAT"\n}`,
  automation_anywhere: `{\n  "base_url": "https://a360.bank.local",\n  "username": "coe-bot",\n  "password": "vault:AA_PASSWORD",\n  "api_version": "v3"\n}`,
  blue_prism: `{\n  "base_url": "https://blueprism.bank.local"\n}`,
  generic_sql: `{\n  "schema": "dbo",\n  "runs_table": "AgentRuns",\n  "processes_table": "ProcessConfig"\n}`,
}

/**
 * Single-organization administration.
 *
 * One installation serves exactly one bank/enterprise: this page manages *the*
 * organization — branding, the vendor-neutral RPA platform connection and the
 * retention policy. There is deliberately no provisioning of other orgs.
 */
export default function OrganizationPage() {
  const { t } = useTranslation()
  const toast = useToast()

  const organization = useOrganization()
  const providers = useProviderCatalogue()
  const updateBranding = useUpdateBranding()
  const configurePlatform = useConfigurePlatform()
  const testPlatform = useTestPlatformConfig()
  const runRetention = useRunRetention()

  const [testResult, setTestResult] = useState(null)
  const [provider, setProvider] = useState('generic_sql')
  const [configText, setConfigText] = useState(SAMPLE_CONFIGS.generic_sql)

  const org = organization.data || {}
  const stats = org.stats || {}

  const onBranding = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await updateBranding.mutateAsync({
        Name: form.get('Name') || undefined,
        CompanyName: form.get('CompanyName') || undefined,
        PrimaryColor: form.get('PrimaryColor'),
        AccentColor: form.get('AccentColor'),
        LogoUrl: form.get('LogoUrl') || undefined,
        Locale: form.get('Locale'),
      })
      toast.success(t('organization.branding'))
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onPlatform = async (event) => {
    event.preventDefault()
    let config
    try {
      config = JSON.parse(configText || '{}')
    } catch {
      toast.error(t('errors.title'), 'Invalid JSON')
      return
    }
    try {
      await configurePlatform.mutateAsync({ provider, config })
      toast.success(t('organization.platformConfig'), provider)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onTest = async () => {
    setTestResult(null)
    try {
      const result = await testPlatform.mutateAsync()
      setTestResult(result)
      toast.success(t('organization.platformConfig'), result?.status || 'ok')
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onRetention = async () => {
    try {
      const result = await runRetention.mutateAsync({ retentionDays: 730 })
      toast.success(t('organization.retention'), JSON.stringify(result?.deleted || result?.purged || {}))
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  if (organization.isError) {
    return <ErrorState error={organization.error} onRetry={() => organization.refetch()} />
  }

  return (
    <div className="space-y-4">
      <SectionTitle title={t('organization.title')} subtitle={t('organization.subtitle')} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoTile label={t('organization.name')} value={org.CompanyName || org.Name || '—'} />
        <InfoTile label={t('organization.provider')} value={org.PlatformProvider || 'generic_sql'} />
        <InfoTile label={t('processes.title')} value={stats.processes ?? '—'} />
        <InfoTile label={t('nav.users')} value={stats.users ?? '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('organization.branding')} icon={Palette} />
          <CardBody>
            <form className="space-y-3" onSubmit={onBranding}>
              <Field label={t('organization.name')}>
                <Input name="Name" defaultValue={org.Name || ''} />
              </Field>
              <Field label={t('organization.companyName')}>
                <Input name="CompanyName" defaultValue={org.CompanyName || ''} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('organization.primaryColor')}>
                  <Input name="PrimaryColor" type="color" defaultValue={org.BrandPrimaryColor || '#4b367c'} />
                </Field>
                <Field label={t('organization.accentColor')}>
                  <Input name="AccentColor" type="color" defaultValue={org.BrandAccentColor || '#f37920'} />
                </Field>
              </div>
              <Field label={t('fields.logoUrl')}>
                <Input name="LogoUrl" defaultValue={org.LogoUrl || ''} placeholder="https://intranet.bank.local/logo.png" />
              </Field>
              <Field label={t('organization.locale')}>
                <Select name="Locale" defaultValue={org.Locale || 'en'}>
                  <option value="en">{LANGUAGES.find((item) => item.code === value)?.nativeLabel || value}</option>
                  <option value="ar">العربية</option>
                </Select>
              </Field>
              <Button type="submit" disabled={updateBranding.isPending}>
                <Check className="h-4 w-4"  aria-hidden/> {t('actions.save')}
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('organization.platformConfig')} icon={Plug} />
          <CardBody>
            <form className="space-y-3" onSubmit={onPlatform}>
              <Field label={t('organization.provider')}>
                <Select
                  value={provider}
                  onChange={(event) => {
                    setProvider(event.target.value)
                    setConfigText(SAMPLE_CONFIGS[event.target.value] || '{}')
                  }}
                >
                  {(providers.data || []).map((row) => (
                    <option key={row.provider} value={row.provider}>
                      {row.display_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('fields.json')} hint={t('organization.configHint')}>
                <Textarea rows={9} value={configText} onChange={(event) => setConfigText(event.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={configurePlatform.isPending}>
                  <Plug className="h-4 w-4"  aria-hidden/> {t('actions.save')}
                </Button>
                <Button type="button" variant="secondary" onClick={onTest} disabled={testPlatform.isPending}>
                  <RefreshCw className="h-4 w-4"  aria-hidden/> {t('organization.testConnection')}
                </Button>
                <Button type="button" variant="secondary" onClick={onRetention} disabled={runRetention.isPending}>
                  <ShieldCheck className="h-4 w-4"  aria-hidden/> {t('organization.retention')}
                </Button>
              </div>
              {testResult ? (
                <Notice tone={testResult.ok ? 'success' : 'warning'}>{JSON.stringify(testResult)}</Notice>
              ) : null}
            </form>
          </CardBody>
        </Card>
      </div>

      <Notice tone="info">{t('organization.singleOrgNotice')}</Notice>
      {org.PlatformProvider ? <Badge tone="brand">{org.PlatformProvider}</Badge> : null}
    </div>
  )
}
