import * as P from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export function PopoverContent({ className, align = 'center', sideOffset = 8, ...p }: P.PopoverContentProps) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 rounded-3xl bg-background p-0 shadow-lift outline-none ring-1 ring-black/5 animate-fade-in dark:ring-white/10', className)}
        {...p}
      />
    </P.Portal>
  )
}
