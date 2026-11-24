import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, Building2, Calendar, DollarSign, ShieldCheck, Users, Wallet } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { StatCard, PageHeader } from '@/components/ui/page'
import { useAdminSession } from '@/hooks/useAdminSession'
import { adminOperations, type Metrics } from '@/lib/adminOperations'
import { cn, naira } from '@/lib/utils'

const ZERO: Metrics = { total_users: 0, total_events: 0, pending_cashouts: 0, total_revenue: 0, active_venues: 0 }
const REFRESH_MS = 300_000

export default function AdminDashboard() {
  const session = useAdminSession()
  const navigate = useNavigate()
  const [metrics, setMetrics] = useState<Metrics>(ZERO)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const m = await adminOperations.getMetrics()
        setMetrics({ ...ZERO, ...(m || {}) })
        setUpdatedAt(new Date())
      } catch (e) {
        console.error('Failed to load metrics', e)
        setMetrics(ZERO)
      }
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const cards = [
    { label: 'Total Users', value: Number(metrics.total_users).toLocaleString(), icon: <Users />, description: 'Active users' },
    { label: 'Total Events', value: Number(metrics.total_events).toLocaleString(), icon: <Calendar />, description: 'Matches and cycling events' },
    { label: 'Pending Cashouts', value: Number(metrics.pending_cashouts).toLocaleString(), icon: <Wallet />, description: 'Waiting for review' },
    { label: 'Total Revenue', value: naira(metrics.total_revenue), icon: <DollarSign />, description: 'Total platform revenue' },
    { label: 'Active Venues', value: Number(metrics.active_venues).toLocaleString(), icon: <Building2 />, description: 'Verified venues' },
  ]

  const actions = [
    { label: 'View Users', path: '/users', icon: Users, color: 'bg-blue-500 hover:bg-blue-600' },
    { label: 'View Events', path: '/events', icon: Calendar, color: 'bg-orange-500 hover:bg-orange-600' },
    { label: 'Review Cashouts', path: '/cashouts', icon: DollarSign, color: 'bg-green-600 hover:bg-green-700' },
    { label: 'View Analytics', path: '/analytics', icon: BarChart3, color: 'bg-purple-500 hover:bg-purple-600' },
    { label: 'Manage Venues', path: '/venues', icon: Building2, color: 'bg-teal-500 hover:bg-teal-600' },
    ...(session?.role === 'super_admin' ? [{ label: 'Manage Admins', path: '/admins', icon: ShieldCheck, color: 'bg-red-500 hover:bg-red-600' }] : []),
  ]

  return (
    <AdminLayout>
      <PageHeader
        title={`Welcome, ${session?.email || 'Admin'}`}
        description={updatedAt ? `Metrics refresh every 5 minutes. Last updated ${updatedAt.toLocaleTimeString()}.` : 'Here is how Sport Cliq is doing.'}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Quick actions</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {actions.map((a) => (
          <button
            key={a.path}
            type="button"
            onClick={() => navigate(a.path)}
            className={cn('flex items-center gap-3 rounded-xl px-5 py-4 text-left font-semibold text-white shadow-sm transition-colors cursor-pointer', a.color)}
          >
            <a.icon className="h-5 w-5" />
            {a.label}
          </button>
        ))}
      </div>
    </AdminLayout>
  )
}
