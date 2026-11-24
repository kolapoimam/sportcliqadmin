import * as React from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-3xl bg-background shadow-soft ring-1 ring-black/[0.04] dark:ring-white/[0.06]', className)} {...p} />
}
export function CardHeader({ className, title, description, action, icon }: { className?: string; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <span className="mt-0.5 rounded-xl bg-playarena-50 p-2 text-primary dark:bg-playarena-950 [&_svg]:size-4">{icon}</span> : null}
        <div className="min-w-0">
          <h3 className="text-base font-bold leading-tight">{title}</h3>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}
export function CardContent({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5 sm:px-6 sm:pb-6', className)} {...p} />
}
