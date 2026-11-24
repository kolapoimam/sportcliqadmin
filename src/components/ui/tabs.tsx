import * as T from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = T.Root
export function TabsList({ className, ...p }: T.TabsListProps) {
  return <T.List className={cn('no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-muted p-1', className)} {...p} />
}
export function TabsTrigger({ className, ...p }: T.TabsTriggerProps) {
  return (
    <T.Trigger
      className={cn(
        'shrink-0 cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-soft',
        className,
      )}
      {...p}
    />
  )
}
export function TabsContent({ className, ...p }: T.TabsContentProps) {
  return <T.Content className={cn('mt-5 outline-none animate-fade-in', className)} {...p} />
}
