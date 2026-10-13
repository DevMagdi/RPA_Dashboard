import { KeyRound, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { useCreateUser, useDeleteUser, useSetUserActive, useUsers } from '../hooks/api'
import { ROLES } from '../lib/constants'
import { dateTime, relative } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  InfoTile,
  Input,
  Modal,
  Notice,
  SectionTitle,
  Select,
  Switch,
} from '../components/ui'

const ROLE_TONE = {
  SuperAdmin: 'danger',
  CoE_Manager: 'brand',
  TeamLead: 'info',
  Auditor: 'warning',
}

export default function UsersPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { has, user: currentUser } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showInactive, setShowInactive] = useState(true)

  const users = useUsers()
  const createUser = useCreateUser()
  const setActive = useSetUserActive()
  const removeUser = useDeleteUser()

  const canWrite = has('users:write') || has('*')
  const rows = (users.data || []).filter((row) => showInactive || row.IsActive)

  const onCreate = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const result = await createUser.mutateAsync({
        username: form.get('username'),
        password: form.get('password'),
        role: form.get('role'),
        department: form.get('department') || undefined,
        email: form.get('email') || undefined,
        full_name: form.get('full_name') || undefined,
        must_change_password: true,
      })
      toast.success(t('users.createUser'), result?.username || String(form.get('username')))
      setCreateOpen(false)
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={
          canWrite ? (
            <Button icon={UserPlus} onClick={() => setCreateOpen(true)}>
              {t('users.createUser')}
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <InfoTile label={t('users.title')} value={rows.length} />
        <InfoTile label={t('processes.active')} value={rows.filter((row) => row.IsActive).length} tone="success" />
        <InfoTile label="MFA" value={rows.filter((row) => row.MfaEnabled).length} tone={rows.every((row) => row.MfaEnabled) ? 'success' : 'warning'} />
        <InfoTile label={t('users.sessions')} value={rows.filter((row) => row.LockedUntil).length ? t('auth.locked') : t('common.na')} tone={rows.some((row) => row.LockedUntil) ? 'danger' : 'neutral'} />
      </div>

      <Card>
        <DataTable
          loading={users.isLoading}
          rows={rows}
          rowKey={(row) => row.UserID}
          empty={<EmptyState icon={Users} title={t('dashboard.empty.table')} />}
          columns={[
            {
              key: 'Username',
              header: t('users.username'),
              sortable: true,
              render: (row) => (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">
                    {row.FullName || row.Username}
                    {row.UserID === currentUser?.user_id ? <span className="ms-2 text-[10px] uppercase text-brand">you</span> : null}
                  </p>
                  <p className="truncate text-[11px] text-muted">{row.Email || row.Username}</p>
                </div>
              ),
            },
            {
              key: 'Role',
              header: t('users.role'),
              render: (row) => (
                <div>
                  <Badge tone={ROLE_TONE[row.Role] || 'neutral'}>{row.Role}</Badge>
                  <p className="mt-0.5 text-[11px] text-muted">{t(`users.roleDescriptions.${row.Role}`)}</p>
                </div>
              ),
            },
            {
              key: 'AllowedDepartment',
              header: t('users.department'),
              render: (row) => <span className="text-xs">{row.AllowedDepartment || 'ALL'}</span>,
            },
            {
              key: 'MfaEnabled',
              header: 'MFA',
              align: 'center',
              render: (row) => (
                <Badge tone={row.MfaEnabled ? 'success' : 'warning'} dot>
                  {row.MfaEnabled ? t('common.yes') : t('common.no')}
                </Badge>
              ),
            },
            {
              key: 'LastLoginDate',
              header: t('audit.when'),
              render: (row) => (
                <span className="text-xs text-muted" title={dateTime(row.LastLoginDate)}>
                  {row.LastLoginDate ? relative(row.LastLoginDate) : t('common.never')}
                </span>
              ),
            },
            {
              key: 'IsActive',
              header: t('users.status'),
              align: 'center',
              render: (row) =>
                row.LockedUntil ? (
                  <Badge tone="danger">{t('auth.locked')}</Badge>
                ) : (
                  <Badge tone={row.IsActive ? 'success' : 'neutral'}>{row.IsActive ? t('processes.active') : t('processes.inactive')}</Badge>
                ),
            },
            {
              key: 'actions',
              header: '',
              align: 'end',
              render: (row) =>
                canWrite && row.UserID !== currentUser?.user_id ? (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={setActive.isPending}
                      onClick={async () => {
                        try {
                          await setActive.mutateAsync({ userId: row.UserID, isActive: !row.IsActive })
                          toast.success(row.IsActive ? t('users.disable') : t('users.enable'), row.Username)
                        } catch (error) {
                          toast.error(t('errors.title'), error.message)
                        }
                      }}
                    >
                      {row.IsActive ? t('users.disable') : t('users.enable')}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(row)} aria-label={t('actions.delete')}>
                      <span className="text-xs">
                        <ShieldCheck className="h-3.5 w-3.5 text-danger" />
                      </span>
                    </Button>
                  </div>
                ) : null,
            },
          ]}
        />
      </Card>

      <Card className="p-3">
        <Switch checked={showInactive} onChange={setShowInactive} label={t('processes.inactive')} />
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('users.createUser')} description={t('users.subtitle')} size="md">
        <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
          <Field label={t('users.username')} required>
            <Input name="username" required autoComplete="off" />
          </Field>
          <Field label={t('users.fullName')}>
            <Input name="full_name" autoComplete="off" />
          </Field>
          <Field label={t('users.email')}>
            <Input name="email" type="email" autoComplete="off" />
          </Field>
          <Field label={t('users.role')} required>
            <Select name="role" defaultValue="Developer" required>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('users.department')} hint={t('auth.tenantHint')}>
            <Input name="department" placeholder="ALL" />
          </Field>
          <Field label={t('users.temporaryPassword')} hint={t('users.temporaryPasswordHint')} required>
            <Input name="password" type="text" minLength={12} required autoComplete="off" />
          </Field>
          <div className="sm:col-span-2">
            <Notice tone="info" icon={KeyRound}>
              {t('lifecycle.workflow.fourEyes')}
            </Notice>
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setCreateOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={createUser.isPending} icon={UserPlus}>
              {t('actions.create')}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          try {
            await removeUser.mutateAsync(deleteTarget.UserID)
            toast.success(t('actions.delete'), deleteTarget.Username)
            setDeleteTarget(null)
          } catch (error) {
            toast.error(t('errors.title'), error.message)
          }
        }}
        loading={removeUser.isPending}
        title={t('actions.delete')}
        message={deleteTarget ? `${deleteTarget.Username} — ${t('processes.deleteConfirm')}` : ''}
        confirmLabel={t('actions.delete')}
      />
    </div>
  )
}
