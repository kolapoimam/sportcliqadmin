import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowRight, BarChart3, Building2, Calendar, CheckCircle2, ClipboardList, DollarSign, Handshake, Percent, ShieldCheck, Sparkles, TrendingUp, Users, Wallet,
} from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { ChartCanvas, chartColors } from '@/components/Chart'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, StatTile } from '@/components/ui/page'
import { Avatar } from '@/components/ui/avatar'
import { useConfirm, useStepUp, useToast } from '@/components/ui/feedback'
import { useAdminSession, useCan } from '@/hooks/useAdminSession'
import { adminOperations, type CashoutRow, type Dashboard, type Metrics } from '@/lib/adminOperations'
import { cn, errorMessage, naira } from '@/lib/utils'

const ZERO: Metrics = { total_users: 0, total_events: 0, pending_cashouts: 0, total_revenue: 0, active_venues: 0 }
const REFRESH_MS = 300_000

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function AdminDashboard() {
  const session = useAdminSession()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const stepUp = useStepUp()
  const can = useCan()
  const toast = useToast()
  const [metrics, setMetrics] = useState<Metrics>(ZERO)
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [pending, setPending] = useState<CashoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    const [m, d, c] = await Promise.allSettled([adminOperations.getMetrics(), adminOperations.getDashboard(), adminOperations.getCashouts('pending', null, null)])
    if (m.status === 'fulfilled') setMetrics({ ...ZERO, ...(m.value || {}) })
    else {
      console.error('Failed to load metrics', m.reason)
      setMetrics(ZERO)
    }
    if (d.status === 'fulfilled') setDash(d.value)
    else console.error('Failed to load dashboard', d.reason)
    if (c.status === 'fulfilled') setPending((c.value || []).slice(0, 5))
    setUpdatedAt(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const approve = async (c: CashoutRow) => {
    const { ok, reason } = await confirm({ title: `Approve ${naira(c.amount)} cashout?`, description: `Payouts are manual. Send ${naira(c.amount)} to ${c.account_name || c.organizer}, ${c.bank_name} ${c.account_number} from your bank first, then approve.`, confirmText: 'Continue', tone: 'success', reasonLabel: 'Bank transfer reference', reasonOptional: true })
    if (!ok) return
    if (!(await stepUp('approve this payout'))) return
    try {
      await adminOperations.updateCashoutStatus(c.source, c.id, 'approved', undefined, reason)
      toast.success('Cashout approved')
      load()
    } catch (e) {
      toast.error('Could not approve', errorMessage(e))
    }
  }

  const name = session?.first_name || session?.email || 'Admin'

  const actions = [
    { label: 'View Users', path: '/users', icon: Users, color: 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/30', perm: 'users.view' },
    { label: 'View Events', path: '/events', icon: Calendar, color: 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/30', perm: 'events.view' },
    { label: 'Review Cashouts', path: '/cashouts', icon: DollarSign, color: 'bg-green-600 hover:bg-green-700 shadow-green-600/30', perm: 'cashouts.view' },
    { label: 'View Analytics', path: '/analytics', icon: BarChart3, color: 'bg-purple-500 hover:bg-purple-600 shadow-purple-500/30', perm: 'analytics.view' },
    { label: 'Manage Venues', path: '/venues', icon: Building2, color: 'bg-teal-500 hover:bg-teal-600 shadow-teal-500/30', perm: 'venues.view' },
    { label: 'Ambassadors', path: '/ambassadors', icon: Handshake, color: 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30', perm: 'ambassadors.view' },
    { label: 'Manage Admins', path: '/admins', icon: ShieldCheck, color: 'bg-red-500 hover:bg-red-600 shadow-red-500/30', perm: 'admins.view' },
  ].filter((a) => can(a.perm))

  const days = dash?.revenue_daily ?? []

  return (
    <AdminLayout onNewNotification={load} perm="dashboard.view">
      {/* Hero */}
      <div className="relative mb-6 overflow-hidden rounded-[32px] bg-[#03190f] p-6 text-white shadow-lift sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(600px_300px_at_100%_0%,rgba(15,184,99,0.45),transparent_60%),radial-gradient(400px_300px_at_0%_100%,rgba(5,150,79,0.35),transparent_60%)]" />
        <div className="relative grid min-w-0 gap-6 lg:grid-cols-[1fr_1.1fr] lg:items-end">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-playarena-300"><Sparkles className="h-4 w-4" /> {greeting()}</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Welcome, {name}</h1>
            <p className="mt-2 text-sm text-white/60">
              {updatedAt ? `Metrics refresh every 5 minutes. Updated ${updatedAt.toLocaleTimeString()}.` : 'Loading the latest numbers.'}
            </p>
            <div className="mt-6 grid max-w-md grid-cols-2 gap-2 sm:gap-3">
              <div className="min-w-0 rounded-2xl bg-white/[0.08] p-3 ring-1 ring-white/10 sm:p-4">
                <p className="text-xs font-semibold text-white/60">Revenue, 30 days</p>
                <p className="mt-1 truncate text-lg font-extrabold sm:text-2xl">{naira(dash?.revenue_30d)}</p>
              </div>
              <div className="min-w-0 rounded-2xl bg-white/[0.08] p-3 ring-1 ring-white/10 sm:p-4">
                <p className="text-xs font-semibold text-white/60">Commission, 30 days</p>
                <p className="mt-1 truncate text-lg font-extrabold text-playarena-300 sm:text-2xl">{naira(Math.round(dash?.commission_30d ?? 0))}</p>
              </div>
            </div>
          </div>
          <div className="min-w-0 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10">
            <p className="mb-2 text-xs font-semibold text-white/60">Daily revenue, last 14 days</p>
            <ChartCanvas
              label="Daily revenue for the last 14 days"
              className="h-36"
              config={() => ({
                type: 'line',
                data: {
                  labels: days.map((d) => new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })),
                  datasets: [{ data: days.map((d) => Number(d.amount)), borderColor: '#32d27f', backgroundColor: 'rgba(50,210,127,0.18)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2.5 }],
                },
                options: {
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => naira(c.parsed.y) } } },
                  scales: { x: { ticks: { color: 'rgba(255,255,255,0.5)', maxTicksLimit: 7, font: { size: 10 } }, grid: { display: false } }, y: { display: false, beginAtZero: true } },
                },
              })}
            />
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatTile loading={loading} tone="blue" label="Total Users" value={Number(metrics.total_users).toLocaleString()} icon={<Users />} hint={dash ? `${dash.new_users_7d} new this week` : 'Active users'} onClick={() => navigate('/users')} />
        <StatTile loading={loading} tone="amber" label="Total Events" value={Number(metrics.total_events).toLocaleString()} icon={<Calendar />} hint={dash ? `${dash.events_upcoming} upcoming` : 'Matches and rides'} onClick={() => navigate('/events')} />
        <StatTile loading={loading} tone="rose" label="Pending Cashouts" value={Number(metrics.pending_cashouts).toLocaleString()} icon={<Wallet />} hint="Waiting for review" onClick={() => navigate('/cashouts')} />
        <StatTile loading={loading} tone="green" label="Total Revenue" value={naira(metrics.total_revenue)} icon={<TrendingUp />} hint="Total platform revenue" onClick={() => navigate('/analytics')} />
        <StatTile loading={loading} tone="violet" label="Active Venues" value={Number(metrics.active_venues).toLocaleString()} icon={<Building2 />} hint={dash ? `${dash.pending_venues} waiting for verification` : 'Verified venues'} onClick={() => navigate('/venues')} />
        <StatTile loading={loading} tone="teal" label="SportCliq Commission" value={naira(Math.round(metrics.total_commission ?? 0))} icon={<Percent />} hint={`${metrics.active_ambassadors ?? 0} active ambassadors`} onClick={() => navigate('/analytics')} />
      </div>

      {/* Quick actions */}
      <h2 className="mb-3 mt-8 text-lg font-extrabold">Quick actions</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {actions.map((a) => (
          <button
            key={a.path}
            type="button"
            onClick={() => navigate(a.path)}
            className={cn('group flex cursor-pointer items-center gap-3 rounded-2xl px-5 py-4 text-left font-bold text-white shadow-lg transition-all hover:-translate-y-0.5', a.color)}
          >
            <span className="rounded-xl bg-white/20 p-2"><a.icon className="h-5 w-5" /></span>
            {a.label}
            <ArrowRight className="ml-auto h-4 w-4 opacity-0 transition-all group-hover:translate-x-1 group-hover:opacity-100" />
          </button>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Wallet />} title="Cashouts to review" description="Oldest requests need attention first." action={<Button variant="soft" size="sm" asChild><Link to="/cashouts">See all</Link></Button>} />
          <CardContent>
            {pending.length === 0 ? (
              <EmptyState icon={<CheckCircle2 />} title="All caught up" text="No cashout is waiting for review." />
            ) : (
              <ul className="space-y-2">
                {pending.map((c) => (
                  <li key={`${c.source}-${c.id}`} className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
                    <Avatar name={c.organizer} className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{c.organizer}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.type} · {c.event_title ?? 'N/A'}</p>
                    </div>
                    <p className="text-sm font-extrabold">{naira(c.amount)}</p>
                    {can('cashouts.approve') ? <Button size="sm" onClick={() => approve(c)}>Approve</Button> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader icon={<ClipboardList />} title="Recent admin activity" description="Latest actions from the audit log." action={<Button variant="soft" size="sm" asChild><Link to="/audit">Audit log</Link></Button>} />
          <CardContent>
            {!dash?.recent_activity?.length ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[19px] before:top-2 before:w-px before:bg-border">
                {dash.recent_activity.map((a) => (
                  <li key={a.id} className="relative flex gap-3">
                    <Avatar name={a.admin_email} className="h-10 w-10 ring-4 ring-background" />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-sm"><b className="capitalize">{a.action.replace(/_/g, ' ')}</b> <span className="text-muted-foreground">by {a.admin_email ?? 'system'}</span></p>
                      <p className="truncate text-xs text-muted-foreground">{a.details}</p>
                    </div>
                    <span className="shrink-0 pt-1 text-[11px] font-medium text-muted-foreground">{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader icon={<Users />} title="Sign ups, last 14 days" />
        <CardContent>
          <ChartCanvas
            label="Daily sign ups for the last 14 days"
            className="h-48"
            config={(dark) => {
              const c = chartColors(dark)
              const s = dash?.signups_daily ?? []
              return {
                type: 'bar',
                data: { labels: s.map((d) => new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })), datasets: [{ data: s.map((d) => d.count), backgroundColor: '#0fb863', borderRadius: 8, maxBarThickness: 28 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: c.tick }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: c.tick, precision: 0 }, grid: { color: c.grid }, border: { display: false } } } },
              }
            }}
          />
        </CardContent>
      </Card>
    </AdminLayout>
  )
}
