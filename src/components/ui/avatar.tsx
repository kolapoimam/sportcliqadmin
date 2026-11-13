import * as A from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

export function Avatar({ src, fallback, className }: { src?: string | null; fallback: string; className?: string }) {
  return (
    <A.Root className={cn('relative inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)}>
      {src ? <A.Image src={src} alt="" className="h-full w-full object-cover" /> : null}
      <A.Fallback className="flex h-full w-full items-center justify-center bg-playarena-100 font-semibold text-playarena-800 dark:bg-playarena-900 dark:text-playarena-100">
        {fallback}
      </A.Fallback>
    </A.Root>
  )
}
