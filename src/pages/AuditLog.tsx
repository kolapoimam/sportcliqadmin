import { useCallback, useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { Building2, Calendar, DollarSign, Download, Info, LogIn, LogOut, Search, Send, Settings, Shield, ShieldCheck, User } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { ErrorText, Loading, PageHeader, StatCard } from '@/components/ui/page'
import { useAdminSession } from '@/hooks/useAdminSession'
import { adminOperations, type AuditLogRow } from '@/lib/adminOperations'
import { cn, downloadBlob, errorMessage, formatDateTime } from '@/lib/utils'

const ACTION_STYLE: Record<string, { color: string; icon: typeof Shield }> = {
  login: { color: 'bg-green-500', icon: LogIn },
  logout: { color: 'bg-gray-500', icon: LogOut },
  user_management: { color: 'bg-blue-500', icon: User },
  settings: { color: 'bg-purple-500', icon: Settings },
  cashout: { color: 'bg-yellow-500', icon: DollarSign },
  event_management: { color: 'bg-orange-500', icon: Calendar },
  venue_management: { color: 'bg-teal-500', icon: Building2 },
  notification: { color: 'bg-pink-500', icon: Send },
  admin_management: { color: 'bg-red-500', icon: ShieldCheck },
}
const BASE_ACTIONS = ['login', 'logout', 'user_management', 'settings', 'cashout', 'event_management']
const label = (a: string) => a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function ActionBadge({ action }: { action: string }) {
  const s = ACTION_STYLE[action] ?? { color: 'bg-gray-400', icon: Shield }
  return <Badge className={cn('text-white', s.color)}><s.icon /> {label(action)}</Badge>
}

export default function AuditLog() {
  const session = useAdminSession()
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
    return logs.filter(
      (l) =>
        (admin === 'all' || l.admin_id === admin) &&
        (!q || [l.admin_email, l.action, l.details].some((x) => (x || '').toLowerCase().includes(q))),
    )
  }, [logs, search, admin])

  const todayStart = new Date(new Date().toDateString()).getTime()

  const handleExportCSV = () => {
    console.log('Exporting audit logs', filteredLogs.length)
    const csv = Papa.unparse(
      filteredLogs.map((l) => ({ Time: formatDateTime(l.created_at), Admin: l.admin_email, Action: l.action, Details: l.details ?? '', 'IP Address': l.ip_address ?? '' })),
    )
    downloadBlob('﻿' + csv, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
    adminOperations.log('settings', `Exported ${filteredLogs.length} audit log entries`).catch(() => undefined)
  }

  const columns: Column<AuditLogRow>[] = [
    { key: 'time', header: 'Time', cell: (l) => formatDateTime(l.created_at) },
    { key: 'admin', header: 'Admin', cell: (l) => l.admin_email },
    { key: 'action', header: 'Action', cell: (l) => <ActionBadge action={l.action} /> },
    { key: 'details', header: 'Details', cell: (l) => <span className="text-muted-foreground">{l.details || 'N/A'}</span> },
    { key: 'ip', header: 'IP Address', cell: (l) => l.ip_address || 'N/A', hideOnMobile: true },
  ]

  return (
    <AdminLayout>
      <PageHeader title="Audit Log" description="Every admin action, newest first.">
        {session?.role === 'super_admin' ? (
          <Button variant="outline" onClick={handleExportCSV} disabled={loading || filteredLogs.length === 0}>
            <Download /> Export CSV
          </Button>
        ) : null}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Actions" value={logs.length.toLocaleString()} />
        <StatCard label="Today's Actions" value={logs.filter((l) => new Date(l.created_at).getTime() >= todayStart).length} valueClassName="text-blue-600" />
        <StatCard label="Active Admins" value={admins.length} valueClassName="text-green-600" />
        <StatCard label="Action Types" value={new Set(logs.map((l) => l.action)).size} valueClassName="text-purple-600" />
      </div>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 pt-5 md:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search logs" placeholder="Admin, action or details" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select ariaLabel="Action" value={action} onValueChange={setAction} options={[{ value: 'all', label: 'All actions' }, ...knownActions.map((a) => ({ value: a, label: label(a) }))]} />
          <Select ariaLabel="Admin" value={admin} onValueChange={setAdmin} options={[{ value: 'all', label: 'All admins' }, ...admins.map((a) => ({ value: a.id, label: a.email }))]} />
        </CardContent>
      </Card>

      <ErrorText error={error} />

      <Card className="mb-4">
        <CardHeader><CardTitle>Audit Logs ({filteredLogs.length})</CardTitle></CardHeader>
        <CardContent>{loading ? <Loading /> : <DataTable columns={columns} rows={filteredLogs} rowKey={(l) => l.id} />}</CardContent>
      </Card>

      <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
        <Info className="mt-0.5 h-5 w-5 shrink-0" />
        <p>Audit logs should be kept for 12 months. Super admins can export them as CSV for archiving.</p>
      </div>
    </AdminLayout>
  )
}
