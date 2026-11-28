import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Bike, Calendar, Download, Eye, MapPin, Pencil, Star, Trash2, Trophy, Users } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { DatePicker, Field, Input, MoneyInput, RichTextarea, SearchInput } from '@/components/ui/input'
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard'
import { check, v } from '@/lib/validate'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Menu } from '@/components/ui/menu'
import { Alert, useConfirm, useStepUp, useToast } from '@/components/ui/feedback'
import { Detail, EmptyState, FilterBar, Loading, PageHeader, Pagination, Segmented, StatTile, usePaged } from '@/components/ui/page'
import { useCan } from '@/hooks/useAdminSession'
import { adminOperations, type EventParticipant, type EventRow } from '@/lib/adminOperations'
import Papa from 'papaparse'
import { cn, dateBounds, downloadBlob, errorMessage, formatDate, formatDateTime, naira, shortId, type DateFilter } from '@/lib/utils'

const SPORTS = ['Football', 'Basketball', 'Tennis', 'Volleyball', 'Cycling']
// Status comes from the event's date, start and end time, or its cancellation
// Labels for answers organisers ask for, like jersey_number to Jersey number
const labelOf = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const statusKey = (s: string) => (['passed', 'completed', 'ended'].includes(s.toLowerCase()) ? 'passed' : s.toLowerCase())

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
  const [people, setPeople] = useState<{ event: EventRow; rows: EventParticipant[] | null; error?: string } | null>(null)
  const openPeople = async (e: EventRow) => {
    setPeople({ event: e, rows: null })
    try {
      const rows = (await adminOperations.getEventParticipants(e.event_type, e.id)) || []
      setPeople((p) => (p && p.event.id === e.id ? { ...p, rows } : p))
    } catch (err) {
      setPeople((p) => (p && p.event.id === e.id ? { ...p, rows: [], error: errorMessage(err) } : p))
    }
  }
  const exportPeople = () => {
    if (!people?.rows?.length) return
    const csv = Papa.unparse(people.rows.map((r) => ({
      Name: r.name, Phone: r.phone ?? '', Email: r.email ?? '', Slots: r.slots, Payment: r.payment ?? '', Status: r.cancelled ? 'Cancelled' : r.status ?? '',
      Code: r.code ?? '', 'Payment reference': r.payment_reference ?? '', 'Signed in': r.account ? 'Yes' : 'No',
      ...Object.fromEntries(Object.entries(r.details || {}).map(([k, val]) => [labelOf(k), String(val ?? '')])),
      Registered: formatDateTime(r.created_at),
    })))
    downloadBlob('\ufeff' + csv, `participants-${people.event.title.replace(/[^\w]+/g, '-').toLowerCase()}.csv`, 'text/csv;charset=utf-8')
  }
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
  const filtered = useMemo(() => (status === 'all' ? events : events.filter((e) => statusKey(e.status) === status)), [events, status])
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

  const editErrors = editing ? check({
    title: v.required(form.title, 'Title') || (form.title.trim().length > 120 ? 'Keep the title to 120 characters' : null),
    date: v.date(form.date, { notPast: true }),
    time: v.time(form.time),
    capacity: /^\d+$/.test(form.capacity.trim()) && Number(form.capacity) < (editing.participants || 0)
      ? `${editing.participants} slots are already booked, so it must be at least ${editing.participants}`
      : v.int(form.capacity, { min: 1, max: 1000 }),
    price: v.money(form.price, editing.event_type === 'cycling' && form.price ? { min: 1000, max: 10_000_000 } : { max: 10_000_000 }),
  }) : {}
  const [tried, setTried] = useState(false)
  const dirty = !!editing && (form.title !== editing.title || !!form.notes || form.price !== (editing.price ? String(editing.price) : '') || form.capacity !== (editing.capacity ? String(editing.capacity) : ''))
  const guard = useUnsavedGuard(dirty)
  const closeEdit = () => guard(() => { setEditing(null); setTried(false) })

  const saveEdit = async () => {
    if (!editing) return
    setTried(true)
    if (Object.keys(editErrors).length) return toast.error('Check the highlighted fields', Object.values(editErrors)[0] as string)
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
      setTried(false)
      toast.success('Event updated', 'The new details are live in the app.')
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
      { label: 'See who registered', icon: <Users />, onSelect: () => openPeople(e) },
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
      key: 'participants', header: 'Slots booked', sort: (e) => e.participants,
      cell: (e) => {
        const pct = e.capacity ? Math.min(100, Math.round((e.participants / e.capacity) * 100)) : 0
        return (
          <button type="button" onClick={(ev) => { ev.stopPropagation(); openPeople(e) }} className="min-w-24 cursor-pointer rounded-lg text-left hover:opacity-80" aria-label={`See who registered for ${e.title}`} title="See who registered">
            <p className="text-sm font-semibold text-primary underline decoration-dotted underline-offset-4">{e.participants}{e.capacity ? <span className="text-muted-foreground"> / {e.capacity} slots</span> : <span className="text-muted-foreground"> slots</span>}</p>
            {e.registrations != null && e.registrations !== e.participants ? <p className="text-xs text-muted-foreground">{e.registrations} registration{e.registrations === 1 ? '' : 's'}</p> : null}
            {e.capacity ? <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary-light" style={{ width: `${pct}%` }} /></div> : null}
          </button>
        )
      },
    },
    { key: 'venue', header: 'Venue', cell: (e) => <span className="line-clamp-1">{e.venue || 'N/A'}</span>, hideOnMobile: true },
  ]

  return (
    <AdminLayout perm="events.view">
      <PageHeader eyebrow="Manage" title="Events" description="Matches and cycling events across SportCliq." />

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
        { value: 'passed', label: 'Passed', count: counts.passed ?? 0 },
        { value: 'cancelled', label: 'Cancelled', count: counts.cancelled ?? 0 },
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
            <Detail label="Slots booked"><button type="button" onClick={() => openPeople(viewing)} className="inline-flex cursor-pointer items-center gap-1 font-semibold text-primary underline decoration-dotted underline-offset-4"><Users className="h-3.5 w-3.5" />{viewing.participants}{viewing.capacity ? ` / ${viewing.capacity}` : ''}</button></Detail>
            <Detail label="Registrations">{viewing.registrations ?? viewing.participants}</Detail>
            <Detail label="Signed in users">{viewing.unique_users ?? 'N/A'}</Detail>
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
        onOpenChange={(o) => !o && closeEdit()}
        size="lg"
        icon={<Pencil />}
        title="Edit event"
        description={editing?.event_type === 'cycling' ? 'Cycling event' : 'Match'}
        footer={<><Button variant="outline" onClick={closeEdit}>Cancel</Button><Button onClick={saveEdit} loading={busy} disabled={!dirty && !form.date && !form.time}>Save changes</Button></>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Title *" htmlFor="ev-title" className="sm:col-span-2" error={tried ? editErrors.title : null}><Input id="ev-title" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-invalid={tried && !!editErrors.title} /></Field>
          <Field label="Date" htmlFor="ev-date" error={tried ? editErrors.date : null}><DatePicker id="ev-date" min={new Date().toLocaleDateString('en-CA')} value={form.date} onChange={(val) => setForm({ ...form, date: val })} /></Field>
          <Field label="Start time" htmlFor="ev-time" error={tried ? editErrors.time : null}><Input id="ev-time" type="time" step={300} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
          <Field label={editing?.event_type === 'cycling' ? 'Max attendees' : 'Total slots'} htmlFor="ev-cap" error={tried ? editErrors.capacity : null} hint={editing?.participants ? `${editing.participants} already booked` : undefined}>
            <Input id="ev-cap" type="number" inputMode="numeric" min={Math.max(1, editing?.participants || 0)} max={1000} step={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Price" htmlFor="ev-price" error={tried ? editErrors.price : null} hint={editing?.event_type === 'cycling' ? 'Leave empty for free. Paid rides are at least ₦1,000.' : 'Leave empty for free'}>
            <MoneyInput id="ev-price" value={form.price} onChange={(val) => setForm({ ...form, price: val })} invalid={tried && !!editErrors.price} />
          </Field>
          {editing?.event_type === 'match' ? (
            <Field label="Sport" className="sm:col-span-2"><Select ariaLabel="Sport" value={form.sport} onValueChange={(val) => setForm({ ...form, sport: val })} options={SPORTS.filter((x) => x !== 'Cycling').map((x) => ({ value: x, label: x }))} /></Field>
          ) : null}
          <Field label="Notes" htmlFor="ev-notes" hint="Leave empty to keep the current notes. Formatting shows in the app." className="sm:col-span-2"><RichTextarea id="ev-notes" maxLength={2000} value={form.notes} onChange={(val) => setForm({ ...form, notes: val })} /></Field>
        </div>
      </Modal>
      <Modal
        open={Boolean(people)}
        onOpenChange={(o) => !o && setPeople(null)}
        size="xl"
        icon={<Users />}
        title={people ? `Registered for ${people.event.title}` : ''}
        description={people?.rows ? (() => {
          const live = people.rows.filter((r) => !r.cancelled)
          const slots = live.reduce((n, r) => n + (r.slots || 1), 0)
          return `${slots} slot${slots === 1 ? '' : 's'} booked by ${live.length} ${people.event.event_type === 'cycling' ? 'rider' : 'player'}${live.length === 1 ? '' : 's'}${people.event.capacity ? `, ${people.event.capacity} available` : ''}`
        })() : 'Loading'}
        footer={<><Button variant="outline" onClick={() => setPeople(null)}>Close</Button><Button variant="outline" onClick={exportPeople} disabled={!people?.rows?.length}><Download /> Export CSV</Button></>}
      >
        {!people?.rows ? <Loading /> : people.error ? <Alert>{people.error}</Alert> : people.rows.length === 0 ? (
          <EmptyState icon={<Users />} title="Nobody has registered yet" text="Players and riders show here as soon as they join." />
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-semibold">Name</th>
                  <th className="px-2 py-2 font-semibold">Phone</th>
                  <th className="px-2 py-2 text-right font-semibold">Slots</th>
                  <th className="px-2 py-2 font-semibold">Payment</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2 font-semibold">Other details</th>
                </tr>
              </thead>
              <tbody>
                {people.rows.map((r) => (
                  <tr key={r.id} className={cn('border-t align-top', r.cancelled && 'opacity-60')}>
                    <td className="px-2 py-2.5">
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.email || (r.account ? 'Signed in' : 'Guest')}</p>
                      <p className="text-[11px] text-muted-foreground">Joined {formatDateTime(r.created_at)}</p>
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap">{r.phone ? <a href={`tel:${r.phone}`} className="font-medium text-primary hover:underline">{r.phone}</a> : <span className="text-muted-foreground">None</span>}</td>
                    <td className="px-2 py-2.5 text-right font-bold tabular-nums">{r.slots}</td>
                    <td className="px-2 py-2.5"><StatusBadge status={r.payment || 'free'} />{r.payment_reference ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">{r.payment_reference}</p> : null}</td>
                    <td className="px-2 py-2.5"><StatusBadge status={r.cancelled ? 'cancelled' : r.status || 'registered'} />{r.code ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">Code {r.code}</p> : null}</td>
                    <td className="px-2 py-2.5 text-xs">
                      {Object.entries(r.details || {}).filter(([, val]) => val != null && String(val).trim() !== '').length
                        ? Object.entries(r.details || {}).filter(([, val]) => val != null && String(val).trim() !== '').map(([k, val]) => (
                          <p key={k} className="m-0"><span className="text-muted-foreground">{labelOf(k)}</span> {typeof val === 'object' ? JSON.stringify(val) : String(val)}</p>
                        ))
                        : <span className="text-muted-foreground">None</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </AdminLayout>
  )
}
