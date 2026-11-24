import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from './card'
import { cn } from '@/lib/utils'

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  )
}

export function StatCard({ label, value, icon, description, valueClassName }: { label: string; value: React.ReactNode; icon?: React.ReactNode; description?: string; valueClassName?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className={cn('mt-1 truncate text-2xl font-bold', valueClassName)}>{value}</p>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {icon ? <div className="rounded-lg bg-playarena-50 p-2 text-primary dark:bg-playarena-900/40 [&_svg]:size-5">{icon}</div> : null}
      </div>
    </Card>
  )
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null
  return <p className="mb-4 text-sm font-medium text-red-600 dark:text-red-400">Error: {error}</p>
}

export function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

export function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="break-words text-sm font-medium">{children ?? 'N/A'}</div>
    </div>
  )
}
