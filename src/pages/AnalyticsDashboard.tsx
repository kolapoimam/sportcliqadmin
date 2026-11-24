import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  BarChart3, Bike, Building2, Calendar, DollarSign, Download, FileText, Filter, MapPin, Percent, Receipt, RotateCcw, Trophy, TrendingUp, Users,
} from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { ChartCanvas, chartColors } from '@/components/Chart'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { DatePicker, SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable } from '@/components/ui/data-table'
import { Alert, useToast } from '@/components/ui/feedback'
import { useAdminSession, useCan } from '@/hooks/useAdminSession'
import { EmptyState, Loading, PageHeader, Pagination, Segmented, StatTile, toneStyles, usePaged } from '@/components/ui/page'
import { adminOperations, type Analytics, type AnalyticsFilters } from '@/lib/adminOperations'
import { cn, downloadBlob, errorMessage, formatDate, naira } from '@/lib/utils'

const RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }
const RANGE_LABEL: Record<string, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '1y': 'Last 12 months', custom: 'Custom range' }
const SPORT_COLORS = ['#05964f', '#0ea5e9', '#f59e0b', '#8b5cf6', '#f43f5e', '#14b8a6', '#0a0a0a', '#84cc16']
const STREAMS = [
  { key: 'match', label: 'Match', icon: Trophy, color: '#05964f', tone: 'green' },
  { key: 'cycling', label: 'Cycling', icon: Bike, color: '#0ea5e9', tone: 'blue' },
  { key: 'venue', label: 'Venue', icon: Building2, color: '#8b5cf6', tone: 'violet' },
] as const
const STREAM_LABEL: Record<string, string> = { match: 'Match', cycling: 'Cycling', venue: 'Venue booking' }
const NO_FILTERS: AnalyticsFilters = { stream: 'all', sport: 'all', city: 'all' }

