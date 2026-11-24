import { useEffect, useMemo, useState } from 'react'
import { Eye, MapPin, RefreshCw, Search, Trash2 } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Detail, ErrorText, Field, Loading, PageHeader, StatCard } from '@/components/ui/page'
import { useAdminSession } from '@/hooks/useAdminSession'
import { adminOperations, type VenueBooking, type VenueRow } from '@/lib/adminOperations'
import { errorMessage, formatDate, naira, shortId } from '@/lib/utils'

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'verified' ? 'success' : status === 'rejected' ? 'danger' : 'warning'
  return <Badge variant={variant} className="capitalize">{status}</Badge>
}

export default function AdminVenues() {
  const session = useAdminSession()
  const adminRole = session?.role
  const [venues, setVenues] = useState<VenueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [city, setCity] = useState('all')
  const [viewing, setViewing] = useState<VenueRow | null>(null)
  const [bookings, setBookings] = useState<VenueBooking[] | null>(null)
  const [rejecting, setRejecting] = useState<VenueRow | null>(null)
  const [reason, setReason] = useState('')
  const [deleting, setDeleting] = useState<VenueRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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
    if (!viewing) return setBookings(null)
    adminOperations.getVenueBookings(viewing.id).then(setBookings).catch((e) => {
      console.error(e)
      setBookings([])
    })
  }, [viewing])

  const cities = useMemo(() => Array.from(new Set(venues.map((v) => v.city).filter(Boolean))).sort(), [venues])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return venues.filter(
      (v) =>
        (status === 'all' || v.status === status) &&
        (city === 'all' || v.city === city) &&
        (!q || [v.name, v.city, v.state, v.owner_name].some((x) => (x || '').toLowerCase().includes(q))),
    )
  }, [venues, search, status, city])

  const setVenueStatus = async (v: VenueRow, next: VenueRow['status'], why?: string) => {
    setBusyId(v.id)
    setError(null)
    try {
      await adminOperations.toggleVenueStatus(v.id, next, why)
      const patch = { status: next, rejection_reason: next === 'rejected' ? why ?? null : null }
      setVenues((list) => list.map((x) => (x.id === v.id ? { ...x, ...patch } : x)))
      setViewing((cur) => (cur && cur.id === v.id ? { ...cur, ...patch } : cur))
      setRejecting(null)
      setReason('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      await adminOperations.deleteVenue(deleting.id)
      setVenues((list) => list.filter((x) => x.id !== deleting.id))
      setDeleting(null)
    } catch (e) {
      setError(errorMessage(e))
      setDeleting(null)
    } finally {
      setBusyId(null)
    }
  }

  const columns: Column<VenueRow>[] = [
    { key: 'id', header: 'ID', cell: (v) => <span className="font-mono text-xs">{shortId(v.id)}</span>, hideOnMobile: true, wideOnly: true },
    { key: 'name', header: 'Name', cell: (v) => <span className="font-semibold">{v.name}</span> },
    {
      key: 'location',
      header: 'Location',
      cell: (v) => (
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {v.city}, {v.state}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      hideOnMobile: true,
      cell: (v) => (
        <div className="text-xs">
          <p className="font-medium text-sm">{v.owner_name || 'N/A'}</p>
          <p className="text-muted-foreground">{v.owner_phone}</p>
          <p className="text-muted-foreground">{v.owner_email}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (v) => <StatusBadge status={v.status} /> },
    { key: 'fee', header: 'Booking Fee', cell: (v) => naira(v.booking_fee ?? v.price_per_hour), hideOnMobile: true },
    { key: 'events', header: 'Events', cell: (v) => v.events_count },
    { key: 'revenue', header: 'Revenue', cell: (v) => naira(v.revenue) },
  ]

  const venueActions = (v: VenueRow, compact = false) => (
    <>
      {v.status === 'pending' ? (
        <>
          <Button size="sm" onClick={() => setVenueStatus(v, 'verified')} disabled={busyId === v.id}>Verify</Button>
          <Button size="sm" variant="destructive" onClick={() => { setRejecting(v); setReason('') }} disabled={busyId === v.id}>Reject</Button>
        </>
      ) : null}
      {v.status !== 'rejected' ? (
        <Button
          size={compact ? 'icon' : 'sm'}
          variant="outline"
          aria-label={`Toggle status of ${v.name}`}
          title="Toggle Status"
          onClick={() => setVenueStatus(v, v.status === 'verified' ? 'pending' : 'verified')}
          disabled={busyId === v.id}
        >
          <RefreshCw />
          {compact ? null : 'Toggle Status'}
        </Button>
      ) : null}
      {adminRole === 'super_admin' ? (
        <Button size="sm" variant="ghost" aria-label={`Delete ${v.name}`} onClick={() => setDeleting(v)}>
          <Trash2 className="text-red-600" />
        </Button>
      ) : null}
    </>
  )

  return (
    <AdminLayout>
      <PageHeader title="Venues" description="Verify venues before they go live on Sport Cliq." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending" value={venues.filter((v) => v.status === 'pending').length} valueClassName="text-yellow-600" />
        <StatCard label="Verified" value={venues.filter((v) => v.status === 'verified').length} valueClassName="text-green-600" />
        <StatCard label="Rejected" value={venues.filter((v) => v.status === 'rejected').length} valueClassName="text-red-600" />
        <StatCard label="Total" value={venues.length} />
      </div>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 pt-5 md:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search venues" placeholder="Name, city, state or owner" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select ariaLabel="Status" value={status} onValueChange={setStatus} options={[
            { value: 'all', label: 'All statuses' }, { value: 'pending', label: 'Pending' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' },
          ]} />
          <Select ariaLabel="City" value={city} onValueChange={setCity} options={[{ value: 'all', label: 'All cities' }, ...cities.map((c) => ({ value: c, label: c }))]} />
        </CardContent>
      </Card>

      <ErrorText error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Venues ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              columns={columns}
              rows={filtered}
              rowKey={(v) => v.id}
              actions={(v) => (
                <>
                  <Button variant="ghost" size="icon" aria-label={`View ${v.name}`} onClick={() => setViewing(v)}><Eye /></Button>
                  {venueActions(v, true)}
                </>
              )}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          {viewing ? (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.name}</DialogTitle>
                <DialogDescription>Listed {formatDate(viewing.created_at)}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Detail label="Address">{viewing.address}</Detail>
                <Detail label="Location">
                  {viewing.city}, {viewing.state}
                  {viewing.map_link ? (
                    <a href={viewing.map_link} target="_blank" rel="noreferrer" className="ml-2 text-primary hover:underline">Map</a>
                  ) : null}
                </Detail>
                <Detail label="Owner">{viewing.owner_name || 'N/A'}</Detail>
                <Detail label="Owner Contact">{[viewing.owner_phone, viewing.owner_email].filter(Boolean).join(' · ') || 'N/A'}</Detail>
                <Detail label="Status"><StatusBadge status={viewing.status} /></Detail>
                <Detail label="Booking Fee">{naira(viewing.booking_fee ?? viewing.price_per_hour)}</Detail>
                <Detail label="Total Events">{viewing.events_count}</Detail>
                <Detail label="Total Revenue">{naira(viewing.revenue)}</Detail>
                {viewing.rejection_reason ? <Detail label="Rejection Reason">{viewing.rejection_reason}</Detail> : null}
              </div>

              <div className="mt-5">
                <p className="mb-2 text-sm font-semibold">Verification documents</p>
                {viewing.verification_documents?.length ? (
                  <ul className="list-inside list-disc text-sm">
                    {viewing.verification_documents.map((url, i) => (
                      <li key={url}><a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Document {i + 1}</a></li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No documents uploaded</p>
                )}
              </div>

              <div className="mt-5">
                <p className="mb-2 text-sm font-semibold">Booking history</p>
                {bookings === null ? (
                  <Loading />
                ) : (
                  <DataTable
                    rows={bookings}
                    rowKey={(b) => b.id}
                    empty="No bookings yet"
                    columns={[
                      { key: 'id', header: 'ID', cell: (b) => <span className="font-mono text-xs">{shortId(b.id)}</span> },
                      { key: 'date', header: 'Date', cell: (b) => formatDate(b.date) },
                      { key: 'amount', header: 'Amount', cell: (b) => naira(b.amount) },
                      { key: 'status', header: 'Status', cell: (b) => b.status || 'N/A' },
                    ]}
                  />
                )}
              </div>
              <DialogFooter>{venueActions(viewing)}</DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject venue</DialogTitle>
            <DialogDescription>Add a reason so the owner knows what to fix.</DialogDescription>
          </DialogHeader>
          <Field label="Reason (optional)" htmlFor="v-reason">
            <Textarea id="v-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busyId === rejecting?.id} onClick={() => rejecting && setVenueStatus(rejecting, 'rejected', reason.trim() || undefined)}>
              Reject Venue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete venue?</DialogTitle>
            <DialogDescription>
              This permanently removes "{deleting?.name}". Venues with matches or bookings cannot be deleted, so reject them instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button variant="destructive" onClick={doDelete} disabled={busyId === deleting?.id}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  )
}
