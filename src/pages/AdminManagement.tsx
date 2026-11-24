import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, KeyRound, Mail, MailPlus, Shield, ShieldCheck, ShieldOff, Smartphone, UserCheck, UserCog, UserX, Users, XCircle } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Field, Input, SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Menu } from '@/components/ui/menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, useConfirm, useStepUp, useToast } from '@/components/ui/feedback'
import { EmptyState, Loading, PageHeader, Pagination, StatTile, usePaged } from '@/components/ui/page'
import { useAdminSession, useCan } from '@/hooks/useAdminSession'
import { adminOperations, type AdminRow, type InviteRow, type RoleRow } from '@/lib/adminOperations'
import { SITE_URL } from '@/lib/supabase'
import { errorMessage, formatDate, formatDateTime } from '@/lib/utils'

const isActive = (s: string) => s.toLowerCase() === 'active'
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export default function AdminManagement() {
  const session = useAdminSession()
  const can = useCan()
  const confirm = useConfirm()
  const stepUp = useStepUp()
  const toast = useToast()
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', roleId: '' })
  const [created, setCreated] = useState<{ link: string; email: string; role: string; emailed: 'sending' | 'sent' | 'failed' | null; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [roleFor, setRoleFor] = useState<AdminRow | null>(null)
  const [roleChoice, setRoleChoice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [a, i, r] = await Promise.all([adminOperations.getAdmins(), adminOperations.listInvites(), adminOperations.listRoles()])
      setAdmins(a || [])
      setInvites(i || [])
      setRoles(r.roles || [])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return admins.filter((a) => !q || `${a.email} ${a.first_name ?? ''} ${a.last_name ?? ''} ${a.role_name ?? ''}`.toLowerCase().includes(q))
  }, [admins, search])
  const { pageRows, pagination } = usePaged(filtered, 10)
  const pendingInvites = invites.filter((i) => i.status === 'pending')

  const self = (a: AdminRow) => a.email.toLowerCase() === (session?.email ?? '').toLowerCase()
  const isSuperUser = (session?.permissions ?? []).includes('*')
  const roleOptions = roles.filter((r) => r.key !== 'super_admin' || isSuperUser).map((r) => ({ value: r.id, label: r.name }))

  const openInvite = () => {
    setCreated(null)
    setForm({ email: '', firstName: '', lastName: '', roleId: roles.find((r) => r.key === 'admin')?.id ?? roles[0]?.id ?? '' })
    setInviteOpen(true)
  }

  const sendInvite = async () => {
    if (!EMAIL_RE.test(form.email.trim())) return toast.error('Enter a valid email address')
    if (!form.roleId) return toast.error('Pick a role')
    setBusy(true)
    try {
      const inv = await adminOperations.createInvite(form.email.trim(), form.roleId, form.firstName, form.lastName)
      const link = `${SITE_URL}/invite?token=${inv.token}`
      setCreated({ link, email: inv.email, role: inv.role_name, emailed: 'sending' })
      load()
      try {
        await adminOperations.emailInvite({ email: inv.email, link, role_name: inv.role_name, inviter: session?.first_name || session?.email || 'A SportCliq admin' })
        setCreated((c) => (c ? { ...c, emailed: 'sent' } : c))
      } catch (e) {
        setCreated((c) => (c ? { ...c, emailed: 'failed', error: errorMessage(e) } : c))
      }
    } catch (e) {
      toast.error('Could not create invite', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (i: InviteRow) => {
    const { ok } = await confirm({ title: `Cancel the invite for ${i.email}?`, description: 'The link stops working straight away.', confirmText: 'Cancel invite', tone: 'danger', cancelText: 'Keep it' })
    if (!ok) return
    try {
      await adminOperations.revokeInvite(i.id)
      toast.success('Invite cancelled')
      load()
    } catch (e) {
      toast.error('Could not cancel', errorMessage(e))
    }
  }

  const toggle = async (a: AdminRow) => {
    const next = isActive(a.status) ? 'inactive' : 'active'
    const { ok } = await confirm({
      title: next === 'inactive' ? `Deactivate ${a.email}?` : `Activate ${a.email}?`,
      description: next === 'inactive' ? 'They lose access to the admin portal straight away.' : 'They will be able to sign in again.',
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

  const saveRole = async () => {
    if (!roleFor || !roleChoice) return
    setBusy(true)
    try {
      await adminOperations.assignRole(roleFor.id, roleChoice)
      toast.success('Role updated')
      setRoleFor(null)
      load()
    } catch (e) {
      toast.error('Could not change role', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const resetMfa = async (a: AdminRow) => {
    const { ok } = await confirm({ title: `Reset two factor for ${a.email}?`, description: 'Their authenticator is removed. They will set up a new one at their next sign in. Only do this after checking who is asking.', confirmText: 'Reset two factor', tone: 'danger', icon: <Smartphone /> })
    if (!ok) return
    if (!(await stepUp('reset this admin\'s two factor'))) return
    try {
      await adminOperations.resetAdminMfa(a.id)
      toast.success('Two factor reset')
      load()
    } catch (e) {
      toast.error('Could not reset', errorMessage(e))
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

  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.info('Invite link copied'))

  const columns: Column<AdminRow>[] = [
    {
      key: 'email', header: 'Admin', sort: (a) => a.email,
      cell: (a) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={a.avatar_url} name={[a.first_name, a.last_name].filter(Boolean).join(' ') || a.email} className="h-10 w-10" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-bold">{[a.first_name, a.last_name].filter(Boolean).join(' ') || a.email.split('@')[0]}{self(a) ? <Badge variant="dark">You</Badge> : null}</p>
            <p className="truncate text-xs text-muted-foreground">{a.email}</p>
            {!a.linked ? <p className="text-[11px] font-semibold text-amber-600">Old record, not linked to a login</p> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'role', header: 'Role', sort: (a) => a.role_name,
      cell: (a) => (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          {a.role_key === 'super_admin' ? <ShieldCheck className="h-4 w-4 text-blue-600" /> : <Shield className="h-4 w-4 text-muted-foreground" />}
          {a.role_name ?? a.role}
        </span>
      ),
    },
    { key: 'status', header: 'Status', sort: (a) => a.status, cell: (a) => <StatusBadge status={a.status} /> },
    {
      key: 'security', header: 'Security',
      cell: (a) => (
        <div className="flex flex-wrap gap-1">
          {a.mfa_enabled ? <Badge variant="success"><Smartphone /> 2FA on</Badge> : <Badge variant="warning"><Smartphone /> 2FA not set</Badge>}
          {a.providers?.includes('google') ? <Badge variant="info">Google</Badge> : null}
          {a.providers?.includes('email') ? <Badge variant="secondary">Password</Badge> : null}
        </div>
      ),
    },
    { key: 'login', header: 'Last Login', sort: (a) => a.last_login, cell: (a) => formatDateTime(a.last_login), hideOnMobile: true },
    { key: 'created', header: 'Created', sort: (a) => a.created_at, cell: (a) => formatDate(a.created_at), hideOnMobile: true, wideOnly: true },
  ]

  return (
    <AdminLayout perm="admins.view">
      <PageHeader eyebrow="System" title="Admins" description="Invite people, give them roles and keep access tight.">
        {can('admins.invite') ? <Button onClick={openInvite}><MailPlus /> Invite admin</Button> : null}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="blue" label="Super Admins" value={admins.filter((a) => a.role_key === 'super_admin').length} icon={<ShieldCheck />} />
        <StatTile tone="green" label="Active Admins" value={admins.filter((a) => isActive(a.status)).length} icon={<UserCheck />} />
        <StatTile tone="amber" label="Pending Invites" value={pendingInvites.length} icon={<Mail />} />
        <StatTile tone="rose" label="Without 2FA" value={admins.filter((a) => isActive(a.status) && a.linked && !a.mfa_enabled).length} icon={<Smartphone />} hint="Set up at next sign in" />
      </div>

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      <Tabs defaultValue="admins">
        <TabsList>
          <TabsTrigger value="admins">Admins ({admins.length})</TabsTrigger>
          <TabsTrigger value="invites">Invites ({pendingInvites.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="admins">
          <Card>
            <CardHeader icon={<ShieldCheck />} title={`Administrators (${filtered.length})`} action={<SearchInput value={search} onChange={setSearch} placeholder="Search admins" className="hidden w-56 sm:block" />} />
            <CardContent>
              {loading ? <Loading /> : (
                <DataTable columns={columns} rows={pageRows} rowKey={(a) => a.id} empty={<EmptyState icon={<Users />} title="No admins found" />}
                  actions={(a) => (
                    <Menu items={[
                      { label: 'Change role', icon: <UserCog />, onSelect: () => { setRoleFor(a); setRoleChoice(a.role_id ?? '') }, hidden: !can('admins.edit') || self(a) },
                      { label: 'Send password reset', icon: <KeyRound />, onSelect: () => resetPassword(a), hidden: !can('admins.edit') },
                      { label: 'Reset two factor', icon: <ShieldOff />, onSelect: () => resetMfa(a), hidden: !can('admins.reset_2fa') || self(a) || !a.mfa_enabled },
                      'separator',
                      isActive(a.status)
                        ? { label: 'Deactivate', icon: <UserX />, tone: 'danger', onSelect: () => toggle(a), hidden: !can('admins.deactivate') || self(a) }
                        : { label: 'Activate', icon: <UserCheck />, tone: 'success', onSelect: () => toggle(a), hidden: !can('admins.deactivate') },
                    ]} />
                  )} />
              )}
              <Pagination {...pagination} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="invites">
          <Card>
            <CardHeader icon={<Mail />} title="Invites" description="Links last 7 days. Cancel any you no longer need." />
            <CardContent>
              <DataTable rows={invites} rowKey={(i) => i.id} empty={<EmptyState icon={<Mail />} title="No invites yet" action={can('admins.invite') ? <Button onClick={openInvite}><MailPlus /> Invite admin</Button> : undefined} />}
                columns={[
                  { key: 'email', header: 'Invitee', cell: (i) => <div className="flex items-center gap-3"><Avatar name={[i.first_name, i.last_name].filter(Boolean).join(' ') || i.email} className="h-9 w-9" /><div className="min-w-0"><p className="truncate font-bold">{[i.first_name, i.last_name].filter(Boolean).join(' ') || i.email}</p><p className="truncate text-xs text-muted-foreground">{i.email}</p></div></div> },
                  { key: 'role', header: 'Role', cell: (i) => i.role_name ?? 'N/A' },
                  { key: 'status', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
                  { key: 'by', header: 'Invited by', cell: (i) => i.invited_by ?? 'N/A', hideOnMobile: true },
                  { key: 'expires', header: 'Expires', cell: (i) => formatDate(i.expires_at), hideOnMobile: true },
                ]}
                actions={(i) => (i.status === 'pending' && can('admins.invite') ? <Button variant="soft-danger" size="sm" onClick={() => revoke(i)}><XCircle /> Cancel</Button> : null)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Modal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        icon={<MailPlus />}
        title={created ? 'Invite ready' : 'Invite an admin'}
        description={created ? `For ${created.email} as ${created.role}` : 'They choose a password or Google, then set up two factor.'}
        footer={created ? <Button onClick={() => setInviteOpen(false)}>Done</Button> : <><Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button><Button onClick={sendInvite} loading={busy} disabled={!form.email.trim() || !form.roleId}>Create invite</Button></>}
      >
        {created ? (
          <div className="space-y-4">
            {created.emailed === 'sent' ? <Alert variant="success">Invite email sent to {created.email}.</Alert>
              : created.emailed === 'failed' ? <Alert variant="warning">The email could not be sent ({created.error}). Copy the link below and send it yourself.</Alert>
              : <Alert variant="info">Sending the invite email.</Alert>}
            <Field label="Invite link" hint="Anyone with this link can accept the invite, so send it privately.">
              <div className="flex gap-2">
                <Input readOnly value={created.link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Copy invite link" onClick={() => copy(created.link)}><Copy /></Button>
              </div>
            </Field>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" htmlFor="i-first"><Input id="i-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
              <Field label="Last name" htmlFor="i-last"><Input id="i-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
            </div>
            <Field label="Email" htmlFor="i-email" hint="Use their Google address if they will sign in with Google."><Input id="i-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <div>
              <p className="mb-2 text-[13px] font-semibold text-gray-700 dark:text-gray-300">Role</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {roles.filter((r) => r.key !== 'super_admin' || isSuperUser).map((r) => (
                  <button key={r.id} type="button" aria-pressed={form.roleId === r.id} onClick={() => setForm({ ...form, roleId: r.id })}
                    className={`flex cursor-pointer items-start gap-2 rounded-2xl border-2 p-3 text-left transition-all ${form.roleId === r.id ? 'border-primary bg-playarena-50 dark:bg-playarena-950' : 'border-transparent bg-muted hover:bg-gray-200 dark:hover:bg-gray-800'}`}>
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${form.roleId === r.id ? 'bg-primary text-white' : 'bg-background ring-1 ring-border'}`}>{form.roleId === r.id ? <Check className="h-3 w-3" /> : null}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">{r.name}</span>
                      <span className="line-clamp-2 block text-xs text-muted-foreground">{r.description || `${r.permissions.length} permissions`}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(roleFor)}
        onOpenChange={(o) => !o && setRoleFor(null)}
        icon={<UserCog />}
        title={`Change role for ${roleFor?.email ?? ''}`}
        description="Their access changes at their next action."
        footer={<><Button variant="outline" onClick={() => setRoleFor(null)}>Cancel</Button><Button onClick={saveRole} loading={busy} disabled={!roleChoice}>Save role</Button></>}
      >
        <Field label="Role"><Select ariaLabel="Role" value={roleChoice} onValueChange={setRoleChoice} options={roleOptions} placeholder="Pick a role" /></Field>
        {roleChoice ? <p className="mt-3 text-sm text-muted-foreground">{roles.find((r) => r.id === roleChoice)?.description}</p> : null}
      </Modal>
    </AdminLayout>
  )
}
