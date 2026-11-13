import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Building2, Calendar, DollarSign, UserPlus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications'
import type { AdminNotification } from '@/lib/adminOperations'
import { cn } from '@/lib/utils'

function iconFor(n: AdminNotification) {
  const text = `${n.link ?? ''} ${n.title}`.toLowerCase()
  if (text.includes('cashout')) return <DollarSign className="h-4 w-4 text-green-600" />
  if (text.includes('venue')) return <Building2 className="h-4 w-4 text-purple-600" />
  if (text.includes('user')) return <UserPlus className="h-4 w-4 text-blue-600" />
  if (text.includes('event') || text.includes('match') || text.includes('cycling')) return <Calendar className="h-4 w-4 text-orange-600" />
  return <Bell className="h-4 w-4 text-gray-500" />
}

export function NotificationDropdown({ onNewNotification, emptyText = 'No notifications' }: { onNewNotification?: () => void; emptyText?: string }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { notifications, unreadCount, markRead } = useRealtimeNotifications(onNewNotification)

  const handleClick = async (n: AdminNotification) => {
    await markRead(n.id)
    setOpen(false)
    navigate(n.link || '/')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
          <Bell className="h-5 w-5" />
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
        </div>
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={cn(
                      'flex w-full gap-3 border-b px-4 py-3 text-left last:border-0 hover:bg-gray-50 focus-visible:bg-gray-50 dark:hover:bg-gray-700/50',
                      n.unread !== false && 'bg-muted/20',
                    )}
                  >
                    <span className="mt-0.5 shrink-0">{iconFor(n)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{n.title}</span>
                        {n.unread !== false ? <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label="Unread" /> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{n.message}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">{new Date(n.sent_at).toLocaleString()}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
