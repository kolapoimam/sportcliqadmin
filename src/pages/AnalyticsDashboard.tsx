import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { BarChart3, Bike, Building2, Calendar, DollarSign, Download, FileText, Percent, Trophy, TrendingUp, Users } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { ChartCanvas, chartColors } from '@/components/Chart'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { DatePicker, SearchInput } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable } from '@/components/ui/data-table'
import { Alert, useToast } from '@/components/ui/feedback'
import { EmptyState, Loading, PageHeader, Pagination, Segmented, StatTile, toneStyles, usePaged } from '@/components/ui/page'
import { adminOperations, type Analytics } from '@/lib/adminOperations'
import { cn, downloadBlob, errorMessage, naira } from '@/lib/utils'

const RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }
const SPORT_COLORS = ['#05964f', '#0ea5e9', '#f59e0b', '#8b5cf6', '#f43f5e', '#14b8a6', '#0a0a0a', '#84cc16']
const STREAMS = [
  { key: 'match', label: 'Match', icon: Trophy, color: '#05964f', tone: 'green' },
  { key: 'cycling', label: 'Cycling', icon: Bike, color: '#0ea5e9', tone: 'blue' },
  { key: 'venue', label: 'Venue', icon: Building2, color: '#8b5cf6', tone: 'violet' },
] as const

