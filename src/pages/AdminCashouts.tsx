import { useCallback, useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { Check, CheckCircle2, Clock, Copy, Download, Eye, Landmark, Wallet, X, XCircle } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { DatePicker, SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Alert, useConfirm, useStepUp, useToast } from '@/components/ui/feedback'
import { useCan } from '@/hooks/useAdminSession'
import { Detail, EmptyState, FilterBar, Loading, PageHeader, Pagination, Segmented, StatTile, usePaged } from '@/components/ui/page'
import { adminOperations, type CashoutRow } from '@/lib/adminOperations'
import { dateBounds, downloadBlob, errorMessage, formatDateTime, naira, shortId, type DateFilter } from '@/lib/utils'

export default function AdminCashouts() {
  const confirm = useConfirm()
  const stepUp = useStepUp()
  const can = useCan()
  const toast = useToast()
  const [cashouts, setCashouts] = useState<CashoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('pending')
  const [type, setType] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [viewing, setViewing] = useState<CashoutRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (dateFilter === 'custom' && (!customStart || !customEnd)) return
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateBounds(dateFilter, customStart, customEnd)
      setCashouts((await adminOperations.getCashouts('all', start, end)) || [])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [dateFilter, customStart, customEnd])

  useEffect(() => {
    load()
  }, [load])

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cashouts.filter((c) => (type === 'all' || c.type === type) && (!q || [c.organizer, c.event_title, c.account_name, c.super_code].some((x) => (x || '').toLowerCase().includes(q))))
  }, [cashouts, type, search])
  const by = (s: string) => scoped.filter((c) => c.status.toLowerCase() === s)
  const sum = (list: CashoutRow[]) => list.reduce((s, c) => s + Number(c.amount || 0), 0)
  const filtered = status === 'all' ? scoped : by(status)
  const { pageRows, pagination } = usePaged(filtered, 10)

  const patch = (c: CashoutRow, p: Partial<CashoutRow>) => {
    setCashouts((list) => list.map((x) => (x.id === c.id && x.source === c.source ? { ...x, ...p } : x)))
    setViewing((v) => (v && v.id === c.id ? { ...v, ...p } : v))
  }

  const approve = async (c: CashoutRow) => {
    const { ok, reason } = await confirm({
      title: `Approve ${naira(c.amount)}?`,
      description: <>Payouts are manual. Send <b>{naira(c.amount)}</b> to <b>{c.account_name || c.organizer}</b>, {c.bank_name} {c.account_number} from the SportCliq bank account first. Then add the transfer reference here.</>,
      confirmText: 'Continue', tone: 'success', icon: <CheckCircle2 />, reasonLabel: 'Bank transfer reference', reasonOptional: true,
    })
    if (!ok) return
    if (!(await stepUp('approve this payout'))) return
    setBusyId(c.id)
    try {
      await adminOperations.updateCashoutStatus(c.source, c.id, 'approved', undefined, reason)
      patch(c, { status: 'approved', rejection_reason: null })
      toast.success('Cashout approved', `${naira(c.amount)} to ${c.organizer}`)
    } catch (e) {
      toast.error('Could not approve', errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const reject = async (c: CashoutRow) => {
    const { ok, reason } = await confirm({
      title: 'Reject cashout',
      description: 'Tell the requester why. They will see this reason.',
      confirmText: 'Reject Cashout', tone: 'danger', icon: <XCircle />, reasonLabel: 'Reason',
    })
    if (!ok) return
    setBusyId(c.id)
    try {
      await adminOperations.updateCashoutStatus(c.source, c.id, 'rejected', reason)
      patch(c, { status: 'rejected', rejection_reason: reason })
      toast.success('Cashout rejected')
    } catch (e) {
      toast.error('Could not reject', errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const copy = (text: string | null) => {
    if (!text) return
    navigator.clipboard?.writeText(text).then(() => toast.info('Copied', text))
  }

  const exportCsv = () => {
    const csv = Papa.unparse(filtered.map((c) => ({
      ID: c.id, Organizer: c.organizer, Type: c.type, Amount: c.amount, Status: c.status, Requested: formatDateTime(c.created_at),
      Event: c.event_title ?? '', 'Account Name': c.account_name ?? '', Bank: c.bank_name ?? '', 'Account Number': c.account_number ?? '', 'Rejection Reason': c.rejection_reason ?? '',
    })))
    downloadBlob('﻿' + csv, `cashouts-${status}.csv`, 'text/csv;charset=utf-8')
  }

  const actions = (c: CashoutRow) => (
    <>
      <Button variant="ghost" size="icon-sm" aria-label="View cashout" onClick={() => setViewing(c)}><Eye /></Button>
      {c.status.toLowerCase() === 'pending' && can('cashouts.approve') ? (
        <>
          <Button size="sm" onClick={() => approve(c)} disabled={busyId === c.id}><Check /> Approve</Button>
          <Button size="sm" variant="soft-danger" onClick={() => reject(c)} disabled={busyId === c.id}><X /> Reject</Button>
        </>
      ) : null}
    </>
  )

  const columns: Column<CashoutRow>[] = [
    {
      key: 'organizer', header: 'Organizer', sort: (c) => c.organizer,
      cell: (c) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={c.organizer} className="h-10 w-10" />
          <div className="min-w-0">
            <p className="truncate font-bold">{c.organizer}</p>
            <p className="truncate text-xs text-muted-foreground">{c.event_title ?? 'N/A'} · <span className="font-mono">{shortId(c.id)}</span></p>
          </div>
        </div>
      ),
    },
    { key: 'type', header: 'Type', sort: (c) => c.type, cell: (c) => <Badge variant={c.type === 'Venue' ? 'violet' : c.type === 'Cycling' ? 'info' : 'success'}>{c.type}</Badge> },
    { key: 'amount', header: 'Amount', sort: (c) => Number(c.amount), cell: (c) => <span className="font-extrabold">{naira(c.amount)}</span> },
    { key: 'status', header: 'Status', sort: (c) => c.status, cell: (c) => <StatusBadge status={c.status} /> },
    { key: 'date', header: 'Requested', sort: (c) => c.created_at, cell: (c) => <span className="text-sm">{formatDateTime(c.created_at)}</span>, hideOnMobile: true },
  ]

  return (
    <AdminLayout onNewNotification={load} perm="cashouts.view">
      <PageHeader eyebrow="Money" title="Cashouts" description="Review payout requests from organizers, hosts and venue owners.">
        {can('cashouts.export') ? <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}><Download /> Export CSV</Button> : null}
      </PageHeader>

      <Alert variant="info" className="mb-4" icon={<Landmark />}>
        <b>Payouts are manual for now.</b> The portal is not connected to a transfer service, so it never moves money. Send each payout from the SportCliq bank account, then approve it here with the transfer reference. Approving asks for your authenticator code.
      </Alert>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="amber" label="Pending" value={by('pending').length} hint={naira(sum(by('pending')))} icon={<Clock />} onClick={() => setStatus('pending')} active={status === 'pending'} />
        <StatTile tone="green" label="Approved" value={by('approved').length} hint={naira(sum(by('approved')))} icon={<Check />} onClick={() => setStatus('approved')} active={status === 'approved'} />
        <StatTile tone="rose" label="Rejected" value={by('rejected').length} hint={naira(sum(by('rejected')))} icon={<X />} onClick={() => setStatus('rejected')} active={status === 'rejected'} />
        <StatTile tone="black" label="Total Amount" value={naira(sum(scoped))} hint={`${scoped.length} requests`} icon={<Wallet />} onClick={() => setStatus('all')} active={status === 'all'} />
      </div>

      <Segmented className="mb-4" value={status} onChange={setStatus} options={[
        { value: 'pending', label: 'Pending', count: by('pending').length },
        { value: 'approved', label: 'Approved', count: by('approved').length },
        { value: 'rejected', label: 'Rejected', count: by('rejected').length },
        { value: 'all', label: 'All', count: scoped.length },
      ]} />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Organizer, event or account" />
        <Select ariaLabel="Type" value={type} onValueChange={setType} options={[{ value: 'all', label: 'All types' }, { value: 'Match', label: 'Match' }, { value: 'Cycling', label: 'Cycling' }, { value: 'Venue', label: 'Venue' }]} />
        <Select ariaLabel="Date" value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)} options={[
          { value: 'all', label: 'Any date' }, { value: 'today', label: 'Today' }, { value: '7days', label: 'Last 7 days' }, { value: 'custom', label: 'Custom range' },
        ]} />
        {dateFilter === 'custom' ? (
          <div className="grid grid-cols-2 gap-3">
            <DatePicker label="Start date" value={customStart} onChange={setCustomStart} required />
            <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} required />
          </div>
        ) : null}
      </FilterBar>

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      <Card>
        <CardHeader icon={<Wallet />} title={`Cashout requests (${filtered.length})`} />
        <CardContent>
          {loading ? <Loading /> : (
            <DataTable columns={columns} rows={pageRows} rowKey={(c) => `${c.source}-${c.id}`} onRowClick={setViewing} actions={actions}
              empty={<EmptyState icon={<CheckCircle2 />} title={status === 'pending' ? 'All caught up' : 'No cashouts here'} text={status === 'pending' ? 'No cashout is waiting for review.' : 'Try another filter.'} />} />
          )}
          <Pagination {...pagination} />
        </CardContent>
      </Card>

      <Modal
        open={Boolean(viewing)}
        onOpenChange={(o) => !o && setViewing(null)}
        size="lg"
        icon={<Wallet />}
        title={viewing ? `${viewing.type} cashout · ${naira(viewing.amount)}` : ''}
        description={viewing ? `Requested ${formatDateTime(viewing.created_at)}` : ''}
        footer={viewing && viewing.status.toLowerCase() === 'pending' && can('cashouts.approve') ? (
          <>
            <Button variant="soft-danger" onClick={() => reject(viewing)} disabled={busyId === viewing.id}><X /> Reject</Button>
            <Button onClick={() => approve(viewing)} disabled={busyId === viewing.id}><Check /> Approve</Button>
          </>
        ) : null}
      >
        {viewing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5">
              <Detail label="Organizer">{viewing.organizer}</Detail>
              <Detail label="Status"><StatusBadge status={viewing.status} /></Detail>
              <Detail label={viewing.type === 'Venue' ? 'Venue' : 'Event'}>{viewing.event_title || 'N/A'}</Detail>
              <Detail label="Checked-in Participants">{viewing.checked_in ?? 'N/A'}</Detail>
              <Detail label="Super Code">{viewing.super_code || 'N/A'}</Detail>
              <Detail label="Amount">{naira(viewing.amount)}</Detail>
            </div>
            <div className="rounded-3xl bg-gray-950 p-5 text-white dark:bg-white dark:text-gray-950">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide opacity-60"><Landmark className="h-3.5 w-3.5" /> Bank details</p>
              <p className="mt-3 text-lg font-extrabold">{viewing.account_name || 'N/A'}</p>
              <p className="text-sm opacity-70">{viewing.bank_name || 'N/A'}</p>
              <div className="mt-3 flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3 dark:bg-black/5">
                <span className="font-mono text-lg font-bold tracking-widest">{viewing.account_number || 'N/A'}</span>
                {viewing.account_number ? <button type="button" onClick={() => copy(viewing.account_number)} aria-label="Copy account number" className="cursor-pointer rounded-lg p-2 hover:bg-white/10"><Copy className="h-4 w-4" /></button> : null}
              </div>
            </div>
            {viewing.rejection_reason ? <Alert>Rejected: {viewing.rejection_reason}</Alert> : null}
          </div>
        ) : null}
      </Modal>
    </AdminLayout>
  )
}
