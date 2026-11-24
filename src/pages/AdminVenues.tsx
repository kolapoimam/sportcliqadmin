import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, Clock, Eye, FileText, MapPin, Pencil, Plus, RefreshCw, Star, Trash2, XCircle } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Field, Input, SearchInput, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Menu } from '@/components/ui/menu'
import { Alert, useConfirm, useStepUp, useToast } from '@/components/ui/feedback'
import { Detail, EmptyState, FilterBar, Loading, PageHeader, Pagination, Segmented, StatTile, usePaged } from '@/components/ui/page'
import { useCan } from '@/hooks/useAdminSession'
import { adminOperations, type VenueBooking, type VenueRow } from '@/lib/adminOperations'
import { errorMessage, formatDate, naira, shortId } from '@/lib/utils'

const EMPTY = { name: '', address: '', city: '', state: '', booking_fee: '', price_per_hour: '', phone: '', email: '', map_link: '', opening_hours: '', facilities: '', description: '' }

export default function AdminVenues() {
  const can = useCan()
  const stepUp = useStepUp()
  const confirm = useConfirm()
  const toast = useToast()
  const [venues, setVenues] = useState<VenueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [city, setCity] = useState('all')
  const [viewing, setViewing] = useState<VenueRow | null>(null)
  const [bookings, setBookings] = useState<VenueBooking[] | null>(null)
  const [editing, setEditing] = useState<VenueRow | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setVenues((await adminOperations.getVenues()) || [])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!viewing) return
    setBookings(null)
    adminOperations.getVenueBookings(viewing.id).then(setBookings).catch((e) => {
      console.error(e)
      setBookings([])
    })
  }, [viewing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cities = useMemo(() => Array.from(new Set(venues.map((v) => v.city).filter(Boolean))).sort(), [venues])
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase()
    return venues.filter((v) => (city === 'all' || v.city === city) && (!q || [v.name, v.city, v.state, v.owner_name].some((x) => (x || '').toLowerCase().includes(q))))
  }, [venues, search, city])
  const count = (s: string) => scoped.filter((v) => v.status === s).length
  const filtered = status === 'all' ? scoped : scoped.filter((v) => v.status === status)
  const { pageRows, pagination } = usePaged(filtered, 10)

  const patch = (id: string, p: Partial<VenueRow>) => {
    setVenues((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)))
    setViewing((cur) => (cur && cur.id === id ? { ...cur, ...p } : cur))
  }

  const setVenueStatus = async (v: VenueRow, next: VenueRow['status']) => {
    let reason: string | undefined
    if (next === 'rejected') {
      const r = await confirm({ title: `Reject ${v.name}?`, description: 'Add a reason so the owner knows what to fix.', confirmText: 'Reject Venue', tone: 'danger', icon: <XCircle />, reasonLabel: 'Reason', reasonOptional: true })
      if (!r.ok) return
      reason = r.reason || undefined
    } else {
      const r = await confirm({
        title: next === 'verified' ? `Verify ${v.name}?` : `Move ${v.name} back to pending?`,
        description: next === 'verified' ? 'It will show as a verified venue on Sport Cliq.' : 'It will lose its verified badge until you verify it again.',
        confirmText: next === 'verified' ? 'Verify' : 'Set to pending', tone: next === 'verified' ? 'success' : 'default',
      })
      if (!r.ok) return
    }
    try {
      await adminOperations.toggleVenueStatus(v.id, next, reason)
      patch(v.id, { status: next, rejection_reason: next === 'rejected' ? reason ?? null : null })
      toast.success(next === 'verified' ? 'Venue verified' : next === 'rejected' ? 'Venue rejected' : 'Venue set to pending')
    } catch (e) {
      toast.error('Could not update venue', errorMessage(e))
    }
  }

  const doDelete = async (v: VenueRow) => {
    const { ok } = await confirm({ title: `Delete ${v.name}?`, description: 'This permanently removes the venue. Venues with matches or bookings cannot be deleted, reject them instead.', confirmText: 'Delete venue', tone: 'danger', icon: <Trash2 /> })
    if (!ok) return
    if (!(await stepUp('delete this venue'))) return
    try {
      await adminOperations.deleteVenue(v.id)
      setVenues((list) => list.filter((x) => x.id !== v.id))
      setViewing(null)
      toast.success('Venue deleted')
    } catch (e) {
      toast.error('Could not delete', errorMessage(e))
    }
  }

  const openForm = (v: VenueRow | 'new') => {
    setForm(v === 'new' ? EMPTY : {
      name: v.name, address: v.address, city: v.city, state: v.state, booking_fee: v.booking_fee?.toString() ?? '', price_per_hour: v.price_per_hour?.toString() ?? '',
      phone: v.phone ?? '', email: v.email ?? '', map_link: v.map_link ?? '', opening_hours: v.opening_hours ?? '', facilities: v.facilities ?? '', description: v.description ?? '',
    })
    setEditing(v)
  }

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await adminOperations.saveVenue(editing === 'new' ? null : editing.id, form)
      toast.success(editing === 'new' ? 'Venue added' : 'Venue updated')
      setEditing(null)
      setViewing(null)
      load()
    } catch (e) {
      toast.error('Could not save venue', /email/i.test(errorMessage(e)) ? 'Check the email address.' : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const rowMenu = (v: VenueRow) => (
    <Menu items={[
      { label: 'View details', icon: <Eye />, onSelect: () => setViewing(v) },
      { label: 'Edit venue', icon: <Pencil />, onSelect: () => openForm(v), hidden: !can('venues.edit') },
      'separator',
      { label: 'Verify', icon: <CheckCircle2 />, tone: 'success', onSelect: () => setVenueStatus(v, 'verified'), hidden: v.status !== 'pending' || !can('venues.approve') },
      { label: 'Reject', icon: <XCircle />, tone: 'danger', onSelect: () => setVenueStatus(v, 'rejected'), hidden: v.status !== 'pending' || !can('venues.approve') },
      { label: v.status === 'verified' ? 'Set to pending' : 'Verify', icon: <RefreshCw />, onSelect: () => setVenueStatus(v, v.status === 'verified' ? 'pending' : 'verified'), hidden: v.status === 'pending' || v.status === 'rejected' || !can('venues.approve') },
      { label: 'Delete venue', icon: <Trash2 />, tone: 'danger', onSelect: () => doDelete(v), hidden: !can('venues.delete') },
    ]} />
  )

  const columns: Column<VenueRow>[] = [
    {
      key: 'name', header: 'Venue', sort: (v) => v.name,
      cell: (v) => (
        <div className="flex min-w-0 items-center gap-3">
          {v.image_urls?.[0] ? <img src={v.image_urls[0]} alt="" className="h-11 w-11 shrink-0 rounded-2xl object-cover" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><Building2 className="h-5 w-5" /></span>}
          <div className="min-w-0">
            <p className="truncate font-bold">{v.name}</p>
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{v.city}, {v.state}</p>
          </div>
        </div>
      ),
    },
    { key: 'owner', header: 'Owner', sort: (v) => v.owner_name, hideOnMobile: true, cell: (v) => <div className="text-xs"><p className="text-sm font-semibold">{v.owner_name || 'N/A'}</p><p className="text-muted-foreground">{v.owner_phone || v.owner_email}</p></div> },
    { key: 'status', header: 'Status', sort: (v) => v.status, cell: (v) => <StatusBadge status={v.status} /> },
    { key: 'fee', header: 'Booking Fee', sort: (v) => v.booking_fee ?? v.price_per_hour, cell: (v) => naira(v.booking_fee ?? v.price_per_hour) },
    { key: 'events', header: 'Events', sort: (v) => v.events_count, cell: (v) => v.events_count, hideOnMobile: true },
    { key: 'revenue', header: 'Revenue', sort: (v) => v.revenue, cell: (v) => <span className="font-semibold">{naira(v.revenue)}</span> },
  ]

  const setF = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <AdminLayout perm="venues.view">
      <PageHeader eyebrow="Manage" title="Venues" description="Verify venues before they go live on Sport Cliq.">
        {can('venues.create') ? <Button onClick={() => openForm('new')}><Plus /> Add venue</Button> : null}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="amber" label="Pending" value={count('pending')} icon={<Clock />} onClick={() => setStatus('pending')} active={status === 'pending'} />
        <StatTile tone="green" label="Verified" value={count('verified')} icon={<CheckCircle2 />} onClick={() => setStatus('verified')} active={status === 'verified'} />
        <StatTile tone="rose" label="Rejected" value={count('rejected')} icon={<XCircle />} onClick={() => setStatus('rejected')} active={status === 'rejected'} />
        <StatTile tone="violet" label="Total" value={scoped.length} icon={<Building2 />} onClick={() => setStatus('all')} active={status === 'all'} />
      </div>

      <Segmented className="mb-4" value={status} onChange={setStatus} options={[
        { value: 'all', label: 'All', count: scoped.length },
        { value: 'pending', label: 'Pending', count: count('pending') },
        { value: 'verified', label: 'Verified', count: count('verified') },
        { value: 'rejected', label: 'Rejected', count: count('rejected') },
      ]} />

      <FilterBar className="xl:grid-cols-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Name, city, state or owner" className="md:col-span-1 xl:col-span-2" />
        <Select ariaLabel="City" value={city} onValueChange={setCity} icon={<MapPin />} options={[{ value: 'all', label: 'All cities' }, ...cities.map((c) => ({ value: c, label: c }))]} />
      </FilterBar>

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      <Card>
        <CardHeader icon={<Building2 />} title={`Venues (${filtered.length})`} />
        <CardContent>
          {loading ? <Loading /> : (
            <DataTable columns={columns} rows={pageRows} rowKey={(v) => v.id} onRowClick={setViewing} actions={rowMenu}
              empty={<EmptyState icon={<Building2 />} title="No venues found" action={<Button onClick={() => openForm('new')}><Plus /> Add venue</Button>} />} />
          )}
          <Pagination {...pagination} />
        </CardContent>
      </Card>

      <Modal
        open={Boolean(viewing)}
        onOpenChange={(o) => !o && setViewing(null)}
        size="xl"
        icon={<Building2 />}
        title={viewing?.name ?? ''}
        description={viewing ? `Listed ${formatDate(viewing.created_at)} · ${shortId(viewing.id)}` : ''}
        footer={viewing ? (
          <>
            {can('venues.delete') ? <Button variant="soft-danger" onClick={() => doDelete(viewing)}><Trash2 /> Delete</Button> : null}
            {can('venues.edit') ? <Button variant="outline" onClick={() => openForm(viewing)}><Pencil /> Edit</Button> : null}
            {!can('venues.approve') ? null : viewing.status === 'pending' ? (
              <>
                <Button variant="soft-danger" onClick={() => setVenueStatus(viewing, 'rejected')}><XCircle /> Reject</Button>
                <Button onClick={() => setVenueStatus(viewing, 'verified')}><CheckCircle2 /> Verify</Button>
              </>
            ) : viewing.status === 'verified' ? (
              <Button variant="outline" onClick={() => setVenueStatus(viewing, 'pending')}><RefreshCw /> Toggle Status</Button>
            ) : (
              <Button onClick={() => setVenueStatus(viewing, 'verified')}><CheckCircle2 /> Verify</Button>
            )}
          </>
        ) : null}
      >
        {viewing ? (
          <div className="space-y-5">
            {viewing.image_urls?.length ? (
              <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
                {viewing.image_urls.slice(0, 6).map((u) => <img key={u} src={u} alt="" className="h-28 w-44 shrink-0 rounded-2xl object-cover" />)}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Detail label="Status"><StatusBadge status={viewing.status} /></Detail>
              <Detail label="Address" className="col-span-2">{viewing.address}</Detail>
              <Detail label="Location">{viewing.city}, {viewing.state}{viewing.map_link ? <a href={viewing.map_link} target="_blank" rel="noreferrer" className="ml-2 text-primary hover:underline">Map</a> : null}</Detail>
              <Detail label="Owner">{viewing.owner_name || 'N/A'}</Detail>
              <Detail label="Contact">{[viewing.owner_phone, viewing.owner_email].filter(Boolean).join(' · ') || 'N/A'}</Detail>
              <Detail label="Booking Fee">{naira(viewing.booking_fee ?? viewing.price_per_hour)}</Detail>
              <Detail label="Total Events">{viewing.events_count}</Detail>
              <Detail label="Total Revenue">{naira(viewing.revenue)}</Detail>
              <Detail label="Rating">{viewing.aggregated_rating ? <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{Number(viewing.aggregated_rating).toFixed(1)}</span> : 'No ratings'}</Detail>
              <Detail label="Opening hours">{viewing.opening_hours || 'N/A'}</Detail>
            </div>
            {viewing.rejection_reason ? <Alert>Rejected: {viewing.rejection_reason}</Alert> : null}
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Verification documents</p>
              {viewing.verification_documents?.length ? (
                <div className="flex flex-wrap gap-2">
                  {viewing.verification_documents.map((url, i) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-gray-800"><FileText className="h-4 w-4 text-primary" />Document {i + 1}</a>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No documents uploaded</p>}
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Booking history</p>
              {bookings === null ? <Loading rows={3} /> : (
                <DataTable rows={bookings} rowKey={(b) => b.id} empty={<p className="py-6 text-center text-sm text-muted-foreground">No bookings yet</p>} columns={[
                  { key: 'id', header: 'Booking', cell: (b) => <div><p className="font-semibold">{b.booker_name || b.title || 'Booking'}</p><p className="font-mono text-xs text-muted-foreground">{shortId(b.id)}</p></div> },
                  { key: 'date', header: 'Date', cell: (b) => formatDate(b.date) },
                  { key: 'amount', header: 'Amount', cell: (b) => naira(b.amount) },
                  { key: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
                ]} />
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        size="lg"
        icon={editing === 'new' ? <Plus /> : <Pencil />}
        title={editing === 'new' ? 'Add a venue' : 'Edit venue'}
        description="Name, address, city and state are required."
        footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={busy} disabled={!form.name.trim() || !form.address.trim() || !form.city.trim() || !form.state.trim()}>{editing === 'new' ? 'Add venue' : 'Save changes'}</Button></>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Venue name" htmlFor="v-name" className="sm:col-span-2"><Input id="v-name" value={form.name} onChange={setF('name')} /></Field>
          <Field label="Address" htmlFor="v-address" className="sm:col-span-2"><Input id="v-address" value={form.address} onChange={setF('address')} /></Field>
          <Field label="City" htmlFor="v-city"><Input id="v-city" value={form.city} onChange={setF('city')} list="v-cities" /><datalist id="v-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="State" htmlFor="v-state"><Input id="v-state" value={form.state} onChange={setF('state')} /></Field>
          <Field label="Booking fee (₦)" htmlFor="v-fee"><Input id="v-fee" type="number" min={0} value={form.booking_fee} onChange={setF('booking_fee')} /></Field>
          <Field label="Price per hour (₦)" htmlFor="v-hour"><Input id="v-hour" type="number" min={0} value={form.price_per_hour} onChange={setF('price_per_hour')} /></Field>
          <Field label="Phone" htmlFor="v-phone"><Input id="v-phone" inputMode="tel" value={form.phone} onChange={setF('phone')} /></Field>
          <Field label="Email" htmlFor="v-email"><Input id="v-email" type="email" value={form.email} onChange={setF('email')} /></Field>
          <Field label="Map link" htmlFor="v-map" className="sm:col-span-2"><Input id="v-map" type="url" value={form.map_link} onChange={setF('map_link')} placeholder="https://maps.google.com/..." /></Field>
          <Field label="Opening hours" htmlFor="v-hours"><Input id="v-hours" value={form.opening_hours} onChange={setF('opening_hours')} placeholder="Mon to Sun, 7am to 11pm" /></Field>
          <Field label="Facilities" htmlFor="v-fac"><Input id="v-fac" value={form.facilities} onChange={setF('facilities')} placeholder="Floodlights, changing rooms" /></Field>
          <Field label="Description" htmlFor="v-desc" className="sm:col-span-2"><Textarea id="v-desc" value={form.description} onChange={setF('description')} /></Field>
        </div>
      </Modal>
    </AdminLayout>
  )
}
