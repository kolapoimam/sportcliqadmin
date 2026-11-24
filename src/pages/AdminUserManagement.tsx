import { useCallback, useEffect, useState } from 'react'
import Papa from 'papaparse'
import { Ban, Download, Eye, KeyRound, Pencil, Send, UserCheck, Users } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { DatePicker, Field, Input, SearchInput, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Menu } from '@/components/ui/menu'
import { Alert, useConfirm, useToast } from '@/components/ui/feedback'
import { Detail, EmptyState, FilterBar, Loading, PageHeader, Pagination, Segmented } from '@/components/ui/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { adminOperations, type UserRow } from '@/lib/adminOperations'
import { dateBounds, downloadBlob, errorMessage, formatDate, formatDateTime, naira, type DateFilter } from '@/lib/utils'

const STATUSES = ['Registered', 'Checked In', 'Absent'] as const
const CATEGORIES = [
  { value: 'all', label: 'All users' },
  { value: 'organizer', label: 'Organizers' },
  { value: 'host', label: 'Hosts' },
  { value: 'cycler', label: 'Cyclers' },
  { value: 'player', label: 'Players' },
  { value: 'venue_owner', label: 'Venue Owners' },
]

function StatusSelect({ user, onChange }: { user: UserRow; onChange: (u: UserRow, s: string) => void }) {
  if (!user.event_status) return <span className="text-muted-foreground">N/A</span>
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Select ariaLabel={`Event status for ${user.name}`} value={user.event_status} onValueChange={(v) => onChange(user, v)} options={STATUSES.map((s) => ({ value: s, label: s }))} className="h-9 min-w-[132px] rounded-lg" />
    </div>
  )
}

