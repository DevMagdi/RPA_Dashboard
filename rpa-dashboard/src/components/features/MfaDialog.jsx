import { QRCodeSVG } from 'qrcode.react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../context/AuthProvider'
import { useToast } from '../../context/ToastProvider'
import api from '../../lib/api'
import { Button, CopyButton, Field, Input, Modal, Notice, Spinner } from '../ui'

/**
 * Two-factor enrolment dialog.
 *
 * Flow: `POST /api/auth/mfa/setup` → show the otpauth URI as a QR code →
 * the user scans it and confirms one code → `POST /api/auth/mfa/confirm`
 * returns the one-time backup codes.
 */
export default function MfaDialog({ open, onClose }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { refreshUser, user } = useAuth()
  const [stage, setStage] = useState('idle')
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState([])
  const [error, setError] = useState(null)
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (!open) {
      setStage('idle')
      setSetup(null)
      setCode('')
      setBackupCodes([])
      setError(null)
      setPassword('')
    }
  }, [open])

  const start = async () => {
    setError(null)
    setStage('loading')
    try {
      const data = await api.post('/api/auth/mfa/setup', {})
      setSetup(data)
      setStage('scanning')
    } catch (err) {
      setError(err)
      setStage('idle')
    }
  }

  const confirm = async () => {
    setError(null)
    setStage('confirming')
    try {
      const data = await api.post('/api/auth/mfa/confirm', { code })
      setBackupCodes(data.backup_codes || [])
      setStage('backup')
      await refreshUser()
      toast.success(t('auth.mfaEnabled'))
    } catch (err) {
      setError(err)
      setStage('scanning')
    }
  }

  const disable = async () => {
    setError(null)
    setStage('disabling')
    try {
      await api.post('/api/auth/mfa/disable', { password })
      await refreshUser()
      toast.success(t('auth.disableMfa'))
      onClose?.()
    } catch (err) {
      setError(err)
      setStage('disable')
    }
  }

  const isEnabled = Boolean(user?.mfa_enabled)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('auth.setupMfa')}
      description={isEnabled ? t('auth.mfaEnabled') : t('auth.setupMfaHint')}
      size="md"
      footer={
        stage === 'backup' ? (
          <Button variant="primary" onClick={onClose}>
            {t('actions.close')}
          </Button>
        ) : isEnabled ? null : stage === 'scanning' ? (
          <Button variant="primary" loading={stage === 'confirming'} disabled={code.length < 6} onClick={confirm}>
            {t('auth.confirmCode')}
          </Button>
        ) : (
          <Button variant="primary" loading={stage === 'loading'} onClick={start}>
            {t('auth.setupMfa')}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {error ? <Notice tone="danger" title={error.message} /> : null}

        {isEnabled && stage !== 'backup' ? (
          <div className="space-y-3">
            <Notice tone="success" icon={ShieldCheck} title={t('auth.mfaEnabled')} />
            {stage === 'disable' ? (
              <div className="space-y-3">
                <Field label={t('auth.password')} required>
                  <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                </Field>
                <Button variant="danger" loading={stage === 'disabling'} onClick={disable} disabled={!password}>
                  {t('auth.disableMfa')}
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setStage('disable')}>
                {t('auth.disableMfa')}
              </Button>
            )}
          </div>
        ) : null}

        {!isEnabled && stage === 'loading' ? <Spinner label={t('app.loading')} /> : null}

        {stage === 'scanning' && setup ? (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="rounded-2xl border border-border bg-white p-3">
              <QRCodeSVG value={setup.otpauth_url || setup.secret} size={168} level="M" />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="text-xs text-muted">{t('auth.setupManual')}</p>
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
                  <KeyRound className="h-4 w-4 text-muted" aria-hidden />
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-text">{setup.secret}</code>
                  <CopyButton value={setup.secret} label={t('actions.copy')} />
                </div>
              </div>
              <Field label={t('auth.mfaCode')} required>
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className="text-center font-mono text-lg tracking-[0.4em]"
                />
              </Field>
            </div>
          </div>
        ) : null}

        {stage === 'backup' ? (
          <div className="space-y-3">
            <Notice tone="warning" title={t('auth.backupCodesTitle')}>
              {t('auth.backupCodesHint')}
            </Notice>
            <ul className="grid grid-cols-2 gap-2">
              {backupCodes.map((item) => (
                <li key={item} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-center font-mono text-sm">
                  {item}
                </li>
              ))}
            </ul>
            <CopyButton value={backupCodes.join('\n')} label={t('actions.copy')} />
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
