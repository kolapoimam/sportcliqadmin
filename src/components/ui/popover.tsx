import * as P from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export function PopoverContent({ className, align = 'center', sideOffset = 6, ...p }: P.PopoverContentProps) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 rounded-xl border bg-white p-0 shadow-lg outline-none dark:bg-gray-800', className)}
        {...p}
      />
    </P.Portal>
  )
}
