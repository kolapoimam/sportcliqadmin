import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Bell, Building2, Calendar, Mail, Megaphone, Send, Smartphone, User, Users, Wrench, Sparkles } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DatePicker, Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorText, Field, Loading, PageHeader, StatCard } from '@/components/ui/page'
import { adminOperations, type AdminNotification } from '@/lib/adminOperations'
import { dateBounds, errorMessage, shortId, type DateFilter } from '@/lib/utils'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z]/g, '')

const TARGETS = [
  { value: 'all', label: 'All users', icon: Users },
  { value: 'user', label: 'Specific user', icon: User },
  { value: 'event', label: 'Event participants', icon: Calendar },
  { value: 'organizers', label: 'Organizers', icon: Megaphone },
  { value: 'venue_owners', label: 'Venue owners', icon: Building2 },
]

const TEMPLATES = [
  { name: 'Maintenance Notice', icon: Wrench, target: 'all', type: 'both', title: 'Scheduled maintenance', message: 'Sport Cliq will be briefly unavailable for scheduled maintenance. Thank you for your patience.' },
  { name: 'Event Update', icon: Calendar, target: 'event', type: 'push', title: 'Event update', message: 'There is an update to your event. Please check the event page for the latest details.' },
  { name: 'Welcome Message', icon: Sparkles, target: 'user', type: 'email', title: 'Welcome to Sport Cliq', message: 'Welcome to Sport Cliq! Find games near you, join a squad and start playing.' },
]

function typeBadge(t: string) {
  const n = norm(t)
  if (n === 'email') return <Badge variant="info"><Mail /> Email</Badge>
  if (n === 'both') return <Badge variant="success"><Send /> Both</Badge>
  return <Badge variant="secondary"><Smartphone /> Push</Badge>
}