export default function AdminUserManagement() {
  const confirm = useConfirm()
  const toast = useToast()
  const [users, setUsers] = useState<UserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [category, setCategory] = useState('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', nickname: '', phone: '', state: '' })
  const [messaging, setMessaging] = useState<UserRow | null>(null)
  const [msg, setMsg] = useState({ title: 'Message from Sport Cliq', message: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => setPage(1), [category, dateFilter, customStart, customEnd, debounced, pageSize])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateBounds(dateFilter, customStart, customEnd)
      const res = await adminOperations.getUsers({ page, perPage: pageSize, category, start, end, search: debounced })
      setUsers(res.rows || [])
      setTotal(res.total || 0)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, category, dateFilter, customStart, customEnd, debounced])

  useEffect(() => {
    load()
  }, [load])

  const patch = (id: string, p: Partial<UserRow>) => {
    setUsers((list) => list.map((u) => (u.id === id ? { ...u, ...p } : u)))
    setSelected((s) => (s && s.id === id ? { ...s, ...p } : s))
  }

  const changeStatus = async (user: UserRow, status: string) => {
    if (!user.event_type || !user.event_id) {
      toast.error('Event type or ID missing for status update.')
      return
    }
    console.log('Updating status', { user: user.id, type: user.event_type, event: user.event_id, status })
    const prev = user.event_status
    patch(user.id, { event_status: status as UserRow['event_status'] })
    try {
      await adminOperations.updateUserStatus(user.id, user.event_type, user.event_id, status)
      toast.success(`${user.name || 'User'} marked ${status}`)
    } catch (e) {
      console.error('Status update failed', e)
      patch(user.id, { event_status: prev })
      toast.error('Status not updated', errorMessage(e))
    }
  }

  const targetTable = (u: UserRow) => (u.event_type === 'match' ? 'user_joined_matches' : u.event_type === 'cycling' ? 'user_joined_cycling' : 'profiles')

  const suspendToggle = async (u: UserRow) => {
    const suspend = (u.account_status || 'active') === 'active'
    const { ok } = await confirm({
      title: suspend ? `Suspend ${u.name || 'this user'}?` : `Activate ${u.name || 'this user'}?`,
      description: suspend ? 'Their account will be marked suspended. You can activate it again at any time.' : 'Their account will be active again.',
      confirmText: suspend ? 'Suspend' : 'Activate',
      tone: suspend ? 'danger' : 'success',
    })
    if (!ok) return
    try {
      await adminOperations.performCustomAction(u.id, suspend ? 'suspend' : 'activate', targetTable(u))
      patch(u.id, { account_status: suspend ? 'suspended' : 'active' })
      toast.success(suspend ? 'User suspended' : 'User activated')
    } catch (e) {
      toast.error('Failed to perform action', errorMessage(e))
    }
  }

  const resetPassword = async (u: UserRow) => {
    if (!u.email) return toast.error('This user has no email address')
    const { ok } = await confirm({ title: 'Send password reset?', description: `A reset link goes to ${u.email}.`, confirmText: 'Send link', icon: <KeyRound /> })
    if (!ok) return
    try {
      await adminOperations.sendPasswordReset(u.email, false)
      await adminOperations.performCustomAction(u.id, 'reset_password', targetTable(u))
      toast.success('Reset link sent', u.email)
    } catch (e) {
      toast.error('Failed to perform action', errorMessage(e))
    }
  }

  const openEdit = (u: UserRow) => {
    const [first, ...rest] = (u.name || '').split(' ')
    setEditForm({ first_name: first || '', last_name: rest.join(' '), nickname: '', phone: u.phone || '', state: '' })
    setEditing(u)
  }

  const saveEdit = async () => {
    if (!editing) return
    setBusy(true)
    try {
      const data: Record<string, string> = { first_name: editForm.first_name, last_name: editForm.last_name, phone: editForm.phone }
      if (editForm.nickname) data.nickname = editForm.nickname
      if (editForm.state) data.state = editForm.state
      await adminOperations.updateUser(editing.id, data)
      patch(editing.id, { name: `${editForm.first_name} ${editForm.last_name}`.trim(), phone: editForm.phone || null })
      setEditing(null)
      toast.success('Profile updated')
    } catch (e) {
      toast.error('Could not save', /check constraint/i.test(errorMessage(e)) ? 'Names can only contain letters and phone numbers only digits.' : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const sendMessage = async () => {
    if (!messaging) return
    setBusy(true)
    try {
      await adminOperations.sendNotification({ type: 'push', target: 'user', targetId: messaging.id, title: msg.title.trim(), message: msg.message.trim() })
      await adminOperations.performCustomAction(messaging.id, 'send_notification', targetTable(messaging))
      setMessaging(null)
      setMsg({ title: 'Message from Sport Cliq', message: '' })
      toast.success('Notification sent')
    } catch (e) {
      toast.error('Failed to perform action', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    const csv = Papa.unparse(users.map((u) => ({
      Name: u.name, Email: u.email ?? '', Phone: u.phone ?? '', Categories: u.categories.join(' / '), Event: u.event_title ?? '', Status: u.event_status ?? '',
      'Total Earned': u.total_earned, 'Total Spent': u.total_spent, 'Super Code': u.super_code ?? '', 'Last Activity': formatDateTime(u.last_activity),
    })))
    downloadBlob('﻿' + csv, `users-page-${page}.csv`, 'text/csv;charset=utf-8')
  }

  const rowMenu = (u: UserRow) => (
    <Menu
      items={[
        { label: 'View details', icon: <Eye />, onSelect: () => setSelected(u) },
        { label: 'Edit profile', icon: <Pencil />, onSelect: () => openEdit(u) },
        { label: 'Send notification', icon: <Send />, onSelect: () => setMessaging(u) },
        { label: 'Reset password', icon: <KeyRound />, onSelect: () => resetPassword(u), disabled: !u.email },
        'separator',
        (u.account_status || 'active') === 'active'
          ? { label: 'Suspend user', icon: <Ban />, tone: 'danger', onSelect: () => suspendToggle(u) }
          : { label: 'Activate user', icon: <UserCheck />, tone: 'success', onSelect: () => suspendToggle(u) },
      ]}
    />
  )

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      header: 'User',
      sort: (u) => u.name,
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={u.name || u.email} className="h-10 w-10" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-bold">
              {u.name || 'Unnamed'}
              {u.account_status && u.account_status !== 'active' ? <StatusBadge status={u.account_status} /> : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">{u.email || u.phone || 'No contact'}</p>
          </div>
        </div>
      ),
    },
    { key: 'cat', header: 'Category', cell: (u) => (u.categories.length ? <div className="flex flex-wrap gap-1">{u.categories.slice(0, 2).map((c) => <Badge key={c} variant="secondary">{c}</Badge>)}{u.categories.length > 2 ? <Badge variant="outline">+{u.categories.length - 2}</Badge> : null}</div> : <span className="text-muted-foreground">New</span>), hideOnMobile: true },
    { key: 'event', header: 'Event', sort: (u) => u.event_title, cell: (u) => <span className="line-clamp-2">{u.event_title || 'N/A'}</span> },
    { key: 'venue', header: 'Venue/Landmark', cell: (u) => u.location || 'N/A', hideOnMobile: true, wideOnly: true },
    { key: 'value', header: 'Value', sort: (u) => u.value, cell: (u) => (u.event_title ? naira(u.value) : 'N/A'), hideOnMobile: true, wideOnly: true },
    { key: 'slots', header: 'Slots', cell: (u) => u.slots ?? 'N/A', hideOnMobile: true },
    { key: 'status', header: 'Status', cell: (u) => <StatusSelect user={u} onChange={changeStatus} /> },
    { key: 'earned', header: 'Earned', sort: (u) => u.total_earned, cell: (u) => <span className="font-semibold">{naira(u.total_earned)}</span> },
    { key: 'spent', header: 'Spent', sort: (u) => u.total_spent, cell: (u) => naira(u.total_spent), hideOnMobile: true, wideOnly: true },
    { key: 'code', header: 'Super Code', cell: (u) => (u.super_code ? <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold">{u.super_code}</code> : 'N/A'), hideOnMobile: true, wideOnly: true },
    { key: 'cashout', header: 'Last Cashout', sort: (u) => u.last_cashout, cell: (u) => formatDate(u.last_cashout), hideOnMobile: true, wideOnly: true },
    { key: 'activity', header: 'Last Activity', sort: (u) => u.last_activity, cell: (u) => formatDate(u.last_activity), hideOnMobile: true },
  ]

  return (
    <AdminLayout>
      <PageHeader eyebrow="Manage" title="Users" description="Search players, organizers, hosts and venue owners.">
        <Button variant="outline" onClick={exportCsv} disabled={!users.length}><Download /> Export</Button>
      </PageHeader>

      <Segmented className="mb-4" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ ...c, count: c.value === category && !loading ? total : undefined }))} />

      <FilterBar className="xl:grid-cols-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Name, super code, confirmation code or PIN" className="md:col-span-2 xl:col-span-2" />
        <Select ariaLabel="Date joined" value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)} options={[
          { value: 'all', label: 'Joined any time' }, { value: 'today', label: 'Joined today' }, { value: '7days', label: 'Last 7 days' }, { value: 'custom', label: 'Custom range' },
        ]} />
        {dateFilter === 'custom' ? (
          <div className="grid grid-cols-2 gap-3 md:col-span-2 xl:col-span-3 xl:max-w-md">
            <DatePicker label="Start date" value={customStart} onChange={setCustomStart} />
            <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
          </div>
        ) : null}
      </FilterBar>

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      <Card>
        <CardHeader icon={<Users />} title={`Users (${users.length} of ${total.toLocaleString()})`} description="Tap a user to see everything about them." />
        <CardContent>
          {loading ? (
            <Loading rows={6} />
          ) : (
            <DataTable
              columns={columns}
              rows={users}
              rowKey={(u) => u.id}
              onRowClick={setSelected}
              actions={rowMenu}
              empty={<EmptyState icon={<Users />} title="No users found" text="Try a different category, date or search." />}
            />
          )}
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} sizes={[10, 20, 50, 100]} />
        </CardContent>
      </Card>

      {/* Details */}
      <Modal
        open={Boolean(selected)}
        onOpenChange={(o) => !o && setSelected(null)}
        size="xl"
        title={selected ? <span className="flex items-center gap-3"><Avatar name={selected.name || selected.email} className="h-11 w-11" />{selected.name || 'Unnamed user'}</span> : ''}
        description="Account details, activity and admin actions."
        footer={selected ? (
          <>
            <Button variant="outline" onClick={() => setMessaging(selected)}><Send /> Message</Button>
            <Button variant="outline" onClick={() => openEdit(selected)}><Pencil /> Edit</Button>
            {(selected.account_status || 'active') === 'active'
              ? <Button variant="soft-danger" onClick={() => suspendToggle(selected)}><Ban /> Suspend</Button>
              : <Button variant="soft" onClick={() => suspendToggle(selected)}><UserCheck /> Activate</Button>}
          </>
        ) : null}
      >
        {selected ? (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Detail label="Name">{selected.name || 'N/A'}</Detail>
                <Detail label="Email">{selected.email || 'N/A'}</Detail>
                <Detail label="Phone">{selected.phone || 'N/A'}</Detail>
                <Detail label="Category">{selected.categories.length ? selected.categories.join(', ') : 'N/A'}</Detail>
                <Detail label="Account Status"><StatusBadge status={selected.account_status || 'active'} /></Detail>
                <Detail label="Joined">{formatDate(selected.created_at)}</Detail>
              </div>
              <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Badges</p>
              <div className="flex flex-wrap gap-2">
                {selected.badges.length ? selected.badges.map((b) => <Badge key={b} variant="outline">{b}</Badge>) : <span className="text-sm text-muted-foreground">No badges yet</span>}
              </div>
            </TabsContent>
            <TabsContent value="activity">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <Detail label="Events Organized">{selected.events_organized}</Detail>
                <Detail label="Events Participated">{selected.events_participated}</Detail>
                <Detail label="Total Earned">{naira(selected.total_earned)}</Detail>
                <Detail label="Total Spent">{naira(selected.total_spent)}</Detail>
                <Detail label="Super Code">{selected.super_code || 'N/A'}</Detail>
                <Detail label="Access PIN">{selected.access_pin || 'N/A'}</Detail>
                <Detail label="Last Cashout">{formatDateTime(selected.last_cashout)}</Detail>
                <Detail label="Last Activity">{formatDateTime(selected.last_activity)}</Detail>
                <Detail label="Confirmation Code">{selected.confirmation_code || 'N/A'}</Detail>
              </div>
              {selected.event_status ? (
                <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-playarena-50 p-4 sm:flex-row sm:items-center dark:bg-playarena-950/50">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">Latest event</p>
                    <p className="font-bold">{selected.event_title}</p>
                    <p className="text-xs text-muted-foreground">{selected.location} · {selected.slots} slot(s) · {naira(selected.value)}</p>
                  </div>
                  <StatusSelect user={selected} onChange={changeStatus} />
                </div>
              ) : null}
              <Button variant="outline" className="mt-4" onClick={() => resetPassword(selected)} disabled={!selected.email}><KeyRound /> Send password reset</Button>
            </TabsContent>
          </Tabs>
        ) : null}
      </Modal>

      {/* Edit */}
      <Modal
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        icon={<Pencil />}
        title="Edit profile"
        description="Names use letters only. Leave fields you do not want to change."
        footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveEdit} loading={busy}>Save changes</Button></>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="e-first"><Input id="e-first" value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} /></Field>
          <Field label="Last name" htmlFor="e-last"><Input id="e-last" value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} /></Field>
          <Field label="Nickname" htmlFor="e-nick"><Input id="e-nick" value={editForm.nickname} onChange={(e) => setEditForm({ ...editForm, nickname: e.target.value })} /></Field>
          <Field label="Phone" htmlFor="e-phone"><Input id="e-phone" inputMode="numeric" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="State" htmlFor="e-state" className="sm:col-span-2"><Input id="e-state" value={editForm.state} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} placeholder="e.g. Kwara" /></Field>
        </div>
      </Modal>

      {/* Message */}
      <Modal
        open={Boolean(messaging)}
        onOpenChange={(o) => !o && setMessaging(null)}
        icon={<Send />}
        title={`Message ${messaging?.name || 'user'}`}
        description="Sends a push notification to this user."
        footer={<><Button variant="outline" onClick={() => setMessaging(null)}>Cancel</Button><Button onClick={sendMessage} loading={busy} disabled={!msg.message.trim()}>Send</Button></>}
      >
        <div className="space-y-4">
          <Field label="Title" htmlFor="m-title"><Input id="m-title" maxLength={120} value={msg.title} onChange={(e) => setMsg({ ...msg, title: e.target.value })} /></Field>
          <Field label={`Message (${msg.message.length}/500)`} htmlFor="m-body"><Textarea id="m-body" maxLength={500} value={msg.message} onChange={(e) => setMsg({ ...msg, message: e.target.value })} /></Field>
        </div>
      </Modal>
    </AdminLayout>
  )
}
