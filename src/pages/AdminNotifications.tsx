import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Activity, Bell, Building2, Calendar, CheckCheck, Eye, Link2, Mail, Megaphone, MousePointerClick, RefreshCw, Send, Smartphone, Sparkles, Trash2, User, Users, Wrench, XCircle } from 'lucide-react'
import { ChartCanvas, chartColors } from '@/components/Chart'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { DatePicker, Field, Input, SearchInput, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Alert, useConfirm, useStepUp, useToast } from '@/components/ui/feedback'
import { EmptyState, FilterBar, Loading, PageHeader, Pagination, StatTile, usePaged } from '@/components/ui/page'
import { useCan } from '@/hooks/useAdminSession'
import { adminOperations, type AdminNotification, type NotificationPerformance, type PushStats } from '@/lib/adminOperations'
import { cn, dateBounds, errorMessage, shortId, type DateFilter } from '@/lib/utils'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z]/g, '')

const TARGETS = [
  { value: 'all', label: 'All users', icon: Users },
  { value: 'user', label: 'Specific user', icon: User },
  { value: 'event', label: 'Event participants', icon: Calendar },
  { value: 'organizers', label: 'Organizers', icon: Megaphone },
  { value: 'venue_owners', label: 'Venue owners', icon: Building2 },
]
const TYPES = [
  { value: 'push', label: 'Push', icon: Smartphone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'both', label: 'Both', icon: Send },
]
const LINKS = [
  { value: '/', label: 'Home' },
  { value: '/matches', label: 'Matches' },
  { value: '/cycling-activities', label: 'Cycling' },
  { value: '/venues', label: 'Venues' },
  { value: '/organize', label: 'Organize a match' },
  { value: '/profile/wallet', label: 'Wallet' },
  { value: '/profile/my-matches', label: 'My matches' },
  { value: 'custom', label: 'Custom link' },
]
type Summary = Record<string, { push_stats: PushStats; views: number; opens: number; clicks: number }>
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '0%')

const TEMPLATES = [
  { name: 'Maintenance Notice', icon: Wrench, tone: 'bg-amber-500', target: 'all', type: 'both', title: 'Scheduled maintenance', message: 'SportCliq will be briefly unavailable for scheduled maintenance. Thank you for your patience.' },
  { name: 'Event Update', icon: Calendar, tone: 'bg-sky-500', target: 'event', type: 'push', title: 'Event update', message: 'There is an update to your event. Please check the event page for the latest details.' },
  { name: 'Welcome Message', icon: Sparkles, tone: 'bg-emerald-500', target: 'user', type: 'email', title: 'Welcome to SportCliq', message: 'Welcome to SportCliq! Find games near you, join a squad and start playing.' },
]

function typeBadge(t: string) {
  const n = norm(t)
  if (n === 'email') return <Badge variant="info"><Mail /> Email</Badge>
  if (n === 'both') return <Badge variant="success"><Send /> Both</Badge>
  return <Badge variant="violet"><Smartphone /> Push</Badge>
}

