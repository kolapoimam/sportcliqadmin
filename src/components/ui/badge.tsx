import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold leading-none [&_svg]:size-3', {
  variants: {
    variant: {
      default: 'bg-primary text-white',
      secondary: 'bg-muted text-gray-700 dark:text-gray-300',
      outline: 'border text-foreground',
      success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15 dark:bg-emerald-950/60 dark:text-emerald-300',
      warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/15 dark:bg-amber-950/60 dark:text-amber-300',
      danger: 'bg-red-50 text-red-700 ring-1 ring-red-600/15 dark:bg-red-950/60 dark:text-red-300',
      info: 'bg-sky-50 text-sky-700 ring-1 ring-sky-600/15 dark:bg-sky-950/60 dark:text-sky-300',
      violet: 'bg-violet-50 text-violet-700 ring-1 ring-violet-600/15 dark:bg-violet-950/60 dark:text-violet-300',
      dark: 'bg-gray-900 text-white dark:bg-white dark:text-gray-900',
    },
  },
  defaultVariants: { variant: 'secondary' },
})

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

export function Badge({ className, variant, dot, children, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...p}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

/** Maps common status words to a colour. */
export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const s = (status || 'unknown').toLowerCase().replace(/[^a-z]/g, '')
  const map: Record<string, BadgeVariant> = {
    active: 'success', verified: 'success', approved: 'success', live: 'success', sent: 'success', checkedin: 'success', paid: 'success', success: 'success',
    pending: 'warning', upcoming: 'info', registered: 'info', processing: 'info',
    rejected: 'danger', cancelled: 'danger', canceled: 'danger', inactive: 'danger', suspended: 'danger', failed: 'danger', absent: 'danger', noshow: 'danger',
    passed: 'secondary', completed: 'secondary',
  }
  const label = (status || 'Unknown').replace(/_/g, ' ')
  return <Badge variant={map[s] ?? 'secondary'} dot className={cn('capitalize', className)}>{label}</Badge>
}
