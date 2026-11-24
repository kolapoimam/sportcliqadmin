import { useCallback, useEffect, useState } from 'react'
import Papa from 'papaparse'
import {
  Activity, Building2, Calendar, ClipboardList, Database, DollarSign, Download, Eye, Fingerprint, Globe, Info, LogIn, LogOut, Monitor,
  Send, Settings, Shield, ShieldAlert, ShieldCheck, Smartphone, User, Users,
} from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { DatePicker, SearchInput, Switch } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Modal } from '@/components/ui/dialog'
import { Alert, useToast } from '@/components/ui/feedback'
import { Detail, EmptyState, FilterBar, Loading, PageHeader, Pagination, StatTile } from '@/components/ui/page'
import { useCan } from '@/hooks/useAdminSession'
import { adminOperations, type AuditLogRow, type AuditPage } from '@/lib/adminOperations'
import { cn, dateBounds, downloadBlob, errorMessage, formatDateTime, type DateFilter } from '@/lib/utils'

const ACTION_STYLE: Record<string, { color: string; icon: typeof Shield }> = {
  login: { color: 'bg-green-500', icon: LogIn },
  login_password: { color: 'bg-green-500', icon: LogIn },
  login_google: { color: 'bg-green-500', icon: LogIn },
  logout: { color: 'bg-gray-500', icon: LogOut },
  mfa_verified: { color: 'bg-emerald-600', icon: ShieldCheck },
  mfa_enrolled: { color: 'bg-emerald-600', icon: Smartphone },
  mfa_failed: { color: 'bg-red-600', icon: ShieldAlert },
  user_management: { color: 'bg-blue-500', icon: User },
  settings: { color: 'bg-purple-500', icon: Settings },
  cashout: { color: 'bg-amber-500', icon: DollarSign },
  event_management: { color: 'bg-orange-500', icon: Calendar },
  venue_management: { color: 'bg-teal-500', icon: Building2 },
  notification: { color: 'bg-pink-500', icon: Send },
  admin_management: { color: 'bg-red-500', icon: ShieldCheck },
  data_change: { color: 'bg-slate-600', icon: Database },
  page_view: { color: 'bg-gray-400', icon: Eye },
}
const label = (a: string) => a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function ActionBadge({ action }: { action: string }) {
  const s = ACTION_STYLE[action] ?? { color: 'bg-gray-400', icon: Shield }
  return <Badge className={cn('text-white ring-0', s.color)}><s.icon /> {label(action)}</Badge>
}

