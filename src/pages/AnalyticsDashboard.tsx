import { useCallback, useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, LineController,
  LineElement, PieController, PointElement, Title, Tooltip,
} from 'chart.js'
import { Calendar, DollarSign, Download, TrendingUp, Users } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable } from '@/components/ui/data-table'
import { ErrorText, Loading, PageHeader, StatCard } from '@/components/ui/page'
import { adminOperations, type Analytics } from '@/lib/adminOperations'
import { downloadBlob, errorMessage, naira } from '@/lib/utils'

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, PieController, ArcElement, CategoryScale, LinearScale, Tooltip, Legend, Title)

const RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }
const SPORT_COLORS = ['#05964f', '#0a0a0a', '#32d27f', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6']

function periodLabel(iso: string, unit: 'week' | 'month') {
  const d = new Date(iso)
  return unit === 'month' ? d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function useChart(ref: React.RefObject<HTMLCanvasElement | null>, build: () => Chart | null, deps: unknown[]) {
  useEffect(() => {
    const chart = build()
    return () => chart?.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

export default function AnalyticsDashboard() {
  const [range, setRange] = useState('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const userGrowthChartRef = useRef<HTMLCanvasElement>(null)
  const revenueChartRef = useRef<HTMLCanvasElement>(null)
  const sportsChartRef = useRef<HTMLCanvasElement>(null)

  const bounds = useCallback(() => {
    if (range === 'custom') {
      if (!customStart || !customEnd) return null
      return { start: new Date(`${customStart}T00:00:00`).toISOString(), end: new Date(new Date(`${customEnd}T00:00:00`).getTime() + 86400000).toISOString() }
    }
    const end = new Date()
    const start = new Date(end.getTime() - RANGES[range] * 86400000)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [range, customStart, customEnd])

  const load = useCallback(async () => {
    const b = bounds()
    if (!b) return
    setError(null)
    try {
      setData(await adminOperations.getAnalytics(b.start, b.end))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [bounds])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const dark = document.documentElement.classList.contains('dark')
  const tick = dark ? '#a1a1aa' : '#52525b'
  const grid = dark ? '#3f3f46' : '#e4e4e7'
  const unit = data?.period_unit ?? 'week'
  const unitTitle = unit === 'month' ? 'Month' : 'Week'

  useChart(userGrowthChartRef, () => {
    if (!userGrowthChartRef.current || !data || tab !== 'overview') return null
    return new Chart(userGrowthChartRef.current, {
      type: 'bar',
      data: {
        labels: data.user_growth.map((p) => periodLabel(p.period, unit)),
        datasets: [{ label: 'New users', data: data.user_growth.map((p) => p.count), backgroundColor: '#05964f', borderRadius: 6 }],
      },
      options: {
        responsive: true, maintainAspectRatio: true, aspectRatio: 2,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: unitTitle, color: tick }, ticks: { color: tick }, grid: { color: grid } },
          y: { beginAtZero: true, title: { display: true, text: 'User Count', color: tick }, ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
    })
  }, [data, tab, dark])

  useChart(revenueChartRef, () => {
    if (!revenueChartRef.current || !data || tab !== 'overview') return null
    const labels = data.revenue_trend.map((p) => periodLabel(p.period, unit))
    const ds = (label: string, key: 'match' | 'cycling' | 'venue', color: string) => ({
      label, data: data.revenue_trend.map((p) => Number(p[key] ?? 0)), borderColor: color, backgroundColor: color, tension: 0.3,
    })
    return new Chart(revenueChartRef.current, {
      type: 'line',
      data: { labels, datasets: [ds('Match', 'match', '#05964f'), ds('Cycling', 'cycling', '#3b82f6'), ds('Venue', 'venue', dark ? '#fafafa' : '#0a0a0a')] },
      options: {
        responsive: true, maintainAspectRatio: true, aspectRatio: 2,
        plugins: { legend: { labels: { color: tick } } },
        scales: {
          x: { title: { display: true, text: unitTitle, color: tick }, ticks: { color: tick }, grid: { color: grid } },
          y: { beginAtZero: true, title: { display: true, text: 'Revenue (₦)', color: tick }, ticks: { color: tick }, grid: { color: grid } },
        },
      },
    })
  }, [data, tab, dark])

  useChart(sportsChartRef, () => {
    if (!sportsChartRef.current || !data || tab !== 'sports') return null
    return new Chart(sportsChartRef.current, {
      type: 'pie',
      data: {
        labels: data.top_sports.map((s) => s.sport),
        datasets: [{ data: data.top_sports.map((s) => s.count), backgroundColor: data.top_sports.map((_, i) => SPORT_COLORS[i % SPORT_COLORS.length]) }],
      },
      options: { responsive: true, maintainAspectRatio: true, aspectRatio: 2, plugins: { legend: { position: 'right', labels: { color: tick } } } },
    })
  }, [data, tab, dark])

  const exportCSV = () => {
    if (!data) return
    const rows: (string | number)[][] = [
      ['Metric', 'Value'],
      ['Total Users', data.metrics.total_users],
      ['New Users', data.metrics.new_users],
      ['Total Events', data.metrics.total_events],
      ['Total Revenue', naira(data.metrics.total_revenue)],
      ['Active Venues', data.metrics.active_venues],
      [],
      ['Revenue Type', 'Revenue', 'Commission'],
      ...(['match', 'cycling', 'venue'] as const).map((k) => [k, naira(data.revenue[k]), naira(data.commission[k])]),
      [],
      ['Period', 'New Users'],
      ...data.user_growth.map((p) => [periodLabel(p.period, unit), p.count]),
      [],
      ['Period', 'Events Created'],
      ...data.event_trend.map((p) => [periodLabel(p.period, unit), p.count]),
      [],
      ['Sport', 'Events'],
      ...data.top_sports.map((s) => [s.sport, s.count]),
      [],
      ['Venue', 'City', 'Events', 'Revenue'],
      ...data.top_venues.map((v) => [v.name, v.city, v.events, naira(v.revenue)]),
    ]
    downloadBlob('﻿' + Papa.unparse(rows), 'analytics.csv', 'text/csv;charset=utf-8')
  }

  const exportPDF = async () => {
    if (!data) return
    const { createPdf, pdfWriter } = await import('@/lib/pdf')
    const doc = await createPdf()
    const { line, gap } = pdfWriter(doc)
    line('Sport Cliq Analytics', { bold: true, size: 16 })
    line(`Generated ${new Date().toLocaleString()}`, { size: 9 })
    gap()
    line('Key metrics', { bold: true, size: 13 })
    line(`Total users: ${data.metrics.total_users.toLocaleString()}`, { indent: 4 })
    line(`New users in period: ${data.metrics.new_users.toLocaleString()}`, { indent: 4 })
    line(`Total events: ${data.metrics.total_events.toLocaleString()}`, { indent: 4 })
    line(`Total revenue: ${naira(data.metrics.total_revenue)}`, { indent: 4 })
    line(`Active venues: ${data.metrics.active_venues.toLocaleString()}`, { indent: 4 })
    gap()
    line('Revenue and commission', { bold: true, size: 13 })
    for (const k of ['match', 'cycling', 'venue'] as const) {
      line(`${k[0].toUpperCase()}${k.slice(1)}: ${naira(data.revenue[k])} revenue, ${naira(data.commission[k])} commission (${data.commission_rates[k]}%)`, { indent: 4 })
    }
    gap()
    line('Top sports', { bold: true, size: 13 })
    data.top_sports.forEach((s) => line(`${s.sport}: ${s.count} events`, { indent: 4 }))
    gap()
    line('Top venues', { bold: true, size: 13 })
    data.top_venues.forEach((v, i) => line(`${i + 1}. ${v.name} (${v.city}): ${v.events} events, ${naira(v.revenue)}`, { indent: 4 }))
    doc.save('analytics.pdf')
  }

  return (
    <AdminLayout onNewNotification={load}>
      <PageHeader title="Analytics" description="User growth, revenue and sports activity.">
        <Button variant="outline" onClick={exportCSV} disabled={!data}><Download /> CSV</Button>
        <Button variant="outline" onClick={exportPDF} disabled={!data}><Download /> PDF</Button>
      </PageHeader>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select className="sm:w-48" ariaLabel="Time range" value={range} onValueChange={setRange} options={[
          { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' },
          { value: '1y', label: 'Last year' }, { value: 'custom', label: 'Custom range' },
        ]} />
        {range === 'custom' ? (
          <div className="grid grid-cols-2 gap-3">
            <DatePicker label="Start date" value={customStart} onChange={setCustomStart} />
            <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
          </div>
        ) : null}
      </div>

      <ErrorText error={error} />

      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Users" value={data.metrics.total_users.toLocaleString()} icon={<Users />} description={`${data.metrics.new_users.toLocaleString()} new in period`} />
            <StatCard label="Total Events" value={data.metrics.total_events.toLocaleString()} icon={<Calendar />} description="Created in period" />
            <StatCard label="Total Revenue" value={naira(data.metrics.total_revenue)} icon={<DollarSign />} description="In period" />
            <StatCard label="Active Venues" value={data.metrics.active_venues.toLocaleString()} icon={<TrendingUp />} description="Verified" />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="venues">Top Venues</TabsTrigger>
              <TabsTrigger value="sports">Sports Distribution</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>User growth</CardTitle></CardHeader>
                  <CardContent><canvas ref={userGrowthChartRef} aria-label="New users per period" role="img" /></CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Revenue trend</CardTitle></CardHeader>
                  <CardContent><canvas ref={revenueChartRef} aria-label="Revenue per period by type" role="img" /></CardContent>
                </Card>
              </div>
              <Card className="mt-4">
                <CardHeader><CardTitle>Revenue and commission</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {(['match', 'cycling', 'venue'] as const).map((k) => (
                    <div key={k} className="rounded-lg border p-4">
                      <p className="text-sm font-semibold capitalize">{k}</p>
                      <p className="mt-1 text-xl font-bold">{naira(data.revenue[k])}</p>
                      <p className="text-xs text-muted-foreground">Commission {naira(data.commission[k])} at {data.commission_rates[k]}%</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="venues">
              <Card>
                <CardHeader><CardTitle>Top venues</CardTitle></CardHeader>
                <CardContent>
                  <DataTable
                    rows={data.top_venues}
                    rowKey={(v) => v.id}
                    empty="No venue activity in this period"
                    columns={[
                      { key: 'rank', header: '#', cell: (v) => data.top_venues.indexOf(v) + 1 },
                      { key: 'name', header: 'Venue', cell: (v) => <span className="font-semibold">{v.name}</span> },
                      { key: 'city', header: 'City', cell: (v) => v.city },
                      { key: 'events', header: 'Events', cell: (v) => v.events },
                      { key: 'revenue', header: 'Revenue', cell: (v) => naira(v.revenue) },
                    ]}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="sports">
              <Card>
                <CardHeader><CardTitle>Events by sport</CardTitle></CardHeader>
                <CardContent>
                  {data.top_sports.length ? (
                    <div className="mx-auto max-w-2xl"><canvas ref={sportsChartRef} aria-label="Events by sport" role="img" /></div>
                  ) : (
                    <p className="py-10 text-center text-sm text-muted-foreground">No events in this period</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </AdminLayout>
  )
}