export default function AdminNotifications() {
  const [items, setItems] = useState<AdminNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [target, setTarget] = useState('all')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ type: 'push', target: 'all', targetId: '', title: '', message: '' })
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = dateBounds(dateFilter, customStart, customEnd)
      setItems(await adminOperations.getNotifications({ excludeAlerts: true, start, end, limit: 500 }))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [dateFilter, customStart, customEnd])

  useEffect(() => {
    load()
  }, [load])

  const filtered = items.filter((n) => target === 'all' || norm(n.target_type) === norm(target) || (target === 'user' && norm(n.target_type) === 'user'))

  const needsId = form.target === 'user' || form.target === 'event'
  const valid = form.message.trim().length > 0 && form.message.length <= 500 && (!needsId || UUID_RE.test(form.targetId.trim()))

  const openWith = (t?: (typeof TEMPLATES)[number]) => {
    setForm(t ? { type: t.type, target: t.target, targetId: '', title: t.title, message: t.message } : { type: 'push', target: 'all', targetId: '', title: '', message: '' })
    setSendError(null)
    setOpen(true)
  }

  const send = async () => {
    setSending(true)
    setSendError(null)
    try {
      const n = await adminOperations.sendNotification({
        type: form.type, target: form.target, targetId: needsId ? form.targetId.trim() : null, title: form.title.trim(), message: form.message.trim(),
      })
      setItems((list) => [n, ...list])
      setOpen(false)
    } catch (e) {
      setSendError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  const columns: Column<AdminNotification>[] = [
    { key: 'id', header: 'ID', cell: (n) => <span className="font-mono text-xs">{shortId(n.id)}</span>, hideOnMobile: true },
    {
      key: 'target',
      header: 'Target',
      cell: (n) => {
        const t = TARGETS.find((x) => norm(x.value) === norm(n.target_type)) ?? TARGETS[0]
        return <span className="inline-flex items-center gap-1.5"><t.icon className="h-4 w-4 text-muted-foreground" /> {t.label}</span>
      },
    },
    { key: 'message', header: 'Message', cell: (n) => <span className="line-clamp-2 max-w-xs" title={n.message}>{n.message}</span> },
    { key: 'type', header: 'Type', cell: (n) => typeBadge(n.type) },
    { key: 'recipients', header: 'Recipients', cell: (n) => (n.recipients ?? 0).toLocaleString() },
    { key: 'sent', header: 'Sent At', cell: (n) => (n.sent_at ? format(new Date(n.sent_at), 'dd MMM yyyy, HH:mm') : 'N/A') },
    { key: 'status', header: 'Status', cell: (n) => <Badge variant={norm(n.status) === 'failed' ? 'danger' : 'success'} className="capitalize">{n.status || 'sent'}</Badge> },
  ]

  return (
    <AdminLayout onNewNotification={load}>
      <PageHeader title="Notifications" description="Send updates to users and see what has gone out.">
        <Button onClick={() => openWith()}><Send /> Send Notification</Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Sent" value={items.length} icon={<Bell />} />
        <StatCard label="Push" value={items.filter((n) => ['push', 'both'].includes(norm(n.type))).length} icon={<Smartphone />} />
        <StatCard label="Email" value={items.filter((n) => ['email', 'both'].includes(norm(n.type))).length} icon={<Mail />} />
        <StatCard label="Total Recipients" value={items.reduce((s, n) => s + (n.recipients ?? 0), 0).toLocaleString()} icon={<Users />} />
      </div>

      <Card className="mb-4">
        <CardHeader><CardTitle>Quick templates</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <Button key={t.name} variant="outline" onClick={() => openWith(t)}><t.icon /> {t.name}</Button>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 pt-5 md:grid-cols-3">
          <Select ariaLabel="Date" value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)} options={[
            { value: 'all', label: 'All dates' }, { value: '7days', label: 'Last 7 days' }, { value: '30days', label: 'Last 30 days' }, { value: 'custom', label: 'Custom range' },
          ]} />
          <Select ariaLabel="Target" value={target} onValueChange={setTarget} options={[
            { value: 'all', label: 'All targets' }, { value: 'user', label: 'User' }, { value: 'event', label: 'Event' },
            { value: 'organizers', label: 'Organizers' }, { value: 'venue_owners', label: 'Venue owners' },
          ]} />
          {dateFilter === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <DatePicker label="Start date" value={customStart} onChange={setCustomStart} />
              <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ErrorText error={error} />

      <Card>
        <CardHeader><CardTitle>Notification history ({filtered.length})</CardTitle></CardHeader>
        <CardContent>{loading ? <Loading /> : <DataTable columns={columns} rows={filtered} rowKey={(n) => n.id} empty="No notifications sent yet" />}</CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send notification</DialogTitle>
            <DialogDescription>Choose who gets it and how.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Type">
                <Select ariaLabel="Notification type" value={form.type} onValueChange={(v) => setForm({ ...form, type: v })} options={[
                  { value: 'push', label: 'Push' }, { value: 'email', label: 'Email' }, { value: 'both', label: 'Both' },
                ]} />
              </Field>
              <Field label="Audience">
                <Select ariaLabel="Audience" value={form.target} onValueChange={(v) => setForm({ ...form, target: v })} options={TARGETS.map(({ value, label }) => ({ value, label }))} />
              </Field>
            </div>
            {needsId ? (
              <Field label={form.target === 'user' ? 'User ID' : 'Event ID'} htmlFor="target-id">
                <Input id="target-id" placeholder="00000000-0000-0000-0000-000000000000" value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })} />
              </Field>
            ) : null}
            <Field label="Title" htmlFor="n-title">
              <Input id="n-title" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label={`Message (${form.message.length}/500)`} htmlFor="n-message">
              <Textarea id="n-message" maxLength={500} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </Field>
            {sendError ? <Alert>{sendError}</Alert> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={send} disabled={!valid || sending}>{sending ? 'Sending...' : 'Send'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  )
}