function periodLabel(iso: string, unit: 'week' | 'month') {
  const d = new Date(iso)
  return unit === 'month' ? d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function AnalyticsDashboard() {
  const toast = useToast()
  const [range, setRange] = useState('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [venueSearch, setVenueSearch] = useState('')
  const userGrowthChartRef = useRef<HTMLCanvasElement>(null)
  const revenueChartRef = useRef<HTMLCanvasElement>(null)
  const sportsChartRef = useRef<HTMLCanvasElement>(null)

  const bounds = useCallback(() => {
    if (range === 'custom') {
      if (!customStart || !customEnd) return null
      return { start: new Date(`${customStart}T00:00:00`).toISOString(), end: new Date(new Date(`${customEnd}T00:00:00`).getTime() + 86400000).toISOString() }
    }
    const end = new Date()
    return { start: new Date(end.getTime() - RANGES[range] * 86400000).toISOString(), end: end.toISOString() }
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

  const unit = data?.period_unit ?? 'week'
  const unitTitle = unit === 'month' ? 'Month' : 'Week'
  const totalCommission = data ? data.commission.match + data.commission.cycling + data.commission.venue : 0
  const venues = useMemo(() => (data?.top_venues ?? []).filter((v) => !venueSearch || `${v.name} ${v.city}`.toLowerCase().includes(venueSearch.toLowerCase())), [data, venueSearch])
  const { pageRows: venueRows, pagination: venuePaging } = usePaged(venues, 5)

  const exportCSV = () => {
    if (!data) return
    const rows: (string | number)[][] = [
      ['Metric', 'Value'],
      ['Total Users', data.metrics.total_users], ['New Users', data.metrics.new_users], ['Total Events', data.metrics.total_events],
      ['Total Revenue', naira(data.metrics.total_revenue)], ['Total Commission', naira(totalCommission)], ['Active Venues', data.metrics.active_venues],
      [], ['Revenue Type', 'Revenue', 'Commission Rate', 'Commission'],
      ...STREAMS.map((s) => [s.label, naira(data.revenue[s.key]), `${data.commission_rates[s.key]}%`, naira(data.commission[s.key])]),
      [], ['Period', 'New Users'], ...data.user_growth.map((p) => [periodLabel(p.period, unit), p.count]),
      [], ['Period', 'Events Created'], ...data.event_trend.map((p) => [periodLabel(p.period, unit), p.count]),
      [], ['Sport', 'Events'], ...data.top_sports.map((s) => [s.sport, s.count]),
      [], ['Venue', 'City', 'Events', 'Revenue'], ...data.top_venues.map((v) => [v.name, v.city, v.events, naira(v.revenue)]),
    ]
    downloadBlob('﻿' + Papa.unparse(rows), 'analytics.csv', 'text/csv;charset=utf-8')
    toast.success('analytics.csv downloaded')
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
    line(`Total commission: ${naira(totalCommission)}`, { indent: 4 })
    line(`Active venues: ${data.metrics.active_venues.toLocaleString()}`, { indent: 4 })
    gap()
    line('Revenue and commission', { bold: true, size: 13 })
    STREAMS.forEach((s) => line(`${s.label}: ${naira(data.revenue[s.key])} revenue, ${naira(data.commission[s.key])} commission (${data.commission_rates[s.key]}%)`, { indent: 4 }))
    gap()
    line('Top sports', { bold: true, size: 13 })
    data.top_sports.forEach((s) => line(`${s.sport}: ${s.count} events`, { indent: 4 }))
    gap()
    line('Top venues', { bold: true, size: 13 })
    data.top_venues.forEach((v, i) => line(`${i + 1}. ${v.name} (${v.city}): ${v.events} events, ${naira(v.revenue)}`, { indent: 4 }))
    doc.save('analytics.pdf')
    toast.success('analytics.pdf downloaded')
  }

  return (
    <AdminLayout onNewNotification={load}>
      <PageHeader eyebrow="Overview" title="Analytics" description="User growth, revenue, commission and sports activity.">
        <Button variant="outline" onClick={exportCSV} disabled={!data}><Download /> CSV</Button>
        <Button variant="outline" onClick={exportPDF} disabled={!data}><FileText /> PDF</Button>
      </PageHeader>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented value={range} onChange={setRange} options={[
          { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: '1y', label: '1 year' }, { value: 'custom', label: 'Custom' },
        ]} />
        {range === 'custom' ? (
          <div className="grid grid-cols-2 gap-3 lg:w-80">
            <DatePicker label="Start date" value={customStart} onChange={setCustomStart} />
            <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
          </div>
        ) : null}
      </div>

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      {loading && !data ? <Card className="p-6"><Loading rows={6} /></Card> : data ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile tone="blue" label="Total Users" value={data.metrics.total_users.toLocaleString()} icon={<Users />} hint={`${data.metrics.new_users.toLocaleString()} new in period`} />
            <StatTile tone="amber" label="Total Events" value={data.metrics.total_events.toLocaleString()} icon={<Calendar />} hint="Created in period" />
            <StatTile tone="green" label="Total Revenue" value={naira(data.metrics.total_revenue)} icon={<DollarSign />} hint={`${naira(Math.round(totalCommission))} commission`} />
            <StatTile tone="violet" label="Active Venues" value={data.metrics.active_venues.toLocaleString()} icon={<TrendingUp />} hint="Verified" />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="venues">Top Venues</TabsTrigger>
              <TabsTrigger value="sports">Sports Distribution</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {STREAMS.map((s) => (
                  <Card key={s.key} className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-bold"><span className={cn('rounded-xl p-2 shadow-md', toneStyles[s.tone].chip)}><s.icon className="h-4 w-4" /></span>{s.label} revenue</span>
                      <span className="flex items-center gap-0.5 rounded-full bg-muted px-2 py-1 text-xs font-bold"><Percent className="h-3 w-3" />{data.commission_rates[s.key]}</span>
                    </div>
                    <p className="mt-4 text-2xl font-extrabold">{naira(data.revenue[s.key])}</p>
                    <p className="text-sm text-muted-foreground">Commission <b className={toneStyles[s.tone].text}>{naira(data.commission[s.key])}</b></p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ background: s.color, width: `${data.metrics.total_revenue ? Math.round((data.revenue[s.key] / data.metrics.total_revenue) * 100) : 0}%` }} />
                    </div>
                  </Card>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader icon={<Users />} title="User growth" description={`New users per ${unit}`} />
                  <CardContent>
                    <ChartCanvas canvasRef={userGrowthChartRef} label="New users per period" className="h-72" config={(dark) => {
                      const c = chartColors(dark)
                      return {
                        type: 'bar',
                        data: { labels: data.user_growth.map((p) => periodLabel(p.period, unit)), datasets: [{ label: 'New users', data: data.user_growth.map((p) => p.count), backgroundColor: '#0fb863', borderRadius: 10, maxBarThickness: 36 }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: {
                          x: { title: { display: true, text: unitTitle, color: c.tick }, ticks: { color: c.tick }, grid: { display: false } },
                          y: { beginAtZero: true, title: { display: true, text: 'User Count', color: c.tick }, ticks: { color: c.tick, precision: 0 }, grid: { color: c.grid }, border: { display: false } },
                        } },
                      }
                    }} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader icon={<TrendingUp />} title="Revenue trend" description="Match, cycling and venue revenue" />
                  <CardContent>
                    <ChartCanvas canvasRef={revenueChartRef} label="Revenue per period by type" className="h-72" config={(dark) => {
                      const c = chartColors(dark)
                      return {
                        type: 'line',
                        data: {
                          labels: data.revenue_trend.map((p) => periodLabel(p.period, unit)),
                          datasets: STREAMS.map((s) => ({ label: s.label, data: data.revenue_trend.map((p) => Number(p[s.key] ?? 0)), borderColor: s.color, backgroundColor: s.color + '22', tension: 0.4, fill: s.key === 'match', pointRadius: 3, borderWidth: 2.5 })),
                        },
                        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { color: c.tick, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${naira(x.parsed.y)}` } } }, scales: {
                          x: { title: { display: true, text: unitTitle, color: c.tick }, ticks: { color: c.tick }, grid: { display: false } },
                          y: { beginAtZero: true, title: { display: true, text: 'Revenue (₦)', color: c.tick }, ticks: { color: c.tick }, grid: { color: c.grid }, border: { display: false } },
                        } },
                      }
                    }} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader icon={<Calendar />} title="Events created" description={`Matches and rides per ${unit}`} />
                  <CardContent>
                    {data.event_trend.length === 0 ? <EmptyState icon={<Calendar />} title="No events created in this period" /> : <ChartCanvas label="Events created per period" className="h-64" config={(dark) => {
                      const c = chartColors(dark)
                      return {
                        type: 'bar',
                        data: { labels: data.event_trend.map((p) => periodLabel(p.period, unit)), datasets: [{ data: data.event_trend.map((p) => p.count), backgroundColor: '#f59e0b', borderRadius: 10, maxBarThickness: 36 }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: unitTitle, color: c.tick }, ticks: { color: c.tick }, grid: { display: false } }, y: { beginAtZero: true, title: { display: true, text: 'Events', color: c.tick }, ticks: { color: c.tick, precision: 0 }, grid: { color: c.grid }, border: { display: false } } } },
                      }
                    }} />}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader icon={<Percent />} title="Commission split" description={`${naira(Math.round(totalCommission))} earned in this period`} />
                  <CardContent>
                    {totalCommission > 0 ? (
                      <ChartCanvas label="Commission by revenue stream" className="h-64" config={(dark) => ({
                        type: 'doughnut',
                        data: { labels: STREAMS.map((s) => s.label), datasets: [{ data: STREAMS.map((s) => data.commission[s.key]), backgroundColor: STREAMS.map((s) => s.color), borderWidth: 0, spacing: 3, borderRadius: 8 }] },
                        options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { color: chartColors(dark).tick, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (x) => `${x.label}: ${naira(x.parsed)}` } } } },
                      })} />
                    ) : <EmptyState icon={<Percent />} title="No commission yet" text="Commission shows once paid activity happens in this period." />}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="venues">
              <Card>
                <CardHeader icon={<Building2 />} title="Top venues" description="Ranked by revenue in this period" action={<SearchInput value={venueSearch} onChange={setVenueSearch} placeholder="Search venues" className="hidden w-60 sm:block" />} />
                <CardContent>
                  <DataTable rows={venueRows} rowKey={(v) => v.id} empty={<EmptyState icon={<Building2 />} title="No venue activity in this period" />} columns={[
                    { key: 'rank', header: '#', cell: (v) => <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-extrabold">{data.top_venues.indexOf(v) + 1}</span> },
                    { key: 'name', header: 'Venue', sort: (v) => v.name, cell: (v) => <div><p className="font-bold">{v.name}</p><p className="text-xs text-muted-foreground">{v.city}</p></div> },
                    { key: 'events', header: 'Events', sort: (v) => v.events, cell: (v) => v.events },
                    { key: 'revenue', header: 'Revenue', sort: (v) => v.revenue, cell: (v) => <span className="font-bold">{naira(v.revenue)}</span> },
                  ]} />
                  <Pagination {...venuePaging} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="sports">
              <Card>
                <CardHeader icon={<BarChart3 />} title="Events by sport" />
                <CardContent>
                  {data.top_sports.length ? (
                    <div className="grid items-center gap-6 lg:grid-cols-[1.4fr_1fr]">
                      <ChartCanvas canvasRef={sportsChartRef} label="Events by sport" className="h-80" config={(dark) => ({
                        type: 'pie',
                        data: { labels: data.top_sports.map((s) => s.sport), datasets: [{ data: data.top_sports.map((s) => s.count), backgroundColor: data.top_sports.map((_, i) => SPORT_COLORS[i % SPORT_COLORS.length]), borderWidth: 2, borderColor: dark ? '#111514' : '#fff' }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: chartColors(dark).tick, usePointStyle: true, boxWidth: 8 } } } },
                      })} />
                      <ul className="space-y-2">
                        {data.top_sports.map((s, i) => {
                          const total = data.top_sports.reduce((a, b) => a + b.count, 0)
                          return (
                            <li key={s.sport} className="rounded-2xl bg-muted/60 p-3">
                              <div className="flex items-center justify-between text-sm font-bold"><span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: SPORT_COLORS[i % SPORT_COLORS.length] }} />{s.sport}</span>{s.count}</div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full" style={{ width: `${Math.round((s.count / total) * 100)}%`, background: SPORT_COLORS[i % SPORT_COLORS.length] }} /></div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : <EmptyState icon={<BarChart3 />} title="No events in this period" />}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </AdminLayout>
  )
}