/** Rough but readable device name from a user agent. */
function device(ua?: string | null) {
  if (!ua) return null
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return `${browser}${os ? ` on ${os}` : ''}`
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export default function AuditLog() {
  const can = useCan()
  const toast = useToast()
  const [data, setData] = useState<AuditPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [action, setAction] = useState('all')
  const [admin, setAdmin] = useState('all')
  const [entity, setEntity] = useState('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [views, setViews] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState<AuditLogRow | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => setPage(1), [debounced, action, admin, entity, dateFilter, customStart, customEnd, views, pageSize])

  const filters = useCallback(() => {
    const { start, end } = dateBounds(dateFilter, customStart, customEnd)
    return { action, admin, entity, start, end, search: debounced, includeViews: views }
  }, [action, admin, entity, dateFilter, customStart, customEnd, debounced, views])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await adminOperations.getAuditLogs({ ...filters(), limit: pageSize, offset: (page - 1) * pageSize }))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [filters, page, pageSize])

  useEffect(() => {
    load()
  }, [load])

  const handleExportCSV = async () => {
    setExporting(true)
    try {
      const all = await adminOperations.getAuditLogs({ ...filters(), limit: 10000, offset: 0 })
      const csv = Papa.unparse(all.rows.map((l) => ({
        Time: formatDateTime(l.created_at), Admin: l.admin_email, Action: l.action, Details: l.details ?? '', Entity: l.entity_type ?? '', 'Entity ID': l.entity_id ?? '',
        'IP Address': l.ip_address ?? '', Device: device(l.user_agent) ?? '', 'Sign in method': l.auth_method ?? '', '2FA level': l.aal ?? '', Changes: l.metadata ? JSON.stringify(l.metadata) : '',
      })))
      downloadBlob('﻿' + csv, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
      adminOperations.logEvent('export', `Exported ${all.rows.length} audit log entries`, 'audit_logs').catch(() => undefined)
      toast.success('Audit log exported', `${all.rows.length} entries`)
    } catch (e) {
      toast.error('Export failed', errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const rows = data?.rows ?? []
  const columns: Column<AuditLogRow>[] = [
    {
      key: 'admin', header: 'Who',
      cell: (l) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={l.admin_name || l.admin_email} className="h-9 w-9" />
          <div className="min-w-0"><p className="truncate text-sm font-bold">{l.admin_name || l.admin_email}</p><p className="truncate text-xs text-muted-foreground">{formatDateTime(l.created_at)}</p></div>
        </div>
      ),
    },
    { key: 'action', header: 'What', cell: (l) => <ActionBadge action={l.action} /> },
    { key: 'details', header: 'Details', cell: (l) => <span className="line-clamp-2 text-sm text-muted-foreground">{l.details || 'N/A'}{l.metadata?.changes ? <span className="ml-1 font-semibold text-foreground">({Object.keys(l.metadata.changes).length} field{Object.keys(l.metadata.changes).length === 1 ? '' : 's'})</span> : null}</span> },
    { key: 'how', header: 'How', hideOnMobile: true, cell: (l) => <div className="text-xs"><p className="font-semibold">{device(l.user_agent) ?? 'Unknown device'}</p><p className="font-mono text-muted-foreground">{l.ip_address || 'IP unknown'}</p></div> },
    { key: 'auth', header: 'Auth', hideOnMobile: true, wideOnly: true, cell: (l) => (l.aal === 'aal2' ? <Badge variant="success"><ShieldCheck /> 2FA</Badge> : <Badge variant="warning">{l.aal ?? 'n/a'}</Badge>) },
  ]

  return (
    <AdminLayout perm="audit.view">
      <PageHeader eyebrow="System" title="Audit Log" description="Who did what, when, from where, and exactly what changed.">
        {can('audit.export') ? <Button variant="outline" onClick={handleExportCSV} loading={exporting} disabled={loading || !rows.length}><Download /> Export CSV</Button> : null}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="black" label="Matching entries" value={(data?.total ?? 0).toLocaleString()} icon={<ClipboardList />} />
        <StatTile tone="blue" label="Action types" value={data?.actions.length ?? 0} icon={<Activity />} />
        <StatTile tone="green" label="Admins" value={data?.admins.length ?? 0} icon={<Users />} />
        <StatTile tone="violet" label="Areas tracked" value={data?.entities.length ?? 0} icon={<Database />} />
      </div>

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search admin, details, ID or IP" />
        <Select ariaLabel="Action" value={action} onValueChange={setAction} options={[{ value: 'all', label: 'All actions' }, ...(data?.actions ?? []).map((a) => ({ value: a, label: label(a) }))]} />
        <Select ariaLabel="Admin" value={admin} onValueChange={setAdmin} options={[{ value: 'all', label: 'All admins' }, ...(data?.admins ?? []).map((a) => ({ value: a.id, label: a.email }))]} />
        <Select ariaLabel="Area" value={entity} onValueChange={setEntity} options={[{ value: 'all', label: 'All areas' }, ...(data?.entities ?? []).map((e) => ({ value: e, label: label(e) }))]} />
        <Select ariaLabel="Date" value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)} options={[
          { value: 'all', label: 'Any time' }, { value: 'today', label: 'Today' }, { value: '7days', label: 'Last 7 days' }, { value: '30days', label: 'Last 30 days' }, { value: 'custom', label: 'Custom range' },
        ]} />
        {dateFilter === 'custom' ? (
          <div className="grid grid-cols-2 gap-3">
            <DatePicker label="Start date" value={customStart} onChange={setCustomStart} />
            <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
          </div>
        ) : null}
        <label className="flex h-11 cursor-pointer items-center justify-between gap-3 rounded-xl bg-muted/60 px-3.5 text-sm font-semibold">
          Show page views <Switch label="Show page views" checked={views} onCheckedChange={setViews} />
        </label>
      </FilterBar>

      {error ? <Alert className="mb-4">Error: {error}</Alert> : null}

      <Card className="mb-4">
        <CardHeader icon={<ClipboardList />} title={`Audit Logs (${(data?.total ?? 0).toLocaleString()})`} description="Tap an entry to see the full record." />
        <CardContent>
          {loading && !data ? <Loading rows={8} /> : <DataTable columns={columns} rows={rows} rowKey={(l) => l.id} onRowClick={setSelected} empty={<EmptyState icon={<ClipboardList />} title="No log entries match" />} />}
          <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1) }} />
        </CardContent>
      </Card>

      <Alert variant="info" icon={<Info />}>Every admin action, sign in, failed two factor code and data change is recorded with IP and device. Logs should be kept for 12 months. Admins with audit export can download them for archiving.</Alert>

      <Modal open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)} size="lg" icon={<Fingerprint />} title={selected ? label(selected.action) : ''} description={selected ? formatDateTime(selected.created_at) : ''}>
        {selected ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Detail label="Who">{selected.admin_name ? `${selected.admin_name} (${selected.admin_email})` : selected.admin_email}</Detail>
              <Detail label="When">{new Date(selected.created_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })}</Detail>
              <Detail label="IP address"><span className="inline-flex items-center gap-1.5 font-mono"><Globe className="h-3.5 w-3.5" />{selected.ip_address || 'Unknown'}</span></Detail>
              <Detail label="Device"><span className="inline-flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" />{device(selected.user_agent) ?? 'Unknown'}</span></Detail>
              <Detail label="Sign in method">{selected.auth_method ? selected.auth_method.replace('totp', 'authenticator').replace('oauth', 'Google').replace('+', ' + ') : 'N/A'}</Detail>
              <Detail label="Two factor">{selected.aal === 'aal2' ? 'Verified' : 'Not verified'}</Detail>
              {selected.entity_type ? <Detail label="Area">{label(selected.entity_type)}</Detail> : null}
              {selected.entity_id ? <Detail label="Record ID"><span className="font-mono text-xs">{selected.entity_id}</span></Detail> : null}
            </div>
            {selected.details ? <Detail label="Details">{selected.details}</Detail> : null}
            {selected.metadata?.changes && Object.keys(selected.metadata.changes).length ? (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">What changed ({selected.metadata.operation})</p>
                <div className="overflow-hidden rounded-2xl ring-1 ring-border">
                  {Object.entries(selected.metadata.changes).map(([field, c]) => (
                    <div key={field} className="grid grid-cols-1 gap-1 border-t p-3 text-sm first:border-0 sm:grid-cols-[160px_1fr_1fr] sm:gap-3">
                      <span className="font-bold">{label(field)}</span>
                      <span className="break-all rounded-lg bg-red-50 px-2 py-1 font-mono text-xs text-red-700 line-through decoration-red-300 dark:bg-red-950/40 dark:text-red-300">{show(c.from)}</span>
                      <span className="break-all rounded-lg bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{show(c.to)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : selected.metadata && Object.keys(selected.metadata).length ? (
              <Detail label="Extra details"><pre className="whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(selected.metadata, null, 2)}</pre></Detail>
            ) : null}
            {selected.user_agent ? <p className="break-all text-[11px] text-muted-foreground">{selected.user_agent}</p> : null}
          </div>
        ) : null}
      </Modal>
    </AdminLayout>
  )
}
