import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../context/AuthProvider'
import { useToast } from '../../context/ToastProvider'
import api from '../../lib/api'
import { Button } from '../ui'

/**
 * Branded export menu (Excel / PDF).
 *
 * Exports are generated server-side with the tenant logo and colours, so a
 * bank's CoE can attach them to a management pack without editing anything.
 */
const EXPORTS = [
  { id: 'runs.xlsx', labelKey: 'actions.exportExcel', icon: FileSpreadsheet, path: '/api/exports/runs.xlsx', permission: 'export:read' },
  { id: 'audit.xlsx', labelKey: 'nav.audit', icon: FileSpreadsheet, path: '/api/exports/audit.xlsx', permission: 'export:read' },
  { id: 'roi.pdf', labelKey: 'actions.exportPdf', icon: FileText, path: '/api/exports/roi.pdf', permission: 'export:read' },
  { id: 'capacity.pdf', labelKey: 'capacity.title', icon: FileText, path: '/api/exports/capacity.pdf', permission: 'export:read' },
]

export default function ExportMenu({ days = 30, compact = false }) {
  const { t } = useTranslation()
  const { has } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)

  const available = EXPORTS.filter((item) => has(item.permission) || has('*'))
  if (!available.length) return null

  const run = async (item) => {
    setBusy(item.id)
    try {
      const filename = `${item.id.replace('.', '_')}_${new Date().toISOString().slice(0, 10)}.${item.id.split('.').pop()}`
      await api.download(`${item.path}?days=${days}`, filename)
      toast.success(t('actions.export'), filename)
      setOpen(false)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" icon={Download} onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
        {compact ? null : t('actions.export')}
      </Button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div role="menu" className="absolute end-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
            {available.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={busy === item.id}
                onClick={() => run(item)}
                className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm text-text transition hover:bg-surface-2 disabled:opacity-60"
              >
                <item.icon className="h-4 w-4 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                <span className="text-[10px] uppercase text-muted">{item.id.split('.').pop()}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