export default function AdminNotifications() {
  const can = useCan()
  const stepUp = useStepUp()
  const confirm = useConfirm()
  const toast = useToast()
  const [items, setItems] = useState<AdminNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [target, setTarget] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ type: 'push', target: 'all', targetId: '', title: '', message: '', link: '/', customLink: '', image: '' })
  const [sending, setSending] = useState(false)
  const [summary, setSummary] = useState<Summary>({})
  const [perf, setPerf] = useState<{ n: AdminNotification; data: NotificationPerformance | null; loading: boolean; refreshing: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateBounds(dateFilter, customStart, customEnd)
      setItems(await adminOperations.getNotifications({ excludeAlerts: true, start, end, limit: 1000 }))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [dateFilter, customStart, customEnd])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((n) => (target === 'all' || norm(n.target_type) === norm(target) || (norm(target) === 'venueowners' && norm(n.target_type) === 'venueowner')) && (!q || `${n.title} ${n.message}`.toLowerCase().includes(q)))
  }, [items, target, search])
  const { pageRows, pagination } = usePaged(filtered, 10)

  // Opens and clicks for the rows on screen
  const pageIds = pageRows.map((n) => n.id).join(',')
  useEffect(() => {
    if (!pageIds) return
    adminOperations.notificationSummary(pageIds.split(',')).then((s) => setSummary((old) => ({ ...old, ...s }))).catch(() => undefined)
  }, [pageIds])

  const openPerf = async (n: AdminNotification) => {
    setPerf({ n, data: null, loading: true, refreshing: false })
    try {
      const data = await adminOperations.notificationPerformance(n.id)
      setPerf({ n, data, loading: false, refreshing: false })
      // Pull fresh delivery numbers from OneSignal when they are missing or older than 10 minutes
      if (data.onesignal_id && (!data.stats_synced_at || Date.now() - new Date(data.stats_synced_at).getTime() > 600000)) refreshPerf(n)
    } catch (e) {
      setPerf(null)
      toast.error('Could not load performance', errorMessage(e))
    }
  }
  const refreshPerf = async (n: AdminNotification) => {
    setPerf((p) => (p ? { ...p, refreshing: true } : p))
    try {
      await adminOperations.refreshPushStats(n.id)
      const data = await adminOperations.notificationPerformance(n.id)
      setPerf((p) => (p && p.n.id === n.id ? { ...p, data, refreshing: false } : p))
      setSummary((old) => ({ ...old, [n.id]: { push_stats: data.push_stats, views: data.inapp_views, opens: data.inapp_opens, clicks: data.inapp_clicks } }))
    } catch (e) {
      setPerf((p) => (p ? { ...p, refreshing: false } : p))
      toast.error('Could not refresh from OneSignal', errorMessage(e))
    }
  }

  const needsId = form.target === 'user' || form.target === 'event'
  const link = form.link === 'custom' ? form.customLink.trim() : form.link
  const linkOk = !link || link.startsWith('/') || link.startsWith('https://')
  const imageOk = !form.image.trim() || form.image.trim().startsWith('https://')
  const valid = form.message.trim().length > 0 && form.message.length <= 500 && (!needsId || UUID_RE.test(form.targetId.trim())) && linkOk && imageOk

  const openWith = (t?: (typeof TEMPLATES)[number]) => {
    const blank = { link: '/', customLink: '', image: '' }
    setForm(t ? { type: t.type, target: t.target, targetId: '', title: t.title, message: t.message, ...blank } : { type: 'push', target: 'all', targetId: '', title: '', message: '', ...blank })
    setOpen(true)
  }

  const send = async () => {
    const audience = TARGETS.find((t) => t.value === form.target)?.label.toLowerCase()
    const { ok } = await confirm({ title: 'Send this notification?', description: `It goes to ${audience} by ${form.type === 'both' ? 'push and email' : form.type}. This cannot be unsent.`, confirmText: 'Send now', icon: <Send /> })
    if (!ok) return
    setSending(true)
    try {
      const n = await adminOperations.sendNotification({ type: form.type, target: form.target, targetId: needsId ? form.targetId.trim() : null, title: form.title.trim(), message: form.message.trim(), link, image: form.image.trim() })
      setItems((list) => [n, ...list])
      setOpen(false)
      await deliver(n)
    } catch (e) {
      toast.error('Could not send', errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  /** Hands the notification to OneSignal and Resend through the admin-dispatch function. */
  const deliver = async (n: AdminNotification, ask = false) => {
    if (ask) {
      const { ok } = await confirm({ title: 'Deliver this notification now?', description: `"${n.title}" goes out by ${norm(n.type) === 'both' ? 'push and email' : norm(n.type)}. People who already got it may get it again.`, confirmText: 'Deliver', icon: <Send /> })
      if (!ok) return
    }
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, status: 'sending' } : x)))
    try {
      const r = await adminOperations.dispatchNotification(n.id)
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, status: r.status, push_sent: r.push_sent, email_sent: r.email_sent, delivery_error: r.error ?? null } : x)))
      if (r.ok) toast.success('Notification delivered', `${r.push_sent.toLocaleString()} push, ${r.email_sent.toLocaleString()} email`)
      else toast.error('Delivery had problems', r.error)
    } catch (e) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, status: 'failed', delivery_error: errorMessage(e) } : x)))
      toast.error('Saved but not delivered', errorMessage(e))
    }
  }

  const remove = async (n: AdminNotification) => {
    const { ok } = await confirm({ title: 'Delete this notification?', description: 'It is removed from the history for everyone.', confirmText: 'Delete', tone: 'danger', icon: <Trash2 /> })
    if (!ok) return
    if (!(await stepUp('delete this notification'))) return
    try {
      await adminOperations.deleteNotification(n.id)
      setItems((l) => l.filter((x) => x.id !== n.id))
      toast.success('Notification deleted')
    } catch (e) {
      toast.error('Could not delete', errorMessage(e))
    }
  }

  const markAll = async () => {
    const { ok } = await confirm({ title: 'Mark all alerts as read?', description: 'Every admin alert in the bell is marked as read.', confirmText: 'Mark all read', icon: <CheckCheck /> })
    if (!ok) return
    try {
      await adminOperations.markAllAlertsRead()
      toast.success('All alerts marked as read')
    } catch (e) {
      toast.error('Could not update', errorMessage(e))
    }
  }

  const columns: Column<AdminNotification>[] = [
    {
      key: 'message', header: 'Message', sort: (n) => n.title,
      cell: (n) => (
        <div className="min-w-0 max-w-md">
          <p className="truncate font-bold">{n.title}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground" title={n.message}>{n.message}</p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{shortId(n.id)}</p>
        </div>
      ),
    },
    {
      key: 'target', header: 'Target', sort: (n) => n.target_type,
      cell: (n) => {
        const t = TARGETS.find((x) => norm(x.value) === norm(n.target_type)) ?? TARGETS[0]
        return <span className="inline-flex items-center gap-1.5 text-sm"><t.icon className="h-4 w-4 text-muted-foreground" />{t.label}</span>
      },
    },
    { key: 'type', header: 'Type', sort: (n) => n.type, cell: (n) => typeBadge(n.type) },
    {
      key: 'recipients', header: 'Delivered', sort: (n) => n.recipients,
      cell: (n) => (
        <div className="text-xs">
          <p className="text-sm font-semibold">{(n.recipients ?? 0).toLocaleString()} <span className="font-normal text-muted-foreground">targeted</span></p>
          {n.push_sent != null || n.email_sent != null ? <p className="text-muted-foreground">{n.push_sent ?? 0} push · {n.email_sent ?? 0} email</p> : null}
        </div>
      ),
    },
    {
      key: 'perf', header: 'Performance', hideOnMobile: true,
      cell: (n) => {
        const s = summary[n.id]
        if (!s) return <span className="text-xs text-muted-foreground">-</span>
        const clicks = (s.push_stats?.converted ?? 0) + s.clicks
        return (
          <button type="button" onClick={() => openPerf(n)} className="cursor-pointer text-left text-xs hover:underline">
            <p className="text-sm font-semibold">{(s.push_stats?.received ?? s.push_stats?.successful ?? n.push_sent ?? 0).toLocaleString()} <span className="font-normal text-muted-foreground">delivered</span></p>
            <p className="text-muted-foreground">{s.opens.toLocaleString()} opens · {clicks.toLocaleString()} clicks</p>
          </button>
        )
      },
    },
    { key: 'sent', header: 'Sent At', sort: (n) => n.sent_at, cell: (n) => (n.sent_at ? format(new Date(n.sent_at), 'dd MMM yyyy, HH:mm') : 'N/A'), hideOnMobile: true },
    { key: 'status', header: 'Status', cell: (n) => <span title={n.delivery_error ?? undefined}><StatusBadge status={n.push_sent == null && n.email_sent == null && (n.status || 'sent') === 'sent' ? 'not delivered' : n.status || 'sent'} /></span> },
  ]

  const counts = {
    push: items.filter((n) => ['push', 'both'].includes(norm(n.type))).length,
    email: items.filter((n) => ['email', 'both'].includes(norm(n.type))).length,
    recipients: items.reduce((s, n) => s + (n.recipients ?? 0), 0),
    opens: Object.values(summary).reduce((s, x) => s + x.opens, 0),
    clicks: Object.values(summary).reduce((s, x) => s + x.clicks + (x.push_stats?.converted ?? 0), 0),
  }

  return (
    <AdminLayout onNewNotification={load} perm="notifications.view">
      <PageHeader eyebrow="System" title="Notifications" description="Send push and email to users and see how each one performs.">
        <Button variant="outline" onClick={markAll}><CheckCheck /> Mark alerts read</Button>
        {can('notifications.send') ? <Button onClick={() => openWith()}><Send /> Send Notification</Button> : null}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="black" label="Total Sent" value={items.length} icon={<Bell />} />
        <StatTile tone="violet" label="Push Notifications" value={counts.push} icon={<Smartphone />} />
        <StatTile tone="blue" label="Email Notifications" value={counts.email} icon={<Mail />} />
        <StatTile tone="green" label="Total Recipients" value={counts.recipients.toLocaleString()} icon={<Users />} hint={`${counts.opens.toLocaleString()} opens · ${counts.clicks.toLocaleString()} clicks on this page`} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button key={t.name} type="button" disabled={!can('notifications.send')} onClick={() => openWith(t)} className="group flex cursor-pointer items-start gap-3 rounded-3xl bg-background p-4 text-left shadow-soft ring-1 ring-black/[0.04] transition-all hover:-translate-y-0.5 hover:shadow-lift dark:ring-white/[0.06]">
            <span className={cn('rounded-2xl p-2.5 text-white shadow-md', t.tone)}><t.icon className="h-5 w-5" /></span>
            <span className="min-w-0">
              <span className="block font-bold">{t.name}</span>
              <span className="line-clamp-2 block text-xs text-muted-foreground">{t.message}</span>
            </span>
          </button>
        ))}
      </div>

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search messages" />
        <Select ariaLabel="Target" value={target} onValueChange={setTarget} options={[
          { value: 'all', label: 'All targets' }, { value: 'user', label: 'User' }, { value: 'event', label: 'Event' }, { value: 'organizers', label: 'Organizers' }, { value: 'venue_owners', label: 'Venue owners' },
        ]} />
        <Select ariaLabel="Date" value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)} options={[
          { value: 'all', label: 'Any date' }, { value: '7days', label: 'Last 7 days' }, { value: '30days', label: 'Last 30 days' }, { value: 'custom', label: 'Custom range' },
        ]} />
        {dateFilter === 'custom' ? (
          <div className="grid grid-cols-2 gap-3">
            <DatePicker label="Start date" value={customStart} onChange={setCustomStart} />
            <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
          </div>
        ) : null}
      </FilterBar>

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      <Card>
        <CardHeader icon={<Megaphone />} title={`Notification history (${filtered.length})`} />
        <CardContent>
          {loading ? <Loading /> : (
            <DataTable columns={columns} rows={pageRows} rowKey={(n) => n.id}
              actions={(n) => (
                <>
                  {can('notifications.send') && (['failed', 'partial'].includes((n.status || '').toLowerCase()) || (n.push_sent == null && n.email_sent == null && (n.status || '').toLowerCase() !== 'sending')) ? (
                    <Button variant="soft" size="sm" onClick={() => deliver(n, true)}><Send /> {['failed', 'partial'].includes((n.status || '').toLowerCase()) ? 'Retry' : 'Deliver'}</Button>
                  ) : null}
                  <Button variant="ghost" size="icon-sm" aria-label="View performance" onClick={() => openPerf(n)}><Activity /></Button>
                  {can('notifications.delete') ? <Button variant="ghost" size="icon-sm" aria-label="Delete notification" onClick={() => remove(n)}><Trash2 className="text-red-600" /></Button> : null}
                </>
              )}
              empty={<EmptyState icon={<Megaphone />} title="No notifications sent yet" action={<Button onClick={() => openWith()}><Send /> Send one</Button>} />} />
          )}
          <Pagination {...pagination} />
        </CardContent>
      </Card>

      <Modal
        open={open}
        onOpenChange={setOpen}
        size="lg"
        icon={<Send />}
        title="Send notification"
        description="Choose who gets it and how."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={send} disabled={!valid} loading={sending}>Send</Button></>}
      >
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-[13px] font-semibold text-gray-700 dark:text-gray-300">Delivery</p>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((t) => (
                <button key={t.value} type="button" onClick={() => setForm({ ...form, type: t.value })} aria-pressed={form.type === t.value}
                  className={cn('flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 p-3 text-sm font-bold transition-all', form.type === t.value ? 'border-primary bg-playarena-50 text-primary dark:bg-playarena-950' : 'border-transparent bg-muted hover:bg-gray-200 dark:hover:bg-gray-800')}>
                  <t.icon className="h-5 w-5" />{t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-gray-700 dark:text-gray-300">Audience</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TARGETS.map((t) => (
                <button key={t.value} type="button" onClick={() => setForm({ ...form, target: t.value })} aria-pressed={form.target === t.value}
                  className={cn('flex cursor-pointer items-center gap-2 rounded-2xl border-2 px-3 py-2.5 text-left text-sm font-semibold transition-all', form.target === t.value ? 'border-primary bg-playarena-50 text-primary dark:bg-playarena-950' : 'border-transparent bg-muted hover:bg-gray-200 dark:hover:bg-gray-800')}>
                  <t.icon className="h-4 w-4 shrink-0" />{t.label}
                </button>
              ))}
            </div>
          </div>
          {needsId ? (
            <Field label={form.target === 'user' ? 'User ID' : 'Event ID'} htmlFor="target-id" hint="Copy it from the Users or Events page" error={form.targetId && !UUID_RE.test(form.targetId.trim()) ? 'That does not look like a valid ID' : null}>
              <Input id="target-id" placeholder="00000000-0000-0000-0000-000000000000" value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })} className="font-mono" />
            </Field>
          ) : null}
          <Field label="Title" htmlFor="n-title"><Input id="n-title" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="SportCliq update" /></Field>
          <Field label="Message" htmlFor="n-message" hint={<span className={cn(form.message.length > 450 && 'font-bold text-amber-600')}>{form.message.length}/500 characters</span>}>
            <Textarea id="n-message" maxLength={500} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="When tapped, open" htmlFor="n-link">
              <Select ariaLabel="When tapped, open" icon={<Link2 />} value={form.link} onValueChange={(v) => setForm({ ...form, link: v })} options={LINKS} />
            </Field>
            {form.link === 'custom' ? (
              <Field label="Link" htmlFor="n-custom" error={!linkOk ? 'Start with / for an app page or https://' : null}>
                <Input id="n-custom" placeholder="/match/weekend-5-a-side" value={form.customLink} onChange={(e) => setForm({ ...form, customLink: e.target.value })} />
              </Field>
            ) : null}
            <Field label="Image (optional)" htmlFor="n-image" hint="Shown in the push on Android and the web" error={!imageOk ? 'Use an https:// image link' : null}>
              <Input id="n-image" placeholder="https://..." value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} />
            </Field>
          </div>
          {form.type !== 'email' ? (
            <div className="rounded-2xl bg-muted/70 p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Preview on a phone</p>
              <div className="flex items-start gap-3 rounded-2xl bg-background p-3 shadow-soft">
                <img src="/brand/sportcliq-mark.png" alt="" className="h-9 w-9 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between text-[11px] text-muted-foreground"><span className="font-semibold">SportCliq</span><span>now</span></p>
                  <p className="truncate text-sm font-bold">{form.title || 'SportCliq update'}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{form.message || 'Your message shows here.'}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
      <Modal
        open={!!perf}
        onOpenChange={(o) => { if (!o) setPerf(null) }}
        size="lg"
        icon={<Activity />}
        title="Notification performance"
        description={perf?.n.title}
        footer={<>
          {perf?.data?.onesignal_id ? <Button variant="outline" onClick={() => perf && refreshPerf(perf.n)} loading={perf?.refreshing}><RefreshCw /> Refresh</Button> : null}
          <Button onClick={() => setPerf(null)}>Done</Button>
        </>}
      >
        {!perf || perf.loading || !perf.data ? <Loading rows={4} /> : (() => {
          const d = perf.data
          const ps = d.push_stats || {}
          const delivered = ps.received ?? ps.successful ?? d.push_sent
          const pushClicks = ps.converted ?? 0
          const failed = (ps.errored ?? 0) + (ps.failed ?? 0)
          const tiles = [
            { label: 'Targeted', value: d.recipients, icon: <Users />, tone: 'black' as const },
            { label: 'Push sent', value: ps.successful ?? d.push_sent, icon: <Send />, tone: 'violet' as const },
            { label: 'Delivered', value: delivered, icon: <Smartphone />, tone: 'blue' as const, hint: `${pct(delivered, ps.successful ?? d.push_sent)} of sent` },
            { label: 'Push clicks', value: pushClicks, icon: <MousePointerClick />, tone: 'green' as const, hint: `${pct(pushClicks, delivered)} click rate` },
            { label: 'In app views', value: d.inapp_views, icon: <Eye />, tone: 'teal' as const },
            { label: 'In app opens', value: d.inapp_opens, icon: <Bell />, tone: 'amber' as const, hint: `${pct(d.inapp_opens, d.recipients)} of targeted` },
            { label: 'In app clicks', value: d.inapp_clicks, icon: <MousePointerClick />, tone: 'green' as const },
            { label: 'Failed', value: failed, icon: <XCircle />, tone: 'rose' as const },
          ]
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {tiles.map((t) => <StatTile key={t.label} tone={t.tone} label={t.label} value={(t.value ?? 0).toLocaleString()} icon={t.icon} hint={t.hint} />)}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Email sent {d.email_sent.toLocaleString()}</Badge>
                <StatusBadge status={d.status || 'sent'} />
                {d.delivered_at ? <Badge variant="outline">Delivered {format(new Date(d.delivered_at), 'dd MMM, HH:mm')}</Badge> : null}
                {d.stats_synced_at ? <Badge variant="outline">OneSignal synced {format(new Date(d.stats_synced_at), 'dd MMM, HH:mm')}</Badge> : d.onesignal_id ? null : <Badge variant="warning">No OneSignal record yet</Badge>}
              </div>
              {d.delivery_error ? <Alert>{d.delivery_error}</Alert> : null}
              {d.timeline.length ? (
                <Card className="p-4">
                  <p className="mb-2 text-sm font-bold">Opens and clicks in the app, by hour</p>
                  <ChartCanvas label="Opens and clicks by hour" className="h-48" config={(dark) => {
                    const c = chartColors(dark)
                    return {
                      type: 'bar',
                      data: { labels: d.timeline.map((t) => format(new Date(t.hour), 'dd MMM HH:mm')), datasets: [
                        { label: 'Opens', data: d.timeline.map((t) => t.opens), backgroundColor: '#f59e0b', borderRadius: 6, maxBarThickness: 22 },
                        { label: 'Clicks', data: d.timeline.map((t) => t.clicks), backgroundColor: '#05964f', borderRadius: 6, maxBarThickness: 22 },
                      ] },
                      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: c.tick, usePointStyle: true, boxWidth: 8 } } }, scales: { x: { ticks: { color: c.tick, maxTicksLimit: 6 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: c.tick, precision: 0 }, grid: { color: c.grid }, border: { display: false } } } },
                    }
                  }} />
                </Card>
              ) : null}
              <p className="text-xs text-muted-foreground">Push numbers come from OneSignal. In app views, opens and clicks come from the SportCliq app notification list.</p>
            </div>
          )
        })()}
      </Modal>
    </AdminLayout>
  )
}
