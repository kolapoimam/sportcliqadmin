import { useCallback, useEffect, useState } from 'react'
import { Check, Clock, Eye, X } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DatePicker, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Detail, ErrorText, Field, Loading, PageHeader, StatCard } from '@/components/ui/page'
import { adminOperations, type CashoutRow } from '@/lib/adminOperations'
import { dateBounds, errorMessage, formatDateTime, naira, shortId, type DateFilter } from '@/lib/utils'

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  if (s === 'approved') return <Badge variant="success"><Check /> Approved</Badge>
  if (s === 'rejected') return <Badge variant="danger"><X /> Rejected</Badge>
  return <Badge variant="warning"><Clock /> {s === 'pending' ? 'Pending' : status}</Badge>
}

export default function AdminCashouts() {
  const [cashouts, setCashouts] = useState<CashoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [viewing, setViewing] = useState<CashoutRow | null>(null)
  const [rejecting, setRejecting] = useState<CashoutRow | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateBounds(dateFilter, customStart, customEnd)
      setCashouts((await adminOperations.getCashouts(status, start, end)) || [])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [status, dateFilter, customStart, customEnd])

  useEffect(() => {
    load()
  }, [load])

  const update = async (c: CashoutRow, next: 'approved' | 'rejected', why?: string) => {
    setBusyId(c.id)
    setError(null)
    try {
      await adminOperations.updateCashoutStatus(c.source, c.id, next, why)
      const patch = { status: next, rejection_reason: next === 'rejected' ? why ?? null : null }
      setCashouts((list) => list.map((x) => (x.id === c.id && x.source === c.source ? { ...x, ...patch } : x)))
      setViewing((v) => (v && v.id === c.id ? { ...v, ...patch } : v))
      setRejecting(null)
      setReason('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const by = (s: string) => cashouts.filter((c) => c.status.toLowerCase() === s)
  const isPending = (c: CashoutRow) => c.status.toLowerCase() === 'pending'

  const columns: Column<CashoutRow>[] = [
    { key: 'id', header: 'ID', cell: (c) => <span className="font-mono text-xs">{shortId(c.id)}</span>, hideOnMobile: true },
    { key: 'organizer', header: 'Organizer', cell: (c) => <span className="font-semibold">{c.organizer}</span> },
    { key: 'type', header: 'Type', cell: (c) => c.type },
    { key: 'amount', header: 'Amount', cell: (c) => naira(c.amount) },
    { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
    { key: 'date', header: 'Requested', cell: (c) => formatDateTime(c.created_at) },
  ]

  const approveReject = (c: CashoutRow) =>
    isPending(c) ? (
      <>
        <Button size="sm" onClick={() => update(c, 'approved')} disabled={busyId === c.id}>Approve</Button>
        <Button size="sm" variant="destructive" onClick={() => { setRejecting(c); setReason('') }} disabled={busyId === c.id}>Reject</Button>
      </>
    ) : null

  return (
    <AdminLayout>
      <PageHeader title="Cashouts" description="Review payout requests from organizers, hosts and venue owners." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending" value={by('pending').length} valueClassName="text-yellow-600" />
        <StatCard label="Approved" value={by('approved').length} valueClassName="text-green-600" />
        <StatCard label="Rejected" value={by('rejected').length} valueClassName="text-red-600" />
        <StatCard label="Total Amount" value={naira(cashouts.reduce((s, c) => s + Number(c.amount || 0), 0))} />
      </div>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 pt-5 md:grid-cols-3">
          <Select ariaLabel="Status" value={status} onValueChange={setStatus} options={[
            { value: 'all', label: 'All statuses' }, { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
          ]} />
          <Select ariaLabel="Date" value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)} options={[
            { value: 'all', label: 'All dates' }, { value: 'today', label: 'Today' }, { value: '7days', label: 'Last 7 days' }, { value: 'custom', label: 'Custom range' },
          ]} />
          {dateFilter === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <DatePicker label="Start date" value={customStart} onChange={setCustomStart} required />
              <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} required />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ErrorText error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Cashout requests ({cashouts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loading />
          ) : (
            <DataTable
              columns={columns}
              rows={cashouts}
              rowKey={(c) => `${c.source}-${c.id}`}
              actions={(c) => (
                <>
                  <Button variant="ghost" size="icon" aria-label="View cashout" onClick={() => setViewing(c)}><Eye /></Button>
                  {approveReject(c)}
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
                <DialogTitle>{viewing.type} cashout</DialogTitle>
                <DialogDescription>Requested {formatDateTime(viewing.created_at)}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Detail label="Organizer">{viewing.organizer}</Detail>
                <Detail label="Status"><StatusBadge status={viewing.status} /></Detail>
                <Detail label={viewing.type === 'Venue' ? 'Venue' : 'Event'}>{viewing.event_title || 'N/A'}</Detail>
                <Detail label="Amount">{naira(viewing.amount)}</Detail>
                <Detail label="Checked-in Participants">{viewing.checked_in ?? 'N/A'}</Detail>
                <Detail label="Super Code">{viewing.super_code || 'N/A'}</Detail>
                <Detail label="Account Name">{viewing.account_name || 'N/A'}</Detail>
                <Detail label="Bank">{viewing.bank_name || 'N/A'}</Detail>
                <Detail label="Account Number">{viewing.account_number || 'N/A'}</Detail>
                {viewing.rejection_reason ? <Detail label="Rejection Reason">{viewing.rejection_reason}</Detail> : null}
              </div>
              {isPending(viewing) ? <DialogFooter>{approveReject(viewing)}</DialogFooter> : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject cashout</DialogTitle>
            <DialogDescription>Tell the requester why. They will see this reason.</DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="reason">
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!reason.trim() || busyId === rejecting?.id} onClick={() => rejecting && update(rejecting, 'rejected', reason.trim())}>
              Reject Cashout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  )
}
