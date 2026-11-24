import { useCallback, useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { Activity, Building2, Calendar, ClipboardList, DollarSign, Download, Info, LogIn, LogOut, Send, Settings, Shield, ShieldCheck, User, Users } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Alert, useToast } from '@/components/ui/feedback'
import { EmptyState, FilterBar, Loading, PageHeader, Pagination, StatTile, usePaged } from '@/components/ui/page'
import { useAdminSession } from '@/hooks/useAdminSession'
import { adminOperations, type AuditLogRow } from '@/lib/adminOperations'
import { cn, downloadBlob, errorMessage, formatDateTime } from '@/lib/utils'

const ACTION_STYLE: Record<string, { color: string; icon: typeof Shield }> = {
  login: { color: 'bg-green-500', icon: LogIn },
  logout: { color: 'bg-gray-500', icon: LogOut },
  user_management: { color: 'bg-blue-500', icon: User },
  settings: { color: 'bg-purple-500', icon: Settings },
  cashout: { color: 'bg-amber-500', icon: DollarSign },
  event_management: { color: 'bg-orange-500', icon: Calendar },
  venue_management: { color: 'bg-teal-500', icon: Building2 },
  notification: { color: 'bg-pink-500', icon: Send },
  admin_management: { color: 'bg-red-500', icon: ShieldCheck },
}
const BASE_ACTIONS = ['login', 'logout', 'user_management', 'settings', 'cashout', 'event_management']
const label = (a: string) => a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function ActionBadge({ action }: { action: string }) {
  const s = ACTION_STYLE[action] ?? { color: 'bg-gray-400', icon: Shield }
  return <Badge className={cn('text-white ring-0', s.color)}><s.icon /> {label(action)}</Badge>
}

export default function AuditLog() {
  const session = useAdminSession()
  const toast = useToast()
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [knownActions, setKnownActions] = useState<string[]>(BASE_ACTIONS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('all')
  const [admin, setAdmin] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = (await adminOperations.getAuditLogs(action)) || []
      setLogs(rows)
      if (action === 'all') setKnownActions(Array.from(new Set([...BASE_ACTIONS, ...rows.map((r) => r.action)])))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [action])

  useEffect(() => {
    load()
  }, [load])

  const admins = useMemo(() => {
    const m = new Map<string, string>()
    logs.forEach((l) => l.admin_id && m.set(l.admin_id, l.admin_email))
    return Array.from(m, ([id, email]) => ({ id, email }))
  }, [logs])

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter((l) => (admin === 'all' || l.admin_id === admin) && (!q || [l.admin_email, l.action, l.details].some((x) => (x || '').toLowerCase().includes(q))))
  }, [logs, search, admin])
  const { pageRows, pagination } = usePaged(filteredLogs, 20)

  const [todayStart] = useState(() => new Date(new Date().toDateString()).getTime())

  const handleExportCSV = () => {
    console.log('Exporting audit logs', filteredLogs.length)
    const csv = Papa.unparse(filteredLogs.map((l) => ({ Time: formatDateTime(l.created_at), Admin: l.admin_email, Action: l.action, Details: l.details ?? '', 'IP Address': l.ip_address ?? '' })))
    downloadBlob('﻿' + csv, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
    adminOperations.log('settings', `Exported ${filteredLogs.length} audit log entries`).catch(() => undefined)
    toast.success('Audit log exported', `${filteredLogs.length} entries`)
  }

  const columns: Column<AuditLogRow>[] = [
    {
      key: 'admin', header: 'Admin', sort: (l) => l.admin_email,
      cell: (l) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={l.admin_email} className="h-9 w-9" />
          <div className="min-w-0"><p className="truncate text-sm font-bold">{l.admin_email}</p><p className="text-xs text-muted-foreground md:hidden">{formatDateTime(l.created_at)}</p></div>
        </div>
      ),
    },
    { key: 'action', header: 'Action', sort: (l) => l.action, cell: (l) => <ActionBadge action={l.action} /> },
    { key: 'details', header: 'Details', cell: (l) => <span className="line-clamp-2 text-sm text-muted-foreground">{l.details || 'N/A'}</span> },
    { key: 'time', header: 'Time', sort: (l) => l.created_at, cell: (l) => <span className="whitespace-nowrap text-sm">{formatDateTime(l.created_at)}</span>, hideOnMobile: true },
    { key: 'ip', header: 'IP Address', cell: (l) => <span className="font-mono text-xs">{l.ip_address || 'N/A'}</span>, hideOnMobile: true },
  ]

  return (
    <AdminLayout>
      <PageHeader eyebrow="System" title="Audit Log" description="Every admin action, newest first.">
        {session?.role === 'super_admin' ? (
          <Button variant="outline" onClick={handleExportCSV} disabled={loading || filteredLogs.length === 0}><Download /> Export CSV</Button>
        ) : null}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tone="black" label="Total Actions" value={logs.length.toLocaleString()} icon={<ClipboardList />} />
        <StatTile tone="blue" label="Today's Actions" value={logs.filter((l) => new Date(l.created_at).getTime() >= todayStart).length} icon={<Activity />} />
        <StatTile tone="green" label="Active Admins" value={admins.length} icon={<Users />} />
        <StatTile tone="violet" label="Action Types" value={new Set(logs.map((l) => l.action)).size} icon={<Shield />} />
      </div>

      <FilterBar className="xl:grid-cols-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Admin, action or details" />
        <Select ariaLabel="Action" value={action} onValueChange={setAction} options={[{ value: 'all', label: 'All actions' }, ...knownActions.map((a) => ({ value: a, label: label(a) }))]} />
        <Select ariaLabel="Admin" value={admin} onValueChange={setAdmin} options={[{ value: 'all', label: 'All admins' }, ...admins.map((a) => ({ value: a.id, label: a.email }))]} />
      </FilterBar>

      {error ? <Alert className="mb-4">Error: {error}</Alert> : null}

      <Card className="mb-4">
        <CardHeader icon={<ClipboardList />} title={`Audit Logs (${filteredLogs.length})`} />
        <CardContent>
          {loading ? <Loading rows={8} /> : <DataTable columns={columns} rows={pageRows} rowKey={(l) => l.id} empty={<EmptyState icon={<ClipboardList />} title="No log entries match" />} />}
          <Pagination {...pagination} sizes={[20, 50, 100]} />
        </CardContent>
      </Card>

      <Alert variant="info" icon={<Info />}>Audit logs should be kept for 12 months. Super admins can export them as CSV for archiving.</Alert>
    </AdminLayout>
  )
}
