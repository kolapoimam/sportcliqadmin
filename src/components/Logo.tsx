import { useId, useState } from 'react'
import { LOGO_URL } from '@/lib/supabase'
import { cn } from '@/lib/utils'

/** Sport Cliq mark used where the hosted logo cannot be shown (dark mode, offline). */
export function Mark({ className }: { className?: string }) {
  const id = `scg${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 64 64" className={cn('h-9 w-9', className)} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#32d27f" />
          <stop offset="1" stopColor="#05964f" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${id})`} />
      <path d="M41.5 21.5c-2.3-2.4-5.8-3.7-9.6-3.7-6.1 0-10.6 3.3-10.6 8.3 0 4.6 3.4 6.6 9.3 7.8 4.1.9 5.5 1.7 5.5 3.3 0 1.8-1.9 2.9-4.8 2.9-3.2 0-5.8-1.3-7.8-3.6l-4.4 4.6c2.8 3.1 7 4.9 12 4.9 6.6 0 11.4-3.3 11.4-8.6 0-4.7-3.3-6.8-9.6-8-3.8-.8-5.2-1.5-5.2-3 0-1.5 1.6-2.5 4-2.5 2.5 0 4.6.9 6.2 2.5z" fill="#fff" />
    </svg>
  )
}

export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className={cn('inline-flex items-center gap-2', className)}>
        <Mark className="h-8 w-8" />
        {showText ? <span className="text-base font-extrabold tracking-tight">Sport Cliq</span> : null}
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img src={LOGO_URL} alt="Sport Cliq" className="h-8 w-auto max-w-36 object-contain dark:hidden" onError={() => setFailed(true)} />
      <span className="hidden items-center gap-2 dark:inline-flex">
        <Mark className="h-8 w-8" />
        {showText ? <span className="text-base font-extrabold tracking-tight">Sport Cliq</span> : null}
      </span>
    </span>
  )
}
