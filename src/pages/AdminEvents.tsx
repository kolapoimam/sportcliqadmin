import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Bike, Calendar, Eye, MapPin, Pencil, Star, Trash2, Trophy, Users } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { DatePicker, Field, Input, SearchInput, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Menu } from '@/components/ui/menu'
import { Alert, useConfirm, useStepUp, useToast } from '@/components/ui/feedback'
import { Detail, EmptyState, FilterBar, Loading, PageHeader, Pagination, Segmented, StatTile, usePaged } from '@/components/ui/page'
import { useCan } from '@/hooks/useAdminSession'
import { adminOperations, type EventRow } from '@/lib/adminOperations'
import { dateBounds, errorMessage, formatDate, formatDateTime, naira, shortId, type DateFilter } from '@/lib/utils'

const SPORTS = ['Football', 'Basketball', 'Tennis', 'Volleyball', 'Cycling']
const statusKey = (s: string) => (['passed', 'completed', 'ended'].includes(s.toLowerCase()) ? 'completed' : s.toLowerCase())

export default function AdminEvents() {
  const can = useCan()
  const stepUp = useStepUp()
  const confirm = useConfirm()
  const toast = useToast()
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
  const [form, setForm] = useState({ title: '', date: '', time: '', capacity: '', price: '', sport: 'Football', notes: '' })
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
      setEvents((await adminOperations.getEvents({ search: debounced, status: 'all', sport, start, end })) || [])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [debounced, sport, dateFilter, customStart, customEnd])

  useEffect(() => {
    load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: events.length }
    events.forEach((e) => (c[statusKey(e.status)] = (c[statusKey(e.status)] ?? 0) + 1))
    return c
  }, [events])
  const filtered = useMemo(() => (status === 'all' ? events : events.filter((e) => (status === 'passed' ? e.status.toLowerCase() === 'passed' : statusKey(e.status) === status))), [events, status])
  const { pageRows, pagination } = usePaged(filtered, 10)

  const openEdit = (e: EventRow) => {
    const d = e.event_date ? new Date(e.event_date) : null
    setForm({
      title: e.title,
      date: d ? d.toLocaleDateString('en-CA') : '',
      time: d ? d.toTimeString().slice(0, 5) : '',
      capacity: e.capacity ? String(e.capacity) : '',
      price: e.price ? String(e.price) : '',
      sport: e.sport,
      notes: '',
    })
    setEditing(e)
  }

  const saveEdit = async () => {
    if (!editing) return
    if (editing.event_type === 'cycling' && form.price && Number(form.price) < 1000) return toast.error('Cycling price must be at least ₦1,000 or empty for free')
    setBusy(true)
    try {
      const data: Record<string, string> = { title: form.title.trim() }
      if (form.date) data.date = form.date
      if (form.time) data.time = form.time
      if (form.capacity) data.capacity = form.capacity
      data.price = form.price
      if (editing.event_type === 'match') data.sport = form.sport
      if (form.notes) data.notes = form.notes
      await adminOperations.editEvent(editing.event_type, editing.id, data)
      setEditing(null)
      toast.success('Event updated')
      load()
    } catch (e) {
      toast.error('Could not save event', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const cancelEvent = async (e: EventRow) => {
    const { ok } = await confirm({ title: `Cancel "${e.title}"?`, description: 'The event will be marked cancelled. Participants keep their records.', confirmText: 'Cancel event', tone: 'danger', cancelText: 'Keep it', icon: <Ban /> })
    if (!ok) return
    try {
      await adminOperations.updateEventStatus(e.event_type, e.id, 'cancelled')
      setEvents((l) => l.map((x) => (x.id === e.id ? { ...x, status: 'cancelled' } : x)))
      setViewing(null)
      toast.success('Event cancelled')
    } catch (err) {
      toast.error('Could not cancel', errorMessage(err))
    }
  }

  const deleteEvent = async (e: EventRow) => {
    const { ok } = await confirm({ title: `Delete "${e.title}"?`, description: 'This permanently removes the event. Events with participants or payments cannot be deleted, cancel those instead.', confirmText: 'Delete', tone: 'danger', icon: <Trash2 /> })
    if (!ok) return
    if (!(await stepUp('delete this event'))) return
    try {
      await adminOperations.deleteEvent(e.event_type, e.id)
      setEvents((l) => l.filter((x) => x.id !== e.id))
      setViewing(null)
      toast.success('Event deleted')
    } catch (err) {
      toast.error('Could not delete', errorMessage(err))
    }
  }

  const isUpcoming = (e: EventRow) => e.status.toLowerCase() === 'upcoming'
  const rowMenu = (e: EventRow) => (
    <Menu items={[
      { label: 'View details', icon: <Eye />, onSelect: () => setViewing(e) },
      { label: 'Edit event', icon: <Pencil />, onSelect: () => openEdit(e), hidden: !isUpcoming(e) || !can('events.edit') },
      'separator',
      { label: 'Cancel event', icon: <Ban />, tone: 'danger', onSelect: () => cancelEvent(e), hidden: !isUpcoming(e) || !can('events.cancel') },
      { label: 'Delete event', icon: <Trash2 />, tone: 'danger', onSelect: () => deleteEvent(e), hidden: !isUpcoming(e) || !can('events.delete') },
    ]} />
  )

  const columns: Column<EventRow>[] = [
    {
      key: 'title', header: 'Event', sort: (e) => e.title,
      cell: (e) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className={e.event_type === 'cycling' ? 'rounded-2xl bg-sky-100 p-2.5 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : 'rounded-2xl bg-emerald-100 p-2.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}>
            {e.event_type === 'cycling' ? <Bike className="h-4 w-4" /> : <Trophy className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold">{e.title}</p>
            <p className="truncate text-xs text-muted-foreground">{e.organizer || 'N/A'} · <span className="font-mono">{shortId(e.id)}</span></p>
          </div>
        </div>
      ),
    },
    { key: 'sport', header: 'Sport', sort: (e) => e.sport, cell: (e) => <Badge variant={e.sport === 'Cycling' ? 'info' : 'success'}>{e.sport}</Badge> },
    { key: 'date', header: 'Date', sort: (e) => e.event_date, cell: (e) => formatDate(e.event_date) },
    { key: 'status', header: 'Status', sort: (e) => e.status, cell: (e) => <StatusBadge status={e.status} /> },
    {
      key: 'participants', header: 'Participants', sort: (e) => e.participants,
      cell: (e) => {
        const pct = e.capacity ? Math.min(100, Math.round((e.participants / e.capacity) * 100)) : 0
        return (
          <div className="min-w-24">
            <p className="text-sm font-semibold">{e.participants}{e.capacity ? <span className="text-muted-foreground"> / {e.capacity}</span> : null}</p>
            {e.capacity ? <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary-light" style={{ width: `${pct}%` }} /></div> : null}
          </div>
        )
      },
    },
    { key: 'venue', header: 'Venue', cell: (e) => <span className="line-clamp-1">{e.venue || 'N/A'}</span>, hideOnMobile: true },
  ]

  return (
    <AdminLayout perm="events.view">
      <PageHeader eyebrow="Manage" title="Events" description="Matches and cycling events across Sport Cliq." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="black" label="Total" value={counts.all ?? 0} icon={<Calendar />} onClick={() => setStatus('all')} active={status === 'all'} />
        <StatTile tone="blue" label="Upcoming" value={counts.upcoming ?? 0} icon={<Calendar />} onClick={() => setStatus('upcoming')} active={status === 'upcoming'} />
        <StatTile tone="green" label="Live" value={counts.live ?? 0} icon={<Trophy />} onClick={() => setStatus('live')} active={status === 'live'} />
        <StatTile tone="rose" label="Cancelled" value={counts.cancelled ?? 0} icon={<Ban />} onClick={() => setStatus('cancelled')} active={status === 'cancelled'} />
      </div>

      <Segmented className="mb-4" value={status} onChange={setStatus} options={[
        { value: 'all', label: 'All', count: counts.all ?? 0 },
        { value: 'upcoming', label: 'Upcoming', count: counts.upcoming ?? 0 },
        { value: 'live', label: 'Live', count: counts.live ?? 0 },
        { value: 'completed', label: 'Completed', count: counts.completed ?? 0 },
        { value: 'cancelled', label: 'Cancelled', count: counts.cancelled ?? 0 },
        { value: 'passed', label: 'Passed', count: events.filter((e) => e.status.toLowerCase() === 'passed').length },
      ]} />

      <FilterBar className="xl:grid-cols-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search title or organizer" />
        <Select ariaLabel="Sport" value={sport} onValueChange={setSport} options={[{ value: 'all', label: 'All sports' }, ...SPORTS.map((s) => ({ value: s, label: s }))]} />
        <Select ariaLabel="Date" value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)} options={[
          { value: 'all', label: 'Any date' }, { value: 'today', label: 'Today' }, { value: '7days', label: 'Last 7 days' }, { value: 'custom', label: 'Custom range' },
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
        <CardHeader icon={<Calendar />} title={`Events (${filtered.length})`} description="Tap an event for full details." />
        <CardContent>
          {loading ? <Loading /> : (
            <DataTable columns={columns} rows={pageRows} rowKey={(e) => `${e.event_type}-${e.id}`} onRowClick={setViewing} actions={rowMenu}
              empty={<EmptyState icon={<Calendar />} title="No events found" text="Try another status, sport or date." />} />
          )}
          <Pagination {...pagination} />
        </CardContent>
      </Card>

      <Modal
        open={Boolean(viewing)}
        onOpenChange={(o) => !o && setViewing(null)}
        size="lg"
        icon={viewing?.event_type === 'cycling' ? <Bike /> : <Trophy />}
        title={viewing?.title ?? ''}
        description={viewing ? `${viewing.event_type === 'match' ? 'Match' : 'Cycling Event'} · ${formatDateTime(viewing.event_date)}` : ''}
        footer={viewing && isUpcoming(viewing) ? (
          <>
            {can('events.delete') ? <Button variant="soft-danger" onClick={() => deleteEvent(viewing)}><Trash2 /> Delete</Button> : null}
            {can('events.cancel') ? <Button variant="outline" onClick={() => cancelEvent(viewing)}><Ban /> Cancel event</Button> : null}
            {can('events.edit') ? <Button onClick={() => { openEdit(viewing); setViewing(null) }}><Pencil /> Edit</Button> : null}
          </>
        ) : null}
      >
        {viewing ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Detail label="Type">{viewing.event_type === 'match' ? 'Match' : 'Cycling Event'}</Detail>
            <Detail label="Status"><StatusBadge status={viewing.status} /></Detail>
            <Detail label="Sport">{viewing.sport}</Detail>
            <Detail label="Venue" className="col-span-2 sm:col-span-1"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{viewing.venue || 'N/A'}</span></Detail>
            <Detail label="Organizer">{viewing.organizer || 'N/A'}</Detail>
            <Detail label="Phone">{viewing.organizer_phone || 'N/A'}</Detail>
            <Detail label="Participants"><span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{viewing.participants}{viewing.capacity ? ` / ${viewing.capacity}` : ''}</span></Detail>
            <Detail label="Tickets Sold">{viewing.tickets_sold}</Detail>
            <Detail label="Average Rating">{viewing.avg_rating != null ? <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{viewing.avg_rating} / 5</span> : 'No ratings'}</Detail>
            <Detail label="Price">{viewing.is_paid ? naira(viewing.price) : 'Free'}</Detail>
            <Detail label="Super Code">{viewing.super_code || 'N/A'}</Detail>
            <Detail label="Event ID"><span className="font-mono text-xs">{viewing.id}</span></Detail>
            {viewing.event_type === 'cycling' ? (
              <>
                <Detail label="Start Landmark">{viewing.start_landmark || 'N/A'}</Detail>
                <Detail label="End Landmark">{viewing.end_landmark || 'N/A'}</Detail>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        size="lg"
        icon={<Pencil />}
        title="Edit event"
        description={editing?.event_type === 'cycling' ? 'Cycling event' : 'Match'}
        footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveEdit} loading={busy} disabled={!form.title.trim()}>Save changes</Button></>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="ev-title" className="sm:col-span-2"><Input id="ev-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Date" htmlFor="ev-date"><DatePicker id="ev-date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} /></Field>
          <Field label="Start time" htmlFor="ev-time"><Input id="ev-time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
          <Field label={editing?.event_type === 'cycling' ? 'Max attendees' : 'Total slots'} htmlFor="ev-cap"><Input id="ev-cap" type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
          <Field label="Price (₦)" htmlFor="ev-price" hint="Leave empty for free"><Input id="ev-price" type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
          {editing?.event_type === 'match' ? (
            <Field label="Sport" className="sm:col-span-2"><Select ariaLabel="Sport" value={form.sport} onValueChange={(v) => setForm({ ...form, sport: v })} options={SPORTS.filter((s) => s !== 'Cycling').map((s) => ({ value: s, label: s }))} /></Field>
          ) : null}
          <Field label="Notes" htmlFor="ev-notes" hint="Leave empty to keep the current notes" className="sm:col-span-2"><Textarea id="ev-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </AdminLayout>
  )
}
