import { useCallback, useEffect, useState } from 'react'
import { Ban, Eye, Pencil, Search, Trash2 } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, DatePicker } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Detail, ErrorText, Field, Loading, PageHeader, StatCard } from '@/components/ui/page'
import { useAdminSession } from '@/hooks/useAdminSession'
import { adminOperations, type EventRow } from '@/lib/adminOperations'
import { dateBounds, errorMessage, formatDate, formatDateTime, naira, shortId, type DateFilter } from '@/lib/utils'

function statusBadge(status: string) {
  const s = status.toLowerCase()
  const variant = s === 'upcoming' ? 'info' : s === 'live' ? 'success' : s === 'cancelled' ? 'danger' : 'secondary'
  return <Badge variant={variant}>{status}</Badge>
}

export default function AdminEvents() {
  const session = useAdminSession()
  const adminRole = session?.role
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('all')
  const [sport, setSport] = useState('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [viewing, setViewing] = useState<EventRow | null>(null)
  const [editing, setEditing] = useState<EventRow | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [confirm, setConfirm] = useState<{ kind: 'cancel' | 'delete'; event: EventRow } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateBounds(dateFilter, customStart, customEnd)
      setEvents((await adminOperations.getEvents({ search: debounced, status, sport, start, end })) || [])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [debounced, status, sport, dateFilter, customStart, customEnd])

  useEffect(() => {
    load()
  }, [load])

  const openEdit = (e: EventRow) => {
    setEditing(e)
    setEditTitle(e.title)
    setEditDate(e.event_date ? new Date(e.event_date).toISOString().slice(0, 10) : '')
  }

  const saveEdit = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await adminOperations.updateEvent(editing.event_type, editing.id, editTitle.trim(), editDate || null)
      setEditing(null)
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const runConfirm = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      if (confirm.kind === 'cancel') await adminOperations.updateEventStatus(confirm.event.event_type, confirm.event.id, 'cancelled')
      else await adminOperations.deleteEvent(confirm.event.event_type, confirm.event.id)
      setConfirm(null)
      await load()
    } catch (e) {
      setError(errorMessage(e))
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  const count = (s: string) => events.filter((e) => e.status.toLowerCase() === s).length

  const columns: Column<EventRow>[] = [
    { key: 'id', header: 'ID', cell: (e) => <span className="font-mono text-xs">{shortId(e.id)}</span>, hideOnMobile: true },
    { key: 'title', header: 'Title', cell: (e) => <span className="font-semibold">{e.title}</span> },
    { key: 'sport', header: 'Sport', cell: (e) => e.sport },
    { key: 'organizer', header: 'Organizer', cell: (e) => e.organizer || 'N/A', hideOnMobile: true },
    { key: 'date', header: 'Date', cell: (e) => formatDate(e.event_date) },
    { key: 'status', header: 'Status', cell: (e) => statusBadge(e.status) },
    { key: 'participants', header: 'Participants', cell: (e) => `${e.participants}${e.capacity ? ` / ${e.capacity}` : ''}` },
    { key: 'venue', header: 'Venue', cell: (e) => e.venue || 'N/A', hideOnMobile: true },
  ]

  return (
    <AdminLayout>
      <PageHeader title="Events" description="Matches and cycling events across Sport Cliq." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total" value={events.length} />
        <StatCard label="Upcoming" value={count('upcoming')} valueClassName="text-blue-600" />
        <StatCard label="Live" value={count('live')} valueClassName="text-green-600" />
        <StatCard label="Cancelled" value={count('cancelled')} valueClassName="text-red-600" />
      </div>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 pt-5 md:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search events" placeholder="Title or organizer" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select ariaLabel="Status" value={status} onValueChange={setStatus} options={[
            { value: 'all', label: 'All statuses' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'live', label: 'Live' },
            { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'passed', label: 'Passed' },
          ]} />
          <Select ariaLabel="Sport" value={sport} onValueChange={setSport} options={[
            { value: 'all', label: 'All sports' }, { value: 'Football', label: 'Football' }, { value: 'Basketball', label: 'Basketball' },
            { value: 'Tennis', label: 'Tennis' }, { value: 'Volleyball', label: 'Volleyball' }, { value: 'Cycling', label: 'Cycling' },
          ]} />
          <Select ariaLabel="Date" value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)} options={[
            { value: 'all', label: 'All dates' }, { value: 'today', label: 'Today' }, { value: '7days', label: 'Last 7 days' }, { value: 'custom', label: 'Custom range' },
          ]} />
          {dateFilter === 'custom' ? (
            <div className="grid grid-cols-2 gap-3 md:col-span-4 md:max-w-md">
              <DatePicker label="Start date" value={customStart} onChange={setCustomStart} />
              <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ErrorText error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Events ({events.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              columns={columns}
              rows={events}
              rowKey={(e) => `${e.event_type}-${e.id}`}
              actions={(e) => (
                <>
                  <Button variant="ghost" size="icon" aria-label={`View ${e.title}`} onClick={() => setViewing(e)}><Eye /></Button>
                  {e.status.toLowerCase() === 'upcoming' ? (
                    <>
                      <Button variant="ghost" size="icon" aria-label={`Edit ${e.title}`} onClick={() => openEdit(e)}><Pencil /></Button>
                      <Button variant="ghost" size="icon" aria-label={`Cancel ${e.title}`} onClick={() => setConfirm({ kind: 'cancel', event: e })}><Ban className="text-orange-600" /></Button>
                      {adminRole === 'super_admin' ? (
                        <Button variant="ghost" size="icon" aria-label={`Delete ${e.title}`} onClick={() => setConfirm({ kind: 'delete', event: e })}><Trash2 className="text-red-600" /></Button>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          {viewing ? (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.title}</DialogTitle>
                <DialogDescription>{viewing.event_type === 'match' ? 'Match' : 'Cycling Event'}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Detail label="Type">{viewing.event_type === 'match' ? 'Match' : 'Cycling Event'}</Detail>
                <Detail label="Status">{statusBadge(viewing.status)}</Detail>
                <Detail label="Sport">{viewing.sport}</Detail>
                <Detail label="Date">{formatDateTime(viewing.event_date)}</Detail>
                <Detail label="Organizer">{viewing.organizer || 'N/A'}{viewing.organizer_phone ? ` (${viewing.organizer_phone})` : ''}</Detail>
                <Detail label="Venue">{viewing.venue || 'N/A'}</Detail>
                <Detail label="Participants">{viewing.participants}{viewing.capacity ? ` / ${viewing.capacity}` : ''}</Detail>
                <Detail label="Tickets Sold">{viewing.tickets_sold}</Detail>
                <Detail label="Average Rating">{viewing.avg_rating != null ? `${viewing.avg_rating} / 5` : 'No ratings'}</Detail>
                <Detail label="Price">{viewing.is_paid ? naira(viewing.price) : 'Free'}</Detail>
                <Detail label="Super Code">{viewing.super_code || 'N/A'}</Detail>
                {viewing.event_type === 'cycling' ? (
                  <>
                    <Detail label="Start Landmark">{viewing.start_landmark || 'N/A'}</Detail>
                    <Detail label="End Landmark">{viewing.end_landmark || 'N/A'}</Detail>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit event</DialogTitle>
            <DialogDescription>Update the title or date.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Title" htmlFor="edit-title">
              <Input id="edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </Field>
            <Field label="Date" htmlFor="edit-date">
              <DatePicker id="edit-date" value={editDate} onChange={setEditDate} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy || !editTitle.trim()}>{busy ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.kind === 'delete' ? 'Delete event?' : 'Cancel event?'}</DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'delete'
                ? `This permanently removes "${confirm?.event.title}". Events with participants or payments cannot be deleted.`
                : `"${confirm?.event.title}" will be marked as cancelled.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Keep it</Button>
            <Button variant="destructive" onClick={runConfirm} disabled={busy}>
              {busy ? 'Working...' : confirm?.kind === 'delete' ? 'Delete' : 'Cancel Event'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  )
}
