import * as M from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  tone?: 'default' | 'danger' | 'success'
  hidden?: boolean
  disabled?: boolean
}

export function Menu({ items, trigger, label = 'More actions', align = 'end' }: { items: (MenuItem | 'separator')[]; trigger?: React.ReactNode; label?: string; align?: 'start' | 'end' }) {
  const visible = items.filter((i) => i === 'separator' || !i.hidden)
  if (!visible.some((i) => i !== 'separator')) return null
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>
        {trigger ?? (
          <button type="button" aria-label={label} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
      </M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={6} className="z-[60] min-w-48 rounded-2xl bg-background p-1.5 shadow-lift ring-1 ring-black/5 animate-fade-in dark:ring-white/10">
          {visible.map((item, i) =>
            item === 'separator' ? (
              <M.Separator key={`s${i}`} className="my-1 h-px bg-border" />
            ) : (
              <M.Item
                key={item.label}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  'flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-40 [&_svg]:size-4',
                  item.tone === 'danger' && 'text-red-600 data-[highlighted]:bg-red-50 dark:data-[highlighted]:bg-red-950/50',
                  item.tone === 'success' && 'text-emerald-700 dark:text-emerald-400',
                )}
              >
                {item.icon}
                {item.label}
              </M.Item>
            ),
          )}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}
