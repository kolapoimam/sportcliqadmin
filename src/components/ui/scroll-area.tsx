import * as SA from '@radix-ui/react-scroll-area'
import { cn } from '@/lib/utils'

export function ScrollArea({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <SA.Root className={cn('overflow-hidden', className)}>
      <SA.Viewport className="h-full w-full">{children}</SA.Viewport>
      <SA.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-0.5">
        <SA.Thumb className="relative flex-1 rounded-full bg-gray-300 dark:bg-gray-600" />
      </SA.Scrollbar>
    </SA.Root>
  )
}
