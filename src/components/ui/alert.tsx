import * as React from 'react'
import { AlertTriangle, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Alert({ variant = 'error', className, children, icon }: { variant?: 'error' | 'success' | 'warning' | 'info'; className?: string; children: React.ReactNode; icon?: React.ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200',
    warning: 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200',
    info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200',
  }[variant]
  const defaultIcon = variant === 'success' ? <Shield className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />
  return (
    <div role="alert" className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', styles, className)}>
      <span className="mt-0.5 shrink-0">{icon ?? defaultIcon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
