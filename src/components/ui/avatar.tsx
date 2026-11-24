import * as A from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

const TONES = [
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
]

export function initials(name?: string | null, fallback = 'U') {
  const parts = (name || '').trim().split(/[\s@._-]+/).filter(Boolean)
  if (!parts.length) return fallback
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function Avatar({ src, name, className }: { src?: string | null; name?: string | null; className?: string }) {
  const seed = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return (
    <A.Root className={cn('relative inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)}>
      {src ? <A.Image src={src} alt="" className="h-full w-full object-cover" /> : null}
      <A.Fallback className={cn('flex h-full w-full items-center justify-center text-[0.8em] font-bold', TONES[seed % TONES.length])}>
        {initials(name)}
      </A.Fallback>
    </A.Root>
  )
}
