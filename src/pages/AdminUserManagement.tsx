import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, Search } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, DatePicker, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Detail, Field, Loading, PageHeader } from '@/components/ui/page'
import { adminOperations, type UserRow } from '@/lib/adminOperations'
import { dateBounds, errorMessage, formatDate, formatDateTime, naira, type DateFilter } from '@/lib/utils'

const PER_PAGE = 20
const STATUSES = ['Registered', 'Checked In', 'Absent'] as const

function StatusSelect({ user, onChange }: { user: UserRow; onChange: (u: UserRow, s: string) => void }) {
  if (!user.event_status) return <span className="text-muted-foreground">N/A</span>
  return (
    <Select
      ariaLabel={`Event status for ${user.name}`}
      value={user.event_status}
      onValueChange={(v) => onChange(user, v)}
      options={STATUSES.map((s) => ({ value: s, label: s }))}
      className="h-8 min-w-32"
    />
  )
}

export default function AdminUserManagement() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [action, setAction] = useState('suspend')
  const [notifyText, setNotifyText] = useState('')
  const [actionMsg, setActionMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => setPage(1), [category, dateFilter, customStart, customEnd, debounced])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateBounds(dateFilter, customStart, customEnd)
      const res = await adminOperations.getUsers({ page, perPage: PER_PAGE, category, start, end, search: debounced })
      setUsers(res.rows || [])
      setTotal(res.total || 0)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [page, category, dateFilter, customStart, customEnd, debounced])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const changeStatus = async (user: UserRow, status: string) => {
    setError(null)
    if (!user.event_type || !user.event_id) {
      setError('Event type or ID missing for status update.')
      return
    }
    console.log('Updating status', { user: user.id, type: user.event_type, event: user.event_id, status })
    const prev = user.event_status
    const apply = (s: UserRow['event_status']) => {
      setUsers((list) => list.map((u) => (u.id === user.id ? { ...u, event_status: s } : u)))
      setSelected((sel) => (sel && sel.id === user.id ? { ...sel, event_status: s } : sel))
    }
    apply(status as UserRow['event_status'])
    try {
      await adminOperations.updateUserStatus(user.id, user.event_type, user.event_id, status)
    } catch (e) {
      console.error('Status update failed', e)
      apply(prev)
      setError(errorMessage(e))
    }
  }

  const performAction = async () => {
    if (!selected) return
    setBusy(true)
    setActionMsg(null)
    const targetTable = selected.event_type === 'match' ? 'user_joined_matches' : selected.event_type === 'cycling' ? 'user_joined_cycling' : 'profiles'
    try {
      if (action === 'reset_password') {
        if (!selected.email) throw new Error('This user has no email address.')
        await adminOperations.sendPasswordReset(selected.email, false)
      }
      if (action === 'send_notification') {
        if (!notifyText.trim()) throw new Error('Write a message first.')
        await adminOperations.sendNotification({ type: 'push', target: 'user', targetId: selected.id, title: 'Message from Sport Cliq', message: notifyText.trim() })
      }
      await adminOperations.performCustomAction(selected.id, action, targetTable)
      if (action === 'suspend' || action === 'activate') {
        const status = action === 'suspend' ? 'suspended' : 'active'
        setUsers((list) => list.map((u) => (u.id === selected.id ? { ...u, account_status: status } : u)))
        setSelected({ ...selected, account_status: status })
      }
      setNotifyText('')
      setActionMsg({ kind: 'success', text: 'Action completed.' })
    } catch (e) {
      console.error(e)
      setActionMsg({ kind: 'error', text: `Failed to perform action. ${errorMessage(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<UserRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        cell: (u) => (
          <div>
            <p className="font-semibold">{u.name || 'Unnamed'}</p>
            {u.account_status && u.account_status !== 'active' ? <Badge variant="danger">{u.account_status}</Badge> : null}
          </div>
        ),
      },
      { key: 'event', header: 'Event', cell: (u) => u.event_title || 'N/A' },
      { key: 'venue', header: 'Venue/Landmark', cell: (u) => u.location || 'N/A', hideOnMobile: true, wideOnly: true },
      { key: 'value', header: 'Value', cell: (u) => (u.event_title ? naira(u.value) : 'N/A'), hideOnMobile: true, wideOnly: true },
      { key: 'slots', header: 'Slots Paid For', cell: (u) => u.slots ?? 'N/A', hideOnMobile: true },
      { key: 'status', header: 'Status', cell: (u) => <StatusSelect user={u} onChange={changeStatus} /> },
      { key: 'earned', header: 'Total Earned', cell: (u) => naira(u.total_earned) },
      { key: 'spent', header: 'Total Spent', cell: (u) => naira(u.total_spent), hideOnMobile: true, wideOnly: true },
      { key: 'code', header: 'Super Code', cell: (u) => u.super_code || 'N/A', hideOnMobile: true, wideOnly: true },
      { key: 'cashout', header: 'Last Cashout', cell: (u) => formatDate(u.last_cashout), hideOnMobile: true, wideOnly: true },
      { key: 'activity', header: 'Last Activity', cell: (u) => formatDate(u.last_activity), hideOnMobile: true },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <AdminLayout>
      <PageHeader title="Users" description="Search users, track event status and manage accounts." />

      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 pt-5 md:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search users" placeholder="Name, super code, confirmation code or PIN" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select
            ariaLabel="Category"
            value={category}
            onValueChange={setCategory}
            options={[
              { value: 'all', label: 'All categories' },
              { value: 'organizer', label: 'Organizer' },
              { value: 'host', label: 'Host' },
              { value: 'cycler', label: 'Cycler' },
              { value: 'player', label: 'Player' },
              { value: 'venue_owner', label: 'Venue Owner' },
            ]}
          />
          <Select
            ariaLabel="Date joined"
            value={dateFilter}
            onValueChange={(v) => setDateFilter(v as DateFilter)}
            options={[
              { value: 'all', label: 'No date filter' },
              { value: 'today', label: 'Today' },
              { value: '7days', label: 'Last 7 days' },
              { value: 'custom', label: 'Custom range' },
            ]}
          />
          {dateFilter === 'custom' ? (
            <div className="grid grid-cols-2 gap-3 md:col-span-3 md:max-w-md">
              <DatePicker label="Start date" value={customStart} onChange={setCustomStart} />
              <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>
            Users ({users.length} of {total.toLocaleString()})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              columns={columns}
              rows={users}
              rowKey={(u) => u.id}
              actions={(u) => (
                <Button variant="ghost" size="icon" aria-label={`View ${u.name}`} onClick={() => { setSelected(u); setActionMsg(null) }}>
                  <Eye />
                </Button>
              )}
            />
          )}
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft /> Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name || 'Unnamed user'}</DialogTitle>
                <DialogDescription>Account details, activity and admin actions.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Detail label="Name">{selected.name || 'N/A'}</Detail>
                <Detail label="Email">{selected.email || 'N/A'}</Detail>
                <Detail label="Phone">{selected.phone || 'N/A'}</Detail>
                <Detail label="Category">{selected.categories.length ? selected.categories.join(', ') : 'N/A'}</Detail>
                <Detail label="Events Organized">{selected.events_organized}</Detail>
                <Detail label="Events Participated">{selected.events_participated}</Detail>
                <Detail label="Total Earned">{naira(selected.total_earned)}</Detail>
                <Detail label="Total Spent">{naira(selected.total_spent)}</Detail>
                <Detail label="Super Code">{selected.super_code || 'N/A'}</Detail>
                <Detail label="Last Cashout">{formatDateTime(selected.last_cashout)}</Detail>
                <Detail label="Last Activity">{formatDateTime(selected.last_activity)}</Detail>
                <Detail label="Account Status">{selected.account_status || 'active'}</Detail>
                {selected.event_status ? (
                  <Detail label={`Event Status (${selected.event_title})`}>
                    <StatusSelect user={selected} onChange={changeStatus} />
                  </Detail>
                ) : null}
              </div>
              <div className="mt-5">
                <p className="mb-2 text-xs text-muted-foreground">Badges</p>
                <div className="flex flex-wrap gap-2">
                  {selected.badges.length ? selected.badges.map((b) => <Badge key={b} variant="outline">{b}</Badge>) : <span className="text-sm text-muted-foreground">No badges yet</span>}
                </div>
              </div>
              <div className="mt-6 space-y-3 border-t pt-5">
                <Field label="Admin action">
                  <Select
                    ariaLabel="Admin action"
                    value={action}
                    onValueChange={setAction}
                    options={[
                      { value: 'suspend', label: 'Suspend User' },
                      { value: 'activate', label: 'Activate User' },
                      { value: 'reset_password', label: 'Reset Password' },
                      { value: 'send_notification', label: 'Send Notification' },
                    ]}
                  />
                </Field>
                {action === 'send_notification' ? (
                  <Field label="Message">
                    <Textarea maxLength={500} value={notifyText} onChange={(e) => setNotifyText(e.target.value)} />
                  </Field>
                ) : null}
                {actionMsg ? <Alert variant={actionMsg.kind}>{actionMsg.text}</Alert> : null}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
                <Button onClick={performAction} disabled={busy}>{busy ? 'Working...' : 'Perform Action'}</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  )
}
