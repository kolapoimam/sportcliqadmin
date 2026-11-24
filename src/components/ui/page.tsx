import * as React from 'react'
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { Card } from './card'
import { Select } from './select'
import { cn } from '@/lib/utils'

export function PageHeader({ title, description, children, eyebrow }: { title: string; description?: string; children?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">{eyebrow}</p> : null}
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  )
}

export type Tone = 'green' | 'blue' | 'violet' | 'amber' | 'rose' | 'teal' | 'gray' | 'black'

export const toneStyles: Record<Tone, { chip: string; text: string; soft: string }> = {
  green: { chip: 'bg-emerald-500 text-white shadow-emerald-500/30', text: 'text-emerald-600 dark:text-emerald-400', soft: 'from-emerald-50 dark:from-emerald-950/40' },
  blue: { chip: 'bg-sky-500 text-white shadow-sky-500/30', text: 'text-sky-600 dark:text-sky-400', soft: 'from-sky-50 dark:from-sky-950/40' },
  violet: { chip: 'bg-violet-500 text-white shadow-violet-500/30', text: 'text-violet-600 dark:text-violet-400', soft: 'from-violet-50 dark:from-violet-950/40' },
  amber: { chip: 'bg-amber-500 text-white shadow-amber-500/30', text: 'text-amber-600 dark:text-amber-400', soft: 'from-amber-50 dark:from-amber-950/40' },
  rose: { chip: 'bg-rose-500 text-white shadow-rose-500/30', text: 'text-rose-600 dark:text-rose-400', soft: 'from-rose-50 dark:from-rose-950/40' },
  teal: { chip: 'bg-teal-500 text-white shadow-teal-500/30', text: 'text-teal-600 dark:text-teal-400', soft: 'from-teal-50 dark:from-teal-950/40' },
  gray: { chip: 'bg-gray-500 text-white shadow-gray-500/30', text: 'text-gray-700 dark:text-gray-300', soft: 'from-gray-50 dark:from-gray-900/40' },
  black: { chip: 'bg-gray-950 text-white shadow-gray-950/30 dark:bg-white dark:text-gray-950', text: 'text-foreground', soft: 'from-gray-100 dark:from-gray-900/60' },
}

export function StatTile({ label, value, icon, hint, tone = 'green', onClick, active, loading }: { label: string; value: React.ReactNode; icon?: React.ReactNode; hint?: React.ReactNode; tone?: Tone; onClick?: () => void; active?: boolean; loading?: boolean }) {
  const t = toneStyles[tone]
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-3xl bg-gradient-to-br to-background to-60% p-4 text-left shadow-soft ring-1 ring-black/[0.04] transition-all sm:p-5 dark:ring-white/[0.06]',
        t.soft,
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lift',
        active && 'ring-2 ring-primary dark:ring-primary',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-muted-foreground">{label}</p>
        {icon ? <span className={cn('rounded-xl p-2 shadow-md [&_svg]:size-4', t.chip)}>{icon}</span> : null}
      </div>
      {loading ? <div className="skeleton mt-3 h-8 w-24 rounded-lg" /> : <p className="mt-2 truncate text-2xl font-extrabold tracking-tight sm:text-[28px]">{value}</p>}
      {hint ? <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </Comp>
  )
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all',
              active ? 'bg-gray-950 text-white shadow-md dark:bg-white dark:text-gray-950' : 'bg-background text-muted-foreground ring-1 ring-black/[0.06] hover:text-foreground dark:ring-white/10',
            )}
          >
            {o.label}
            {o.count !== undefined ? (
              <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none', active ? 'bg-white/20 dark:bg-gray-950/15' : 'bg-muted')}>{o.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 rounded-3xl bg-muted p-4 text-muted-foreground [&_svg]:size-7">{icon ?? <Inbox />}</span>
      <p className="font-bold">{title}</p>
      {text ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Loading({ rows = 5 }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-3 py-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-1/3 rounded" />
            <div className="skeleton h-3 w-1/2 rounded" />
          </div>
          <div className="skeleton hidden h-6 w-20 rounded-full sm:block" />
        </div>
      ))}
    </div>
  )
}

export function Detail({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-2xl bg-muted/60 px-4 py-3', className)}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm font-semibold">{children ?? 'N/A'}</div>
    </div>
  )
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Card className={cn('mb-4 grid grid-cols-1 gap-3 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-4', className)}>{children}</Card>
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, sizes = [10, 20, 50] }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (s: number) => void; sizes?: number[] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const nums: (number | '…')[] = []
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i)
    else if (nums[nums.length - 1] !== '…') nums.push('…')
  }
  const btn = 'inline-flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-xl px-2 text-sm font-semibold transition-colors disabled:cursor-default disabled:opacity-40'
  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t pt-4 sm:flex-row">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          <b className="text-foreground">{from.toLocaleString()}</b> to <b className="text-foreground">{to.toLocaleString()}</b> of <b className="text-foreground">{total.toLocaleString()}</b>
        </span>
        {onPageSize ? (
          <span className="hidden items-center gap-2 sm:flex">
            Rows
            <Select ariaLabel="Rows per page" className="h-9 w-[76px] rounded-xl" value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))} options={sizes.map((s) => ({ value: String(s), label: String(s) }))} />
          </span>
        ) : null}
      </div>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <button type="button" className={cn(btn, 'hover:bg-muted')} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} className="px-1 text-muted-foreground">…</span>
          ) : (
            <button
              key={n}
              type="button"
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPage(n)}
              className={cn(btn, n === page ? 'bg-primary text-white shadow-sm shadow-primary/30' : 'hover:bg-muted')}
            >
              {n}
            </button>
          ),
        )}
        <button type="button" className={cn(btn, 'hover:bg-muted')} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </nav>
    </div>
  )
}

/** Client side paging for lists already in memory. Resets to page 1 when the list length changes. */
export function usePaged<T>(rows: T[], initialSize = 10) {
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(initialSize)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pages)
  const pageRows = React.useMemo(() => rows.slice((safePage - 1) * pageSize, safePage * pageSize), [rows, safePage, pageSize])
  return {
    pageRows,
    pagination: {
      page: safePage,
      pageSize,
      total: rows.length,
      onPage: setPage,
      onPageSize: (s: number) => {
        setPageSize(s)
        setPage(1)
      },
    },
    reset: () => setPage(1),
  }
}
