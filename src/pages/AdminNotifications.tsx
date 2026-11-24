import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Bell, Building2, Calendar, CheckCheck, Mail, Megaphone, Send, Smartphone, Sparkles, Trash2, User, Users, Wrench } from 'lucide-react'
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
import { adminOperations, type AdminNotification } from '@/lib/adminOperations'
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
const TEMPLATES = [
  { name: 'Maintenance Notice', icon: Wrench, tone: 'bg-amber-500', target: 'all', type: 'both', title: 'Scheduled maintenance', message: 'Sport Cliq will be briefly unavailable for scheduled maintenance. Thank you for your patience.' },
  { name: 'Event Update', icon: Calendar, tone: 'bg-sky-500', target: 'event', type: 'push', title: 'Event update', message: 'There is an update to your event. Please check the event page for the latest details.' },
  { name: 'Welcome Message', icon: Sparkles, tone: 'bg-emerald-500', target: 'user', type: 'email', title: 'Welcome to Sport Cliq', message: 'Welcome to Sport Cliq! Find games near you, join a squad and start playing.' },
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
  const [form, setForm] = useState({ type: 'push', target: 'all', targetId: '', title: '', message: '' })
  const [sending, setSending] = useState(false)

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

  const needsId = form.target === 'user' || form.target === 'event'
  const valid = form.message.trim().length > 0 && form.message.length <= 500 && (!needsId || UUID_RE.test(form.targetId.trim()))

  const openWith = (t?: (typeof TEMPLATES)[number]) => {
    setForm(t ? { type: t.type, target: t.target, targetId: '', title: t.title, message: t.message } : { type: 'push', target: 'all', targetId: '', title: '', message: '' })
    setOpen(true)
  }

  const send = async () => {
    const audience = TARGETS.find((t) => t.value === form.target)?.label.toLowerCase()
    const { ok } = await confirm({ title: 'Send this notification?', description: `It goes to ${audience} by ${form.type === 'both' ? 'push and email' : form.type}. This cannot be unsent.`, confirmText: 'Send now', icon: <Send /> })
    if (!ok) return
    setSending(true)
    try {
      const n = await adminOperations.sendNotification({ type: form.type, target: form.target, targetId: needsId ? form.targetId.trim() : null, title: form.title.trim(), message: form.message.trim() })
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
  const deliver = async (n: AdminNotification) => {
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
    { key: 'sent', header: 'Sent At', sort: (n) => n.sent_at, cell: (n) => (n.sent_at ? format(new Date(n.sent_at), 'dd MMM yyyy, HH:mm') : 'N/A'), hideOnMobile: true },
    { key: 'status', header: 'Status', cell: (n) => <span title={n.delivery_error ?? undefined}><StatusBadge status={n.push_sent == null && n.email_sent == null && (n.status || 'sent') === 'sent' ? 'not delivered' : n.status || 'sent'} /></span> },
  ]

  const counts = {
    push: items.filter((n) => ['push', 'both'].includes(norm(n.type))).length,
    email: items.filter((n) => ['email', 'both'].includes(norm(n.type))).length,
    recipients: items.reduce((s, n) => s + (n.recipients ?? 0), 0),
  }

  return (
    <AdminLayout onNewNotification={load} perm="notifications.view">
      <PageHeader eyebrow="System" title="Notifications" description="Send updates to users and see what has gone out.">
        <Button variant="outline" onClick={markAll}><CheckCheck /> Mark alerts read</Button>
        {can('notifications.send') ? <Button onClick={() => openWith()}><Send /> Send Notification</Button> : null}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="black" label="Total Sent" value={items.length} icon={<Bell />} />
        <StatTile tone="violet" label="Push Notifications" value={counts.push} icon={<Smartphone />} />
        <StatTile tone="blue" label="Email Notifications" value={counts.email} icon={<Mail />} />
        <StatTile tone="green" label="Total Recipients" value={counts.recipients.toLocaleString()} icon={<Users />} />
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
                    <Button variant="soft" size="sm" onClick={() => deliver(n)}><Send /> {['failed', 'partial'].includes((n.status || '').toLowerCase()) ? 'Retry' : 'Deliver'}</Button>
                  ) : null}
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
        </div>
      </Modal>
    </AdminLayout>
  )
}
