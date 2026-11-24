import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote, Bike, Building2, Check, CircleDollarSign, Handshake, Landmark, Link2, MapPin, Pause, Pencil, Play, Plus, Trash2, Trophy, Unlink, Wallet, XCircle,
} from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { ChartCanvas, chartColors } from '@/components/Chart'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { DatePicker, Field, Input, SearchInput, Textarea } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Menu } from '@/components/ui/menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, useConfirm, useStepUp, useToast } from '@/components/ui/feedback'
import { Detail, EmptyState, Loading, PageHeader, Pagination, Segmented, StatTile, usePaged } from '@/components/ui/page'
import { useCan } from '@/hooks/useAdminSession'
import { adminOperations, type AmbassadorDetail, type AmbassadorRow, type AssignableRow } from '@/lib/adminOperations'
import { cn, errorMessage, formatDate, formatDateTime, naira } from '@/lib/utils'

const EMPTY = { full_name: '', email: '', phone: '', city: '', state: '', bank_name: '', account_number: '', account_name: '', commission_rate: '', onboarded_at: '', notes: '' }
const TYPE_META = {
  venue: { label: 'Venue', icon: Building2, tone: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  match: { label: 'Match', icon: Trophy, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  cycling: { label: 'Ride', icon: Bike, tone: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
} as const

export default function AdminAmbassadors() {
  const can = useCan()
  const confirm = useConfirm()
  const stepUp = useStepUp()
  const toast = useToast()
  const [rows, setRows] = useState<AmbassadorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('active')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AmbassadorRow | null>(null)
  const [detail, setDetail] = useState<AmbassadorDetail | null>(null)
  const [editing, setEditing] = useState<AmbassadorRow | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignType, setAssignType] = useState<'venue' | 'match' | 'cycling'>('venue')
  const [assignQuery, setAssignQuery] = useState('')
  const [assignResults, setAssignResults] = useState<AssignableRow[] | null>(null)
  const [assignPick, setAssignPick] = useState<AssignableRow | null>(null)
  const [assignFrom, setAssignFrom] = useState('')
  const [payoutOpen, setPayoutOpen] = useState(false)
  const [payout, setPayout] = useState({ amount: '', note: '', start: '', end: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = (await adminOperations.getAmbassadors()) || []
      setRows(r)
      setSelected((s) => (s ? r.find((x) => x.id === s.id) ?? null : s))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const loadDetail = useCallback(async (id: string) => {
    setDetail(null)
    try {
      setDetail(await adminOperations.getAmbassador(id))
    } catch (e) {
      toast.error('Could not load ambassador', errorMessage(e))
    }
  }, [toast])
  useEffect(() => {
    if (selected) loadDetail(selected.id)
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!assignOpen) return
    const t = setTimeout(() => {
      setAssignResults(null)
      adminOperations.searchAssignable(assignType, assignQuery).then(setAssignResults).catch(() => setAssignResults([]))
    }, 250)
    return () => clearTimeout(t)
  }, [assignOpen, assignType, assignQuery])

  const counts = (s: string) => rows.filter((r) => r.status === s).length
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => (status === 'all' || r.status === status) && (!q || `${r.full_name} ${r.email ?? ''} ${r.phone ?? ''} ${r.city ?? ''}`.toLowerCase().includes(q)))
  }, [rows, status, search])
  const { pageRows, pagination } = usePaged(filtered, 10)
  const sum = (k: keyof AmbassadorRow) => rows.reduce((s, r) => s + Number(r[k] || 0), 0)

  const openForm = (r: AmbassadorRow | 'new') => {
    setForm(r === 'new' ? { ...EMPTY, onboarded_at: new Date().toLocaleDateString('en-CA') } : {
      full_name: r.full_name, email: r.email ?? '', phone: r.phone ?? '', city: r.city ?? '', state: r.state ?? '', bank_name: r.bank_name ?? '',
      account_number: r.account_number ?? '', account_name: r.account_name ?? '', commission_rate: r.commission_rate?.toString() ?? '',
      onboarded_at: r.onboarded_at ? new Date(r.onboarded_at).toLocaleDateString('en-CA') : '', notes: r.notes ?? '',
    })
    setEditing(r)
  }
  const setF = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })

  const save = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await adminOperations.saveAmbassador(editing === 'new' ? null : editing.id, form)
      toast.success(editing === 'new' ? 'Ambassador onboarded' : 'Ambassador updated')
      setEditing(null)
      load()
    } catch (e) {
      toast.error('Could not save', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (r: AmbassadorRow, next: 'active' | 'paused' | 'exited') => {
    const { ok } = await confirm({
      title: next === 'active' ? `Reactivate ${r.full_name}?` : next === 'paused' ? `Pause ${r.full_name}?` : `Mark ${r.full_name} as exited?`,
      description: next === 'active' ? 'They can be given new venues and events again.' : 'Their current assignments keep earning. You cannot give them new ones while they are not active.',
      confirmText: next === 'active' ? 'Reactivate' : next === 'paused' ? 'Pause' : 'Mark exited', tone: next === 'active' ? 'success' : 'danger',
    })
    if (!ok) return
    try {
      await adminOperations.setAmbassadorStatus(r.id, next)
      toast.success('Status updated')
      load()
    } catch (e) {
      toast.error('Could not update', errorMessage(e))
    }
  }

  const remove = async (r: AmbassadorRow) => {
    const { ok } = await confirm({ title: `Delete ${r.full_name}?`, description: 'This removes the ambassador and their assignments. Ambassadors with paid payouts cannot be deleted, mark them as exited instead.', confirmText: 'Delete', tone: 'danger', icon: <Trash2 /> })
    if (!ok) return
    if (!(await stepUp('delete this ambassador'))) return
    try {
      await adminOperations.deleteAmbassador(r.id)
      toast.success('Ambassador deleted')
      setSelected(null)
      load()
    } catch (e) {
      toast.error('Could not delete', errorMessage(e))
    }
  }

  const assign = async () => {
    if (!selected || !assignPick) return
    if (assignPick.current && assignPick.current !== selected.full_name) {
      const { ok } = await confirm({ title: `Move ${assignPick.name}?`, description: `It belongs to ${assignPick.current} now. Moving it stops their earnings from it from today.`, confirmText: 'Move it' })
      if (!ok) return
    }
    setBusy(true)
    try {
      await adminOperations.assignToAmbassador(selected.id, assignType, assignPick.id, assignType === 'venue' && assignFrom ? new Date(`${assignFrom}T00:00:00`).toISOString() : null)
      toast.success(`${TYPE_META[assignType].label} assigned`, assignPick.name)
      setAssignOpen(false)
      setAssignPick(null)
      loadDetail(selected.id)
      load()
    } catch (e) {
      toast.error('Could not assign', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const unassign = async (id: string, name: string) => {
    const { ok } = await confirm({ title: `Remove ${name}?`, description: 'Earnings already made stay. New activity from today will not count for this ambassador.', confirmText: 'Remove', tone: 'danger', icon: <Unlink /> })
    if (!ok || !selected) return
    try {
      await adminOperations.unassign(id)
      toast.success('Removed')
      loadDetail(selected.id)
      load()
    } catch (e) {
      toast.error('Could not remove', errorMessage(e))
    }
  }

  const createPayout = async () => {
    if (!selected) return
    const amount = Number(payout.amount)
    if (!(amount > 0)) return toast.error('Enter an amount')
    setBusy(true)
    try {
      await adminOperations.createAmbassadorPayout(selected.id, amount, payout.note, payout.start || null, payout.end || null)
      toast.success('Payout created', 'Send the money, then mark it as paid.')
      setPayoutOpen(false)
      loadDetail(selected.id)
      load()
    } catch (e) {
      toast.error('Could not create payout', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const markPaid = async (id: string, amount: number) => {
    if (!selected) return
    const { ok, reason } = await confirm({
      title: `Mark ${naira(amount)} as paid?`,
      description: <>Payouts are manual. Send {naira(amount)} to <b>{selected.account_name || selected.full_name}</b>, {selected.bank_name || 'bank not set'} {selected.account_number || ''} first, then add the transfer reference.</>,
      confirmText: 'Continue', tone: 'success', reasonLabel: 'Bank transfer reference',
    })
    if (!ok) return
    if (!(await stepUp('approve this payout'))) return
    try {
      await adminOperations.markAmbassadorPayoutPaid(id, reason)
      toast.success('Payout marked as paid')
      loadDetail(selected.id)
      load()
    } catch (e) {
      toast.error('Could not update', errorMessage(e))
    }
  }

  const cancelPayout = async (id: string) => {
    if (!selected) return
    const { ok, reason } = await confirm({ title: 'Cancel this payout?', description: 'The amount goes back into the ambassador\'s balance.', confirmText: 'Cancel payout', tone: 'danger', cancelText: 'Keep it', reasonLabel: 'Reason' })
    if (!ok) return
    try {
      await adminOperations.cancelAmbassadorPayout(id, reason)
      toast.success('Payout cancelled')
      loadDetail(selected.id)
      load()
    } catch (e) {
      toast.error('Could not cancel', errorMessage(e))
    }
  }

  const columns: Column<AmbassadorRow>[] = [
    {
      key: 'name', header: 'Ambassador', sort: (r) => r.full_name,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={r.full_name} className="h-10 w-10" />
          <div className="min-w-0">
            <p className="truncate font-bold">{r.full_name}</p>
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">{r.city ? <><MapPin className="h-3 w-3" />{r.city}</> : r.phone || r.email || 'No contact'}</p>
          </div>
        </div>
      ),
    },
    { key: 'venues', header: 'Venues', sort: (r) => r.venues, cell: (r) => <span className="font-semibold">{r.venues}</span> },
    { key: 'events', header: 'Events', sort: (r) => r.events, cell: (r) => <span className="font-semibold">{r.events}</span>, hideOnMobile: true },
    { key: 'revenue', header: 'Revenue brought', sort: (r) => r.revenue, cell: (r) => naira(r.revenue), hideOnMobile: true },
    { key: 'earned', header: 'Earned', sort: (r) => r.earned, cell: (r) => <span className="font-bold text-emerald-600 dark:text-emerald-400">{naira(r.earned)}</span> },
    { key: 'balance', header: 'Balance', sort: (r) => r.balance, cell: (r) => <span className={cn('font-bold', r.balance > 0 && 'text-amber-600')}>{naira(r.balance)}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} />, hideOnMobile: true },
  ]

  const ledgerRows = detail?.ledger ?? []
  const { pageRows: ledgerPage, pagination: ledgerPaging } = usePaged(ledgerRows, 10)
  const nameOf = (assignmentId: string) => detail?.assignments.find((a) => a.id === assignmentId)?.name ?? 'Assignment'

  return (
    <AdminLayout perm="ambassadors.view">
      <PageHeader eyebrow="Manage" title="Ambassadors" description="Onboard ambassadors, give them venues and events, and track what they earn.">
        {can('ambassadors.create') ? <Button onClick={() => openForm('new')}><Plus /> Onboard ambassador</Button> : null}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="green" label="Active Ambassadors" value={counts('active')} icon={<Handshake />} hint={`${rows.length} onboarded in total`} />
        <StatTile tone="violet" label="Venues Managed" value={sum('venues')} icon={<Building2 />} hint={`${sum('events')} events assigned`} />
        <StatTile tone="blue" label="Total Earned" value={naira(sum('earned'))} icon={<CircleDollarSign />} hint={`${naira(sum('earned_30d'))} in the last 30 days`} />
        <StatTile tone="amber" label="Owed to Ambassadors" value={naira(sum('balance'))} icon={<Wallet />} hint={`${naira(sum('paid'))} paid out so far`} />
      </div>

      <Segmented className="mb-4" value={status} onChange={setStatus} options={[
        { value: 'active', label: 'Active', count: counts('active') },
        { value: 'paused', label: 'Paused', count: counts('paused') },
        { value: 'exited', label: 'Exited', count: counts('exited') },
        { value: 'all', label: 'All', count: rows.length },
      ]} />

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      <Card>
        <CardHeader icon={<Handshake />} title={`Ambassadors (${filtered.length})`} description="Ranked by what they have earned." action={<SearchInput value={search} onChange={setSearch} placeholder="Search ambassadors" className="hidden w-60 sm:block" />} />
        <CardContent>
          <SearchInput value={search} onChange={setSearch} placeholder="Search ambassadors" className="mb-3 sm:hidden" />
          {loading ? <Loading /> : (
            <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} onRowClick={setSelected}
              empty={<EmptyState icon={<Handshake />} title="No ambassadors here yet" text="Onboard an ambassador, then assign venues and events to them." action={can('ambassadors.create') ? <Button onClick={() => openForm('new')}><Plus /> Onboard ambassador</Button> : undefined} />}
              actions={(r) => (
                <Menu items={[
                  { label: 'Open', icon: <Handshake />, onSelect: () => setSelected(r) },
                  { label: 'Edit details', icon: <Pencil />, onSelect: () => openForm(r), hidden: !can('ambassadors.edit') },
                  'separator',
                  { label: 'Pause', icon: <Pause />, onSelect: () => changeStatus(r, 'paused'), hidden: r.status !== 'active' || !can('ambassadors.edit') },
                  { label: 'Reactivate', icon: <Play />, tone: 'success', onSelect: () => changeStatus(r, 'active'), hidden: r.status === 'active' || !can('ambassadors.edit') },
                  { label: 'Mark as exited', icon: <XCircle />, tone: 'danger', onSelect: () => changeStatus(r, 'exited'), hidden: r.status === 'exited' || !can('ambassadors.edit') },
                  { label: 'Delete', icon: <Trash2 />, tone: 'danger', onSelect: () => remove(r), hidden: !can('ambassadors.delete') },
                ]} />
              )} />
          )}
          <Pagination {...pagination} />
        </CardContent>
      </Card>

      {/* Ambassador profile */}
      <Modal
        open={Boolean(selected)}
        onOpenChange={(o) => !o && setSelected(null)}
        size="xl"
        title={selected ? <span className="flex items-center gap-3"><Avatar name={selected.full_name} className="h-11 w-11" /><span>{selected.full_name} <StatusBadge status={selected.status} className="ml-1 align-middle" /></span></span> : ''}
        description={selected ? `Onboarded ${formatDate(selected.onboarded_at)} · earns ${selected.commission_rate ?? 'the default'}${selected.commission_rate != null ? '%' : ' rate'} of SportCliq's fee` : ''}
        footer={selected ? (
          <>
            {can('ambassadors.edit') ? <Button variant="outline" onClick={() => openForm(selected)}><Pencil /> Edit</Button> : null}
            {can('ambassadors.assign') && selected.status === 'active' ? <Button variant="outline" onClick={() => { setAssignOpen(true); setAssignPick(null); setAssignQuery('') }}><Link2 /> Assign</Button> : null}
            {can('ambassadors.payout') ? <Button onClick={() => { setPayout({ amount: selected.balance > 0 ? String(Math.floor(selected.balance)) : '', note: '', start: '', end: '' }); setPayoutOpen(true) }} disabled={selected.balance <= 0}><Banknote /> Create payout</Button> : null}
          </>
        ) : null}
      >
        {selected ? (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="assignments">Venues and events</TabsTrigger>
              <TabsTrigger value="payouts">Payouts</TabsTrigger>
              <TabsTrigger value="ledger">Earnings history</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Detail label="Revenue brought">{naira(selected.revenue)}</Detail>
                <Detail label="SportCliq fee from it">{naira(selected.commission)}</Detail>
                <Detail label="Earned">{naira(selected.earned)}</Detail>
                <Detail label="Balance owed"><span className="text-amber-600">{naira(selected.balance)}</span></Detail>
                <Detail label="Paid out">{naira(selected.paid)}</Detail>
                <Detail label="Pending payouts">{naira(selected.pending)}</Detail>
                <Detail label="Venues">{selected.venues}</Detail>
                <Detail label="Events">{selected.events}</Detail>
              </div>
              <Card className="mt-4 p-4 shadow-none ring-1">
                <p className="mb-2 text-sm font-bold">Earnings, last 6 months</p>
                {!detail ? <Loading rows={2} /> : (
                  <ChartCanvas label="Monthly ambassador earnings" className="h-48" config={(dark) => {
                    const c = chartColors(dark)
                    return {
                      type: 'bar',
                      data: { labels: detail.monthly.map((m) => new Date(m.month).toLocaleDateString(undefined, { month: 'short' })), datasets: [{ data: detail.monthly.map((m) => Number(m.earning)), backgroundColor: '#0fb863', borderRadius: 8, maxBarThickness: 32 }] },
                      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => naira(x.parsed.y) } } }, scales: { x: { ticks: { color: c.tick }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: c.tick }, grid: { color: c.grid }, border: { display: false } } } },
                    }
                  }} />
                )}
              </Card>
              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Detail label="Phone">{selected.phone || 'N/A'}</Detail>
                <Detail label="Email">{selected.email || 'N/A'}</Detail>
                <Detail label="Location">{[selected.city, selected.state].filter(Boolean).join(', ') || 'N/A'}</Detail>
                <Detail label="Last paid">{formatDateTime(selected.last_paid)}</Detail>
              </div>
              <div className="mt-4 rounded-3xl bg-gray-950 p-5 text-white dark:bg-white dark:text-gray-950">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide opacity-60"><Landmark className="h-3.5 w-3.5" /> Payout bank details</p>
                <p className="mt-3 text-lg font-extrabold">{selected.account_name || 'Not set'}</p>
                <p className="text-sm opacity-70">{selected.bank_name || 'Bank not set'}</p>
                <p className="mt-2 font-mono text-lg font-bold tracking-widest">{selected.account_number || 'No account number'}</p>
              </div>
              {selected.notes ? <p className="mt-4 rounded-2xl bg-muted/60 p-4 text-sm">{selected.notes}</p> : null}
            </TabsContent>

            <TabsContent value="assignments">
              {!detail ? <Loading rows={3} /> : detail.assignments.length === 0 ? (
                <EmptyState icon={<Link2 />} title="Nothing assigned yet" text="Assign the venues and events this ambassador brought in." action={can('ambassadors.assign') && selected.status === 'active' ? <Button onClick={() => { setAssignOpen(true); setAssignPick(null) }}><Link2 /> Assign</Button> : undefined} />
              ) : (
                <ul className="space-y-2">
                  {detail.assignments.map((a) => {
                    const meta = TYPE_META[a.entity_type]
                    return (
                      <li key={a.id} className={cn('flex flex-col gap-3 rounded-2xl bg-muted/60 p-3 sm:flex-row sm:items-center', !a.active && 'opacity-60')}>
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className={cn('rounded-2xl p-2.5', meta.tone)}><meta.icon className="h-4 w-4" /></span>
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate font-bold">{a.name}{!a.active ? <Badge variant="secondary">Removed {formatDate(a.unassigned_at)}</Badge> : null}</p>
                            <p className="truncate text-xs text-muted-foreground">{meta.label} · {a.subtitle} · {a.entity_type === 'venue' ? `counts from ${formatDate(a.effective_from)}` : `assigned ${formatDate(a.assigned_at)}`}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4 sm:justify-end">
                          <div className="text-right text-xs">
                            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{naira(a.earning)}</p>
                            <p className="text-muted-foreground">from {naira(a.revenue)}</p>
                          </div>
                          {a.active && can('ambassadors.assign') ? <Button variant="ghost" size="icon-sm" aria-label={`Remove ${a.name}`} onClick={() => unassign(a.id, a.name)}><Unlink className="text-red-600" /></Button> : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="payouts">
              <Alert variant="info" className="mb-3" icon={<Landmark />}>Payouts are manual. Create a payout, send the money from the SportCliq bank account, then mark it paid with the transfer reference.</Alert>
              {!detail ? <Loading rows={3} /> : (
                <DataTable rows={detail.payouts} rowKey={(p) => p.id} empty={<EmptyState icon={<Banknote />} title="No payouts yet" />}
                  columns={[
                    { key: 'amount', header: 'Amount', cell: (p) => <div><p className="font-extrabold">{naira(p.amount)}</p><p className="text-xs text-muted-foreground">{p.note || (p.period_start ? `${formatDate(p.period_start)} to ${formatDate(p.period_end)}` : 'Manual bank transfer')}</p></div> },
                    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
                    { key: 'ref', header: 'Reference', cell: (p) => p.reference ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-bold">{p.reference}</code> : p.cancel_reason || 'N/A' },
                    { key: 'when', header: 'Date', cell: (p) => <div className="text-xs"><p>{formatDate(p.paid_at || p.created_at)}</p><p className="text-muted-foreground">{p.paid_by ? `paid by ${p.paid_by}` : p.created_by ? `by ${p.created_by}` : ''}</p></div>, hideOnMobile: true },
                  ]}
                  actions={(p) => (p.status === 'pending' && can('ambassadors.payout') ? (
                    <>
                      <Button size="sm" onClick={() => markPaid(p.id, p.amount)}><Check /> Mark paid</Button>
                      <Button size="sm" variant="soft-danger" onClick={() => cancelPayout(p.id)}><XCircle /> Cancel</Button>
                    </>
                  ) : null)} />
              )}
            </TabsContent>

            <TabsContent value="ledger">
              {!detail ? <Loading rows={3} /> : (
                <>
                  <DataTable rows={ledgerPage} rowKey={(l) => `${l.assignment_id}-${l.at}-${l.revenue}`} empty={<EmptyState icon={<CircleDollarSign />} title="No earnings yet" text="Earnings show here when assigned venues and events take paid bookings." />}
                    columns={[
                      { key: 'what', header: 'From', cell: (l) => <div><p className="font-semibold">{nameOf(l.assignment_id)}</p><p className="text-xs text-muted-foreground">{TYPE_META[l.entity_type as keyof typeof TYPE_META]?.label} · {formatDateTime(l.at)}</p></div> },
                      { key: 'revenue', header: 'Revenue', cell: (l) => naira(l.revenue) },
                      { key: 'fee', header: 'SportCliq fee', cell: (l) => naira(l.commission), hideOnMobile: true },
                      { key: 'earning', header: 'Earned', cell: (l) => <span className="font-bold text-emerald-600 dark:text-emerald-400">{naira(l.earning)}</span> },
                    ]} />
                  <Pagination {...ledgerPaging} />
                </>
              )}
            </TabsContent>
          </Tabs>
        ) : null}
      </Modal>

      {/* Onboard and edit */}
      <Modal
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        size="lg"
        icon={editing === 'new' ? <Plus /> : <Pencil />}
        title={editing === 'new' ? 'Onboard an ambassador' : 'Edit ambassador'}
        description="Bank details are used for manual payouts."
        footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={busy} disabled={!form.full_name.trim()}>{editing === 'new' ? 'Onboard' : 'Save changes'}</Button></>}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="a-name" className="sm:col-span-2"><Input id="a-name" value={form.full_name} onChange={setF('full_name')} /></Field>
          <Field label="Phone" htmlFor="a-phone"><Input id="a-phone" inputMode="tel" value={form.phone} onChange={setF('phone')} /></Field>
          <Field label="Email" htmlFor="a-email"><Input id="a-email" type="email" value={form.email} onChange={setF('email')} /></Field>
          <Field label="City" htmlFor="a-city"><Input id="a-city" value={form.city} onChange={setF('city')} /></Field>
          <Field label="State" htmlFor="a-state"><Input id="a-state" value={form.state} onChange={setF('state')} /></Field>
          <Field label="Bank" htmlFor="a-bank"><Input id="a-bank" value={form.bank_name} onChange={setF('bank_name')} /></Field>
          <Field label="Account number" htmlFor="a-acct"><Input id="a-acct" inputMode="numeric" maxLength={10} value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Account name" htmlFor="a-acctname" className="sm:col-span-2"><Input id="a-acctname" value={form.account_name} onChange={setF('account_name')} /></Field>
          <Field label="Their share of SportCliq's fee (%)" htmlFor="a-rate" hint="Leave empty to use the default from Settings"><Input id="a-rate" type="number" min={0} max={100} step={0.5} value={form.commission_rate} onChange={setF('commission_rate')} /></Field>
          <Field label="Onboarded on" htmlFor="a-date"><DatePicker id="a-date" value={form.onboarded_at} onChange={(v) => setForm({ ...form, onboarded_at: v })} /></Field>
          <Field label="Notes" htmlFor="a-notes" className="sm:col-span-2"><Textarea id="a-notes" value={form.notes} onChange={setF('notes')} /></Field>
        </div>
      </Modal>

      {/* Assign */}
      <Modal
        open={assignOpen}
        onOpenChange={setAssignOpen}
        size="lg"
        icon={<Link2 />}
        title={`Assign to ${selected?.full_name ?? ''}`}
        description="Pick a venue, match or ride this ambassador brought in."
        footer={<><Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button><Button onClick={assign} loading={busy} disabled={!assignPick}>Assign</Button></>}
      >
        <div className="space-y-4">
          <Segmented value={assignType} onChange={(v) => { setAssignType(v); setAssignPick(null) }} options={[
            { value: 'venue', label: 'Venues' }, { value: 'match', label: 'Matches' }, { value: 'cycling', label: 'Rides' },
          ]} />
          <SearchInput value={assignQuery} onChange={setAssignQuery} placeholder={`Search ${assignType === 'venue' ? 'venues' : assignType === 'match' ? 'matches' : 'rides'}`} />
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {assignResults === null ? <Loading rows={3} /> : assignResults.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing found</p> : assignResults.map((r) => {
              const meta = TYPE_META[assignType]
              const picked = assignPick?.id === r.id
              return (
                <button key={r.id} type="button" onClick={() => setAssignPick(r)} aria-pressed={picked}
                  className={cn('flex w-full cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all', picked ? 'border-primary bg-playarena-50 dark:bg-playarena-950' : 'border-transparent bg-muted/60 hover:bg-muted')}>
                  <span className={cn('rounded-xl p-2', meta.tone)}><meta.icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{r.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>
                  </span>
                  {r.current ? <Badge variant={r.current === selected?.full_name ? 'success' : 'warning'}>{r.current === selected?.full_name ? 'Already theirs' : r.current}</Badge> : null}
                </button>
              )
            })}
          </div>
          {assignType === 'venue' ? (
            <Field label="Count bookings from" htmlFor="as-from" hint="Leave empty to count from today. Set an earlier date if they brought the venue in before."><DatePicker id="as-from" value={assignFrom} onChange={setAssignFrom} /></Field>
          ) : <p className="text-xs text-muted-foreground">All paid activity on the event counts, whenever it happened.</p>}
        </div>
      </Modal>

      {/* Payout */}
      <Modal
        open={payoutOpen}
        onOpenChange={setPayoutOpen}
        icon={<Banknote />}
        title="Create a payout"
        description={selected ? `Available balance ${naira(selected.balance)}` : ''}
        footer={<><Button variant="outline" onClick={() => setPayoutOpen(false)}>Cancel</Button><Button onClick={createPayout} loading={busy} disabled={!(Number(payout.amount) > 0)}>Create payout</Button></>}
      >
        <div className="space-y-4">
          <Field label="Amount (₦)" htmlFor="p-amount"><Input id="p-amount" type="number" min={1} max={selected?.balance} value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: e.target.value })} className="text-lg font-bold" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Period start" htmlFor="p-start"><DatePicker id="p-start" value={payout.start} onChange={(v) => setPayout({ ...payout, start: v })} /></Field>
            <Field label="Period end" htmlFor="p-end"><DatePicker id="p-end" value={payout.end} onChange={(v) => setPayout({ ...payout, end: v })} /></Field>
          </div>
          <Field label="Note" htmlFor="p-note"><Input id="p-note" value={payout.note} onChange={(e) => setPayout({ ...payout, note: e.target.value })} placeholder="November earnings" /></Field>
          <Alert variant="warning">This only records the payout. Send the money yourself, then mark it as paid with the transfer reference.</Alert>
        </div>
      </Modal>
    </AdminLayout>
  )
}