function periodLabel(iso: string, unit: Analytics['period_unit']) {
  const d = new Date(iso)
  if (unit === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const chartImage = (c: HTMLCanvasElement | null) => {
  if (!c) return null
  // Flat white backing so the chart reads well on the PDF page
  const out = document.createElement('canvas')
  out.width = c.width
  out.height = c.height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(c, 0, 0)
  return { data: out.toDataURL('image/png'), ratio: c.height / c.width }
}

export default function AnalyticsDashboard() {
  const toast = useToast()
  const can = useCan()
  const session = useAdminSession()
  const [range, setRange] = useState('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [filters, setFilters] = useState<AnalyticsFilters>(NO_FILTERS)
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [venueSearch, setVenueSearch] = useState('')
  const [txSearch, setTxSearch] = useState('')
  const userGrowthChartRef = useRef<HTMLCanvasElement>(null)
  const revenueChartRef = useRef<HTMLCanvasElement>(null)
  const eventsChartRef = useRef<HTMLCanvasElement>(null)

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
      setData(await adminOperations.getAnalyticsFiltered(b.start, b.end, filters))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [bounds, filters])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const unit = data?.period_unit ?? 'week'
  const unitTitle = unit === 'month' ? 'Month' : unit === 'day' ? 'Day' : 'Week'
  const totalCommission = data ? data.metrics.total_commission ?? data.commission.match + data.commission.cycling + data.commission.venue : 0
  const filtersActive = filters.stream !== 'all' || filters.sport !== 'all' || filters.city !== 'all'
  const supportsFilters = !!data?.options

  const venues = useMemo(() => (data?.top_venues ?? []).filter((v) => !venueSearch || `${v.name} ${v.city}`.toLowerCase().includes(venueSearch.toLowerCase())), [data, venueSearch])
  const venuePaged = usePaged(venues, 10)
  const txs = useMemo(() => (data?.transactions_list ?? []).filter((t) => !txSearch || `${t.title} ${t.city} ${t.sport} ${t.kind}`.toLowerCase().includes(txSearch.toLowerCase())), [data, txSearch])
  const txPaged = usePaged(txs, 10)
  const cityPaged = usePaged(data?.top_cities ?? [], 10)

  const filterSummary = (): [string, string][] => {
    const b = bounds()
    return [
      ['Period', range === 'custom' && b ? `${formatDate(b.start)} to ${formatDate(new Date(new Date(b.end).getTime() - 86400000).toISOString())}` : RANGE_LABEL[range]],
      ['Stream', filters.stream === 'all' ? 'All' : STREAM_LABEL[filters.stream]],
      ['Sport', filters.sport === 'all' ? 'All' : filters.sport],
      ['City', filters.city === 'all' ? 'All' : filters.city],
    ]
  }
  const fileStem = () => `sportcliq-analytics-${new Date().toISOString().slice(0, 10)}`

  const exportCSV = () => {
    if (!data) return
    const rows: (string | number)[][] = [
      ['SportCliq Analytics'], ...filterSummary().map(([k, v]) => [k, v]), [],
      ['Metric', 'Value'],
      ['Total users', data.metrics.total_users], ['New users', data.metrics.new_users], ['Total events', data.metrics.total_events],
      ['Total revenue', data.metrics.total_revenue], ['Total commission', totalCommission], ['Transactions', data.metrics.transactions ?? ''], ['Active venues', data.metrics.active_venues],
      [], ['Revenue stream', 'Revenue', 'Effective rate %', 'Commission'],
      ...STREAMS.map((s) => [s.label, data.revenue[s.key], data.commission_rates[s.key], data.commission[s.key]]),
      [], ['Period', 'Match', 'Cycling', 'Venue', 'Commission'], ...data.revenue_trend.map((p) => [periodLabel(p.period, unit), p.match ?? 0, p.cycling ?? 0, p.venue ?? 0, p.commission ?? '']),
      [], ['Period', 'New users'], ...data.user_growth.map((p) => [periodLabel(p.period, unit), p.count]),
      [], ['Period', 'Events created'], ...data.event_trend.map((p) => [periodLabel(p.period, unit), p.count]),
      [], ['Sport', 'Events'], ...data.top_sports.map((s) => [s.sport, s.count]),
      [], ['City', 'Revenue', 'Transactions'], ...(data.top_cities ?? []).map((c) => [c.city, c.revenue, c.count]),
      [], ['Venue', 'City', 'Events', 'Revenue'], ...data.top_venues.map((v) => [v.name, v.city, v.events, v.revenue]),
      [], ['Date', 'Stream', 'Item', 'Sport', 'City', 'Amount', 'Rate %', 'Commission'],
      ...(data.transactions_list ?? []).map((t) => [new Date(t.at).toLocaleString(), STREAM_LABEL[t.kind], t.title, t.sport, t.city, t.amount, t.rate, t.commission]),
    ]
    downloadBlob('﻿' + Papa.unparse(rows), `${fileStem()}.csv`, 'text/csv;charset=utf-8')
    toast.success('CSV downloaded')
  }

  const exportPDF = async () => {
    if (!data) return
    setExporting(true)
    try {
      const { brandedReport } = await import('@/lib/report')
      const charts: { title: string; image: string; height: number }[] = []
      for (const [title, ref] of [['Revenue trend', revenueChartRef], ['User growth', userGrowthChartRef], ['Events created', eventsChartRef]] as const) {
        const img = chartImage(ref.current)
        if (img) charts.push({ title, image: img.data, height: Math.min(80, 182 * img.ratio) })
      }
      await brandedReport({
        title: 'Analytics report',
        subtitle: 'Revenue, commission, users and activity on SportCliq for the selected period and filters.',
        filters: filterSummary(),
        generatedBy: [session?.first_name, session?.last_name].filter(Boolean).join(' ') || session?.email,
        kpis: [
          { label: 'Total revenue', value: naira(data.metrics.total_revenue) },
          { label: 'Commission', value: naira(Math.round(totalCommission)) },
          { label: 'Transactions', value: (data.metrics.transactions ?? 0).toLocaleString() },
          { label: 'Average ticket', value: naira(Math.round(data.metrics.avg_ticket ?? 0)) },
          { label: 'Total users', value: data.metrics.total_users.toLocaleString() },
          { label: 'New users', value: data.metrics.new_users.toLocaleString() },
          { label: 'Events created', value: data.metrics.total_events.toLocaleString() },
          { label: 'Active venues', value: data.metrics.active_venues.toLocaleString() },
        ],
        sections: [
          {
            title: 'Revenue by stream', head: ['Stream', 'Revenue', 'Effective rate', 'Commission'], alignRight: [1, 2, 3],
            rows: STREAMS.map((s) => [s.label, naira(data.revenue[s.key]), `${data.commission_rates[s.key]}%`, naira(data.commission[s.key])]),
            foot: ['Total', naira(data.metrics.total_revenue), '', naira(Math.round(totalCommission))],
          },
          ...charts,
          {
            title: `Revenue per ${unit}`, head: [unitTitle, 'Match', 'Cycling', 'Venue', 'Commission'], alignRight: [1, 2, 3, 4],
            rows: data.revenue_trend.map((p) => [periodLabel(p.period, unit), naira(p.match ?? 0), naira(p.cycling ?? 0), naira(p.venue ?? 0), naira(p.commission ?? 0)]),
          },
          { title: 'Events by sport', head: ['Sport', 'Events'], alignRight: [1], rows: data.top_sports.map((s) => [s.sport, s.count]) },
          ...(data.top_cities ? [{ title: 'Revenue by city', head: ['City', 'Transactions', 'Revenue'], alignRight: [1, 2], rows: data.top_cities.map((c) => [c.city, c.count, naira(c.revenue)]) }] : []),
          { title: 'Top venues', head: ['#', 'Venue', 'City', 'Events', 'Revenue'], alignRight: [3, 4], rows: data.top_venues.slice(0, 25).map((v, i) => [i + 1, v.name, v.city, v.events, naira(v.revenue)]) },
          ...(data.transactions_list ? [{
            title: `Transactions${data.transactions_list.length > 300 ? ' (latest 300, full list in CSV)' : ''}`,
            head: ['Date', 'Stream', 'Item', 'City', 'Amount', 'Rate', 'Commission'], alignRight: [4, 5, 6],
            rows: data.transactions_list.slice(0, 300).map((t) => [formatDate(t.at), STREAM_LABEL[t.kind], t.title, t.city || '-', naira(t.amount), `${t.rate}%`, naira(t.commission)]),
          }] : []),
        ],
        fileName: `${fileStem()}.pdf`,
      })
      adminOperations.logEvent('export', `Analytics PDF (${filterSummary().map(([k, v]) => `${k} ${v}`).join(', ')})`).catch(() => undefined)
      toast.success('PDF report downloaded')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const sportOptions = [{ value: 'all', label: 'All sports' }, ...(data?.options?.sports ?? []).map((s) => ({ value: s, label: s }))]
  const cityOptions = [{ value: 'all', label: 'All cities' }, ...(data?.options?.cities ?? []).map((c) => ({ value: c, label: c }))]

  return (
    <AdminLayout onNewNotification={load} perm="analytics.view">
      <PageHeader eyebrow="Overview" title="Analytics" description="User growth, revenue, commission and sports activity.">
        {can('analytics.export') ? <Button variant="outline" onClick={exportCSV} disabled={!data}><Download /> CSV</Button> : null}
        {can('analytics.export') ? <Button onClick={exportPDF} disabled={!data} loading={exporting}><FileText /> PDF report</Button> : null}
      </PageHeader>

      <Card className="mb-5 p-4">
        <div className="flex flex-col gap-3">
          <Segmented value={range} onChange={setRange} options={[
            { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: '1y', label: '1 year' }, { value: 'custom', label: 'Custom' },
          ]} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
            {range === 'custom' ? (
              <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-4 lg:max-w-md">
                <DatePicker label="Start date" value={customStart} onChange={setCustomStart} />
                <DatePicker label="End date" value={customEnd} onChange={setCustomEnd} />
              </div>
            ) : null}
            <Select ariaLabel="Revenue stream" icon={<Filter />} value={filters.stream} onValueChange={(v) => setFilters((f) => ({ ...f, stream: v }))} disabled={!supportsFilters}
              options={[{ value: 'all', label: 'All streams' }, { value: 'match', label: 'Matches' }, { value: 'cycling', label: 'Cycling' }, { value: 'venue', label: 'Venue bookings' }]} />
            <Select ariaLabel="Sport" icon={<Trophy />} value={filters.sport} onValueChange={(v) => setFilters((f) => ({ ...f, sport: v }))} options={sportOptions} disabled={!supportsFilters} />
            <Select ariaLabel="City" icon={<MapPin />} value={filters.city} onValueChange={(v) => setFilters((f) => ({ ...f, city: v }))} options={cityOptions} disabled={!supportsFilters} />
            <Button variant="ghost" onClick={() => setFilters(NO_FILTERS)} disabled={!filtersActive}><RotateCcw /> Reset</Button>
          </div>
          {!supportsFilters && data ? <p className="text-xs text-muted-foreground">Run the latest database update to turn on stream, sport and city filters.</p> : null}
        </div>
      </Card>

      {error ? <Alert className="mb-4">{error}</Alert> : null}

      {loading && !data ? <Card className="p-6"><Loading rows={6} /></Card> : data ? (
        <div className={cn('transition-opacity', loading && 'opacity-60')}>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile tone="green" label="Total revenue" value={naira(data.metrics.total_revenue)} icon={<DollarSign />} hint={`${naira(Math.round(totalCommission))} commission`} />
            <StatTile tone="violet" label="Transactions" value={(data.metrics.transactions ?? 0).toLocaleString()} icon={<Receipt />} hint={data.metrics.avg_ticket != null ? `${naira(Math.round(data.metrics.avg_ticket))} average` : undefined} />
            <StatTile tone="blue" label="Users" value={data.metrics.total_users.toLocaleString()} icon={<Users />} hint={`${data.metrics.new_users.toLocaleString()} new in period`} />
            <StatTile tone="amber" label="Events" value={data.metrics.total_events.toLocaleString()} icon={<Calendar />} hint={`${data.metrics.active_venues} verified venues`} />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="venues">Top venues</TabsTrigger>
              <TabsTrigger value="cities">Cities</TabsTrigger>
              <TabsTrigger value="sports">Sports</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" forceMount className="data-[state=inactive]:hidden">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {STREAMS.map((s) => (
                  <Card key={s.key} className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-bold"><span className={cn('rounded-xl p-2', toneStyles[s.tone].chip)}><s.icon className="h-4 w-4" /></span>{s.label} revenue</span>
                      <span title="Effective rate after free activities and bookings" className="flex items-center gap-0.5 rounded-full bg-muted px-2 py-1 text-xs font-bold">{data.commission_rates[s.key]}<Percent className="h-3 w-3" /> effective</span>
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
                  <CardHeader icon={<TrendingUp />} title="Revenue trend" description={`Revenue per ${unit} by stream`} />
                  <CardContent>
                    <ChartCanvas canvasRef={revenueChartRef} label="Revenue per period by stream" className="h-72" config={(dark) => {
                      const c = chartColors(dark)
                      return {
                        type: 'bar',
                        data: {
                          labels: data.revenue_trend.map((p) => periodLabel(p.period, unit)),
                          datasets: STREAMS.map((s) => ({ label: s.label, data: data.revenue_trend.map((p) => Number(p[s.key] ?? 0)), backgroundColor: s.color, borderRadius: 6, maxBarThickness: 28, stack: 'rev' })),
                        },
                        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { color: c.tick, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${naira(x.parsed.y)}` } } }, scales: {
                          x: { stacked: true, title: { display: true, text: unitTitle, color: c.tick }, ticks: { color: c.tick }, grid: { display: false } },
                          y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Revenue (₦)', color: c.tick }, ticks: { color: c.tick }, grid: { color: c.grid }, border: { display: false } },
                        } },
                      }
                    }} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader icon={<Users />} title="User growth" description={`New users per ${unit}`} />
                  <CardContent>
                    <ChartCanvas canvasRef={userGrowthChartRef} label="New users per period" className="h-72" config={(dark) => {
                      const c = chartColors(dark)
                      return {
                        type: 'bar',
                        data: { labels: data.user_growth.map((p) => periodLabel(p.period, unit)), datasets: [{ label: 'New users', data: data.user_growth.map((p) => p.count), backgroundColor: '#35B551', borderRadius: 10, maxBarThickness: 36 }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: {
                          x: { title: { display: true, text: unitTitle, color: c.tick }, ticks: { color: c.tick }, grid: { display: false } },
                          y: { beginAtZero: true, title: { display: true, text: 'Users', color: c.tick }, ticks: { color: c.tick, precision: 0 }, grid: { color: c.grid }, border: { display: false } },
                        } },
                      }
                    }} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader icon={<Calendar />} title="Events created" description={`Matches and rides per ${unit}`} />
                  <CardContent>
                    {data.event_trend.length === 0 ? <EmptyState icon={<Calendar />} title="No events created for these filters" /> : <ChartCanvas canvasRef={eventsChartRef} label="Events created per period" className="h-64" config={(dark) => {
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
                  <CardHeader icon={<Percent />} title="Commission split" description={`${naira(Math.round(totalCommission))} earned`} />
                  <CardContent>
                    {totalCommission > 0 ? (
                      <ChartCanvas label="Commission by revenue stream" className="h-64" config={(dark) => ({
                        type: 'doughnut',
                        data: { labels: STREAMS.map((s) => s.label), datasets: [{ data: STREAMS.map((s) => data.commission[s.key]), backgroundColor: STREAMS.map((s) => s.color), borderWidth: 0, spacing: 3, borderRadius: 8 }] },
                        options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { color: chartColors(dark).tick, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (x) => `${x.label}: ${naira(x.parsed)}` } } } },
                      })} />
                    ) : <EmptyState icon={<Percent />} title="No commission yet" text="Commission shows once paid activity happens for these filters." />}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="transactions">
              <Card>
                <CardHeader icon={<Receipt />} title="Transactions" description="Every paid item behind the numbers above" action={<SearchInput value={txSearch} onChange={(v) => { setTxSearch(v); txPaged.reset() }} placeholder="Search items" className="hidden w-60 sm:block" />} />
                <CardContent>
                  {!data.transactions_list ? <EmptyState icon={<Receipt />} title="Run the latest database update to see transactions" /> : (
                    <>
                      <SearchInput value={txSearch} onChange={(v) => { setTxSearch(v); txPaged.reset() }} placeholder="Search items" className="mb-3 sm:hidden" />
                      <DataTable rows={txPaged.pageRows} rowKey={(t) => `${t.at}${t.title}${t.amount}${t.kind}`} empty={<EmptyState icon={<Receipt />} title="No transactions for these filters" />} columns={[
                        { key: 'item', header: 'Item', sort: (t) => t.title, cell: (t) => <div className="min-w-0"><p className="truncate font-bold">{t.title}</p><p className="text-xs text-muted-foreground">{formatDate(t.at)}</p></div> },
                        { key: 'kind', header: 'Stream', sort: (t) => t.kind, cell: (t) => <Badge variant="outline">{STREAM_LABEL[t.kind]}</Badge> },
                        { key: 'city', header: 'City', sort: (t) => t.city, hideOnMobile: true, cell: (t) => t.city || '-' },
                        { key: 'amount', header: 'Amount', sort: (t) => t.amount, cell: (t) => <span className="font-bold">{naira(t.amount)}</span> },
                        { key: 'comm', header: 'Commission', sort: (t) => t.commission, cell: (t) => <span>{naira(t.commission)} <span className="text-xs text-muted-foreground">{t.rate}%</span></span> },
                      ]} />
                      <Pagination {...txPaged.pagination} />
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="venues">
              <Card>
                <CardHeader icon={<Building2 />} title="Top venues" description="Ranked by revenue" action={<SearchInput value={venueSearch} onChange={(v) => { setVenueSearch(v); venuePaged.reset() }} placeholder="Search venues" className="hidden w-60 sm:block" />} />
                <CardContent>
                  <SearchInput value={venueSearch} onChange={(v) => { setVenueSearch(v); venuePaged.reset() }} placeholder="Search venues" className="mb-3 sm:hidden" />
                  <DataTable rows={venuePaged.pageRows} rowKey={(v) => v.id} empty={<EmptyState icon={<Building2 />} title="No venue activity for these filters" />} columns={[
                    { key: 'rank', header: '#', cell: (v) => <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-extrabold">{data.top_venues.indexOf(v) + 1}</span> },
                    { key: 'name', header: 'Venue', sort: (v) => v.name, cell: (v) => <div><p className="font-bold">{v.name}</p><p className="text-xs text-muted-foreground">{v.city}</p></div> },
                    { key: 'events', header: 'Events', sort: (v) => v.events, cell: (v) => v.events },
                    { key: 'revenue', header: 'Revenue', sort: (v) => v.revenue, cell: (v) => <span className="font-bold">{naira(v.revenue)}</span> },
                  ]} />
                  <Pagination {...venuePaged.pagination} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cities">
              <Card>
                <CardHeader icon={<MapPin />} title="Revenue by city" description="Based on the venue or ride start point" />
                <CardContent>
                  {!data.top_cities ? <EmptyState icon={<MapPin />} title="Run the latest database update to see cities" /> : (
                    <>
                      <DataTable rows={cityPaged.pageRows} rowKey={(c) => c.city} empty={<EmptyState icon={<MapPin />} title="No city data for these filters" />} columns={[
                        { key: 'city', header: 'City', sort: (c) => c.city, cell: (c) => <span className="font-bold">{c.city}</span> },
                        { key: 'count', header: 'Transactions', sort: (c) => c.count, cell: (c) => c.count.toLocaleString() },
                        { key: 'revenue', header: 'Revenue', sort: (c) => c.revenue, cell: (c) => <span className="font-bold">{naira(c.revenue)}</span> },
                        { key: 'share', header: 'Share', hideOnMobile: true, cell: (c) => (
                          <div className="flex items-center gap-2"><div className="h-2 w-28 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${data.metrics.total_revenue ? Math.round((c.revenue / data.metrics.total_revenue) * 100) : 0}%` }} /></div><span className="text-xs text-muted-foreground">{data.metrics.total_revenue ? Math.round((c.revenue / data.metrics.total_revenue) * 100) : 0}%</span></div>
                        ) },
                      ]} />
                      <Pagination {...cityPaged.pagination} />
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="sports">
              <Card>
                <CardHeader icon={<BarChart3 />} title="Events by sport" />
                <CardContent>
                  {data.top_sports.length ? (
                    <div className="grid items-center gap-6 lg:grid-cols-[1.4fr_1fr]">
                      <ChartCanvas label="Events by sport" className="h-80" config={(dark) => ({
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
                  ) : <EmptyState icon={<BarChart3 />} title="No events for these filters" />}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </AdminLayout>
  )
}
