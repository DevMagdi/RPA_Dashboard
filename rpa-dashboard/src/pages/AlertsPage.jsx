import { Check, Eye, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useToast } from '../context/ToastProvider'
import { useAlerts, useEvaluateAlerts, useSetAlertStatus } from '../hooks/api'
import { dateTime } from '../lib/format'
import { Badge, Button, Card, CardBody, DataTable, EmptyState, SectionTitle, Skeleton } from '../components/ui'

const SEVERITY_TONE = { Critical: 'danger', High: 'danger', Warning: 'warning', Info: 'info' }

export default function AlertsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const alerts = useAlerts()
  const evaluate = useEvaluateAlerts()
  const setStatus = useSetAlertStatus()

  const act = async (id, status) => {
    try {
      await setStatus.mutateAsync({ id, status })
      toast.success(t('alerts.title'), status)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const onEvaluate = async () => {
    try {
      const result = await evaluate.mutateAsync()
      toast.success(t('alerts.evaluate'), `${result.touched} · ${result.open} open`)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const rows = alerts.data || []

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('alerts.title')}
        subtitle={t('alerts.subtitle')}
        actions={
          <Button onClick={onEvaluate} disabled={evaluate.isPending}>
            <RefreshCw className="h-4 w-4" /> {t('alerts.evaluate')}
          </Button>
        }
      />
      <Card>
        <CardBody>
          {alerts.isLoading ? (
            <Skeleton className="h-40" />
          ) : rows.length === 0 ? (
            <EmptyState title={t('alerts.empty')} />
          ) : (
            <DataTable
              rows={rows}
              columns={[
                { key: 'Severity', header: t('alerts.severity'), render: (row) => <Badge tone={SEVERITY_TONE[row.Severity] || 'info'}>{row.Severity}</Badge> },
                { key: 'Title', header: t('alerts.alert') },
                { key: 'RuleKey', header: t('alerts.rule') },
                { key: 'Status', header: t('common.status'), render: (row) => <Badge>{row.Status}</Badge> },
                { key: 'Occurrences', label: '×' },
                { key: 'LastSeenAt', header: t('alerts.lastSeen'), render: (row) => dateTime(row.LastSeenAt) },
                {
                  key: 'actions',
                  header: '',
                  render: (row) => (
                    <span className="flex gap-1">
                      {row.Status === 'Open' ? (
                        <Button size="sm" variant="secondary" onClick={() => act(row.AlertID, 'Acknowledged')}>
                          <Eye className="h-3.5 w-3.5" /> {t('alerts.acknowledge')}
                        </Button>
                      ) : null}
                      {row.Status !== 'Resolved' ? (
                        <Button size="sm" variant="secondary" onClick={() => act(row.AlertID, 'Resolved')}>
                          <Check className="h-3.5 w-3.5" /> {t('alerts.resolve')}
                        </Button>
                      ) : null}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
