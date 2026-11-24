import { useCallback, useEffect, useState } from 'react'
import { Plus, RotateCcw, Shield, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorText, Field, Loading, PageHeader } from '@/components/ui/page'
import { useAdminSession } from '@/hooks/useAdminSession'
import { adminOperations, type AdminRow } from '@/lib/adminOperations'
import { errorMessage, formatDate, formatDateTime, shortId } from '@/lib/utils'

const isSuperRole = (r: string) => r.toLowerCase().replace(/[^a-z]/g, '') === 'superadmin'
const isActive = (s: string) => s.toLowerCase() === 'active'

export default function AdminManagement() {
  const session = useAdminSession()
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', role: 'admin', firstName: '', lastName: '' })
  const [createError, setCreateError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

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

  if (session?.role !== 'super_admin') {
    return (
      <AdminLayout>
        <Card className="mx-auto mt-10 max-w-md p-8 text-center">
          <Shield className="mx-auto h-12 w-12 text-red-500" />
          <h1 className="mt-4 text-xl font-bold">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">Only super admins can manage administrator accounts. Ask a super admin if you need a change.</p>
        </Card>
      </AdminLayout>
    )
  }

  const toggle = async (a: AdminRow) => {
    setBusy(a.id)
    setError(null)
    try {
      const next = isActive(a.status) ? 'inactive' : 'active'
      await adminOperations.setAdminStatus(a.id, next)
      setAdmins((list) => list.map((x) => (x.id === a.id ? { ...x, status: next } : x)))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const resetPassword = async (a: AdminRow) => {
    setBusy(a.id)
    setError(null)
    setNotice(null)
    try {
      await adminOperations.sendPasswordReset(a.email, true)
      await adminOperations.log('admin_management', `Sent password reset to ${a.email}`)
      setNotice(`Password reset email sent to ${a.email}.`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const create = async () => {
    setBusy('create')
    setCreateError(null)
    try {
      await adminOperations.createAdmin({ email: form.email.trim(), password: form.password, role: form.role, firstName: form.firstName.trim(), lastName: form.lastName.trim() })
      setOpen(false)
      setForm({ email: '', password: '', role: 'admin', firstName: '', lastName: '' })
      setNotice('Admin created. Share the temporary password privately and ask them to change it after first sign in.')
      await load()
    } catch (e) {
      setCreateError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<AdminRow>[] = [
    { key: 'id', header: 'ID', cell: (a) => <span className="font-mono text-xs">{shortId(a.id)}</span>, hideOnMobile: true },
    {
      key: 'email',
      header: 'Email',
      cell: (a) => (
        <div>
          <p className="font-semibold">{a.email}</p>
          {!a.linked ? <p className="text-xs text-yellow-600">Not linked to a login yet</p> : null}
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (a) => (
        <span className="inline-flex items-center gap-1.5 capitalize">
          {isSuperRole(a.role) ? <ShieldCheck className="h-4 w-4 text-blue-600" /> : <Shield className="h-4 w-4 text-muted-foreground" />}
          {a.role.replace(/_/g, ' ')}
        </span>
      ),
    },
    { key: 'status', header: 'Status', cell: (a) => <Badge variant={isActive(a.status) ? 'default' : 'destructive'} className="capitalize">{a.status}</Badge> },
    { key: 'login', header: 'Last Login', cell: (a) => formatDateTime(a.last_login), hideOnMobile: true },
    { key: 'created', header: 'Created', cell: (a) => formatDate(a.created_at), hideOnMobile: true },
  ]

  const self = (a: AdminRow) => a.email.toLowerCase() === session.email.toLowerCase()

  return (
    <AdminLayout>
      <PageHeader title="Admins" description="Control who can access the admin portal.">
        <Button onClick={() => { setOpen(true); setCreateError(null) }}><Plus /> Add Admin</Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-6 text-center"><p className="text-sm text-muted-foreground">Super Admins</p><p className="text-3xl font-bold text-blue-600">{admins.filter((a) => isSuperRole(a.role)).length}</p></Card>
        <Card className="p-6 text-center"><p className="text-sm text-muted-foreground">Active Admins</p><p className="text-3xl font-bold text-green-600">{admins.filter((a) => isActive(a.status)).length}</p></Card>
        <Card className="p-6 text-center"><p className="text-sm text-muted-foreground">Total Admins</p><p className="text-3xl font-bold">{admins.length}</p></Card>
      </div>

      <ErrorText error={error} />
      {notice ? <Alert variant="success" className="mb-4">{notice}</Alert> : null}

      <Card>
        <CardHeader><CardTitle>Administrators ({admins.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              columns={columns}
              rows={admins}
              rowKey={(a) => a.id}
              actions={(a) => (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={self(a) || busy === a.id}
                    aria-label={isActive(a.status) ? `Deactivate ${a.email}` : `Activate ${a.email}`}
                    title={self(a) ? 'You cannot deactivate your own account' : isActive(a.status) ? 'Deactivate' : 'Activate'}
                    onClick={() => toggle(a)}
                  >
                    {isActive(a.status) ? <UserX className="text-red-600" /> : <UserCheck className="text-green-600" />}
                  </Button>
                  <Button variant="ghost" size="icon" disabled={busy === a.id} aria-label={`Reset password for ${a.email}`} title="Send password reset" onClick={() => resetPassword(a)}>
                    <RotateCcw />
                  </Button>
                </>
              )}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add admin</DialogTitle>
            <DialogDescription>They sign in with this email and the temporary password.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" htmlFor="a-first"><Input id="a-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
              <Field label="Last name" htmlFor="a-last"><Input id="a-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
            </div>
            <Field label="Email" htmlFor="a-email"><Input id="a-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Temporary password" htmlFor="a-pass"><Input id="a-pass" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Role">
              <Select ariaLabel="Role" value={form.role} onValueChange={(v) => setForm({ ...form, role: v })} options={[{ value: 'admin', label: 'Admin' }, { value: 'super_admin', label: 'Super Admin' }]} />
            </Field>
            {createError ? <Alert>{createError}</Alert> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={!form.email.trim() || !form.password || busy === 'create'}>{busy === 'create' ? 'Creating...' : 'Create Admin'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  )
}
