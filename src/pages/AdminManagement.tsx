import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, KeyRound, Plus, RefreshCw, Shield, ShieldCheck, ShieldOff, UserCheck, UserX, Users } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Field, Input, SearchInput } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Menu } from '@/components/ui/menu'
import { Alert, useConfirm, useToast } from '@/components/ui/feedback'
import { EmptyState, Loading, PageHeader, Pagination, StatTile, usePaged } from '@/components/ui/page'
import { useAdminSession } from '@/hooks/useAdminSession'
import { adminOperations, type AdminRow } from '@/lib/adminOperations'
import { cn, errorMessage, formatDate, formatDateTime } from '@/lib/utils'

const isSuperRole = (r: string) => r.toLowerCase().replace(/[^a-z]/g, '') === 'superadmin'
const isActive = (s: string) => s.toLowerCase() === 'active'
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  return Array.from(arr, (n) => chars[n % chars.length]).join('') + '!7'
}

export default function AdminManagement() {
  const session = useAdminSession()
  const confirm = useConfirm()
  const toast = useToast()
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', role: 'admin', firstName: '', lastName: '' })
  const [showPw, setShowPw] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAdmins((await adminOperations.getAdmins()) || [])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session?.role === 'super_admin') load()
  }, [load, session?.role])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return admins.filter((a) => !q || `${a.email} ${a.first_name ?? ''} ${a.last_name ?? ''}`.toLowerCase().includes(q))
  }, [admins, search])
  const { pageRows, pagination } = usePaged(filtered, 10)

  if (session?.role !== 'super_admin') {
    return (
      <AdminLayout>
        <Card className="mx-auto mt-10 max-w-md p-10 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-red-50 text-red-500 dark:bg-red-950"><Shield className="h-8 w-8" /></span>
          <h1 className="mt-5 text-xl font-extrabold">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">Only super admins can manage administrator accounts. Ask a super admin if you need a change.</p>
        </Card>
      </AdminLayout>
    )
  }

  const self = (a: AdminRow) => a.email.toLowerCase() === session.email.toLowerCase()

  const toggle = async (a: AdminRow) => {
    const next = isActive(a.status) ? 'inactive' : 'active'
    const { ok } = await confirm({
      title: next === 'inactive' ? `Deactivate ${a.email}?` : `Activate ${a.email}?`,
      description: next === 'inactive' ? 'They will be signed out of the admin portal and cannot sign in until activated.' : 'They will be able to sign in again.',
      confirmText: next === 'inactive' ? 'Deactivate' : 'Activate', tone: next === 'inactive' ? 'danger' : 'success',
    })
    if (!ok) return
    try {
      await adminOperations.setAdminStatus(a.id, next)
      setAdmins((list) => list.map((x) => (x.id === a.id ? { ...x, status: next } : x)))
      toast.success(next === 'inactive' ? 'Admin deactivated' : 'Admin activated')
    } catch (e) {
      toast.error('Could not update', errorMessage(e))
    }
  }

  const changeRole = async (a: AdminRow) => {
    const next = isSuperRole(a.role) ? 'admin' : 'super_admin'
    const { ok } = await confirm({
      title: next === 'super_admin' ? `Make ${a.email} a super admin?` : `Make ${a.email} a regular admin?`,
      description: next === 'super_admin' ? 'Super admins can manage admins, delete venues and events, and change settings.' : 'They lose access to admin management and settings.',
      confirmText: 'Change role', icon: <ShieldCheck />,
    })
    if (!ok) return
    try {
      await adminOperations.setAdminRole(a.id, next)
      setAdmins((list) => list.map((x) => (x.id === a.id ? { ...x, role: next } : x)))
      toast.success('Role updated')
    } catch (e) {
      toast.error('Could not change role', errorMessage(e))
    }
  }

  const resetPassword = async (a: AdminRow) => {
    const { ok } = await confirm({ title: 'Send password reset?', description: `A reset link goes to ${a.email}.`, confirmText: 'Send link', icon: <KeyRound /> })
    if (!ok) return
    try {
      await adminOperations.sendPasswordReset(a.email, true)
      await adminOperations.log('admin_management', `Sent password reset to ${a.email}`)
      toast.success('Reset link sent', a.email)
    } catch (e) {
      toast.error('Could not send', errorMessage(e))
    }
  }

  const create = async () => {
    setCreateError(null)
    if (!EMAIL_RE.test(form.email.trim())) return setCreateError('Enter a valid email address.')
    if (form.password.length < 8) return setCreateError('Temporary password must be at least 8 characters.')
    setBusy(true)
    try {
      const res = await adminOperations.createAdmin({ email: form.email.trim().toLowerCase(), password: form.password, role: form.role, firstName: form.firstName.trim(), lastName: form.lastName.trim() })
      setOpen(false)
      setForm({ email: '', password: '', role: 'admin', firstName: '', lastName: '' })
      toast.success('Admin created', res.existed ? 'This email already had a login, so they keep their existing password.' : 'Share the temporary password privately.')
      load()
    } catch (e) {
      setCreateError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<AdminRow>[] = [
    {
      key: 'email', header: 'Admin', sort: (a) => a.email,
      cell: (a) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={[a.first_name, a.last_name].filter(Boolean).join(' ') || a.email} className="h-10 w-10" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-bold">{[a.first_name, a.last_name].filter(Boolean).join(' ') || a.email.split('@')[0]}{self(a) ? <Badge variant="dark">You</Badge> : null}</p>
            <p className="truncate text-xs text-muted-foreground">{a.email}</p>
            {!a.linked ? <p className="text-[11px] font-semibold text-amber-600">Old record, not linked to a login</p> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'role', header: 'Role', sort: (a) => a.role,
      cell: (a) => (
        <span className={cn('inline-flex items-center gap-1.5 text-sm font-semibold capitalize', isSuperRole(a.role) && 'text-blue-600 dark:text-blue-400')}>
          {isSuperRole(a.role) ? <ShieldCheck className="h-4 w-4" /> : <Shield className="h-4 w-4 text-muted-foreground" />}
          {a.role.replace(/_/g, ' ')}
        </span>
      ),
    },
    { key: 'status', header: 'Status', sort: (a) => a.status, cell: (a) => <StatusBadge status={a.status} /> },
    { key: 'login', header: 'Last Login', sort: (a) => a.last_login, cell: (a) => formatDateTime(a.last_login), hideOnMobile: true },
    { key: 'created', header: 'Created', sort: (a) => a.created_at, cell: (a) => formatDate(a.created_at), hideOnMobile: true },
  ]

  return (
    <AdminLayout>
      <PageHeader eyebrow="System" title="Admins" description="Control who can access the admin portal.">
        <Button onClick={() => { setOpen(true); setCreateError(null); setForm((f) => ({ ...f, password: tempPassword() })) }}><Plus /> Add Admin</Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatTile tone="blue" label="Super Admins" value={<span className="text-blue-600">{admins.filter((a) => isSuperRole(a.role)).length}</span>} icon={<ShieldCheck />} />
        <StatTile tone="green" label="Active Admins" value={<span className="text-green-600">{admins.filter((a) => isActive(a.status)).length}</span>} icon={<UserCheck />} />
        <StatTile tone="black" label="Total Admins" value={admins.length} icon={<Users />} />
      </div>

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      <Card>
        <CardHeader icon={<ShieldCheck />} title={`Administrators (${filtered.length})`} action={<SearchInput value={search} onChange={setSearch} placeholder="Search admins" className="hidden w-56 sm:block" />} />
        <CardContent>
          {loading ? <Loading /> : (
            <DataTable columns={columns} rows={pageRows} rowKey={(a) => a.id} empty={<EmptyState icon={<Users />} title="No admins found" />}
              actions={(a) => (
                <Menu items={[
                  { label: 'Send password reset', icon: <KeyRound />, onSelect: () => resetPassword(a) },
                  { label: isSuperRole(a.role) ? 'Make regular admin' : 'Make super admin', icon: isSuperRole(a.role) ? <ShieldOff /> : <ShieldCheck />, onSelect: () => changeRole(a), disabled: self(a) },
                  'separator',
                  isActive(a.status)
                    ? { label: self(a) ? 'You cannot deactivate yourself' : 'Deactivate', icon: <UserX />, tone: 'danger', onSelect: () => toggle(a), disabled: self(a) }
                    : { label: 'Activate', icon: <UserCheck />, tone: 'success', onSelect: () => toggle(a) },
                ]} />
              )} />
          )}
          <Pagination {...pagination} />
        </CardContent>
      </Card>

      <Modal
        open={open}
        onOpenChange={setOpen}
        icon={<Plus />}
        title="Add admin"
        description="They sign in with this email and the temporary password, then change it from their profile."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} loading={busy} disabled={!form.email.trim() || !form.password}>Create Admin</Button></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor="a-first"><Input id="a-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
            <Field label="Last name" htmlFor="a-last"><Input id="a-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          </div>
          <Field label="Email" htmlFor="a-email"><Input id="a-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Temporary password" htmlFor="a-pass" hint="Generated for you. Copy it before you create the admin.">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input id="a-pass" type={showPw ? 'text' : 'password'} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="pr-11 font-mono" />
                <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted">{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Generate a new password" onClick={() => setForm({ ...form, password: tempPassword() })}><RefreshCw /></Button>
            </div>
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-gray-700 dark:text-gray-300">Role</p>
            <div className="grid grid-cols-2 gap-2">
              {[{ v: 'admin', l: 'Admin', d: 'Day to day operations', i: Shield }, { v: 'super_admin', l: 'Super Admin', d: 'Full control', i: ShieldCheck }].map((r) => (
                <button key={r.v} type="button" aria-pressed={form.role === r.v} onClick={() => setForm({ ...form, role: r.v })}
                  className={cn('flex cursor-pointer flex-col items-start gap-1 rounded-2xl border-2 p-3 text-left transition-all', form.role === r.v ? 'border-primary bg-playarena-50 dark:bg-playarena-950' : 'border-transparent bg-muted hover:bg-gray-200 dark:hover:bg-gray-800')}>
                  <r.i className={cn('h-5 w-5', form.role === r.v ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="text-sm font-bold">{r.l}</span>
                  <span className="text-xs text-muted-foreground">{r.d}</span>
                </button>
              ))}
            </div>
          </div>
          {createError ? <Alert>{createError}</Alert> : null}
        </div>
      </Modal>
    </AdminLayout>
  )
}
