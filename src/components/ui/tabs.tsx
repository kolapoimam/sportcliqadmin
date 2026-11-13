import * as T from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = T.Root
export function TabsList({ className, ...p }: T.TabsListProps) {
  return <T.List className={cn('inline-flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800', className)} {...p} />
}
export function TabsTrigger({ className, ...p }: T.TabsTriggerProps) {
  return (
    <T.Trigger
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-gray-900 cursor-pointer',
        className,
      )}
      {...p}
    />
  )
}
export function TabsContent({ className, ...p }: T.TabsContentProps) {
  return <T.Content className={cn('mt-4 outline-none', className)} {...p} />
}
