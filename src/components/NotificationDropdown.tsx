import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { Bell, BellOff, Building2, Calendar, CheckCheck, DollarSign, UserPlus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications'
import type { AdminNotification } from '@/lib/adminOperations'
import { cn } from '@/lib/utils'

function iconFor(n: AdminNotification) {
  const text = `${n.link ?? ''} ${n.title}`.toLowerCase()
  if (text.includes('cashout')) return { icon: <DollarSign />, tone: 'bg-emerald-500' }
  if (text.includes('venue') || text.includes('booking')) return { icon: <Building2 />, tone: 'bg-violet-500' }
  if (text.includes('user')) return { icon: <UserPlus />, tone: 'bg-sky-500' }
  if (text.includes('event') || text.includes('match') || text.includes('cycling')) return { icon: <Calendar />, tone: 'bg-amber-500' }
  return { icon: <Bell />, tone: 'bg-gray-500' }
}

export function NotificationDropdown({ onNewNotification, emptyText = 'No notifications' }: { onNewNotification?: () => void; emptyText?: string }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { notifications, unreadCount, markRead, markAllRead } = useRealtimeNotifications(onNewNotification)

  const handleClick = async (n: AdminNotification) => {
    await markRead(n.id)
    setOpen(false)
    navigate(n.link || '/')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
          <Bell className="!size-[18px]" />
          {unreadCount > 0 ? (
            <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-background">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <p className="font-bold">Notifications</p>
          {unreadCount > 0 ? (
            <button type="button" onClick={markAllRead} className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-primary hover:underline">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
              <BellOff className="h-6 w-6" />
              {emptyText}
            </div>
          ) : (
            <ul className="space-y-1">
              {notifications.map((n) => {
                const meta = iconFor(n)
                const unread = n.unread !== false
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      className={cn('flex w-full cursor-pointer gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted', unread && 'bg-muted/20')}
                    >
                      <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white [&_svg]:size-4', meta.tone)}>{meta.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold">{n.title}</span>
                          {unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label="Unread" /> : null}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.message}</span>
                        <span className="mt-1 block text-[11px] font-medium text-muted-foreground" title={new Date(n.sent_at).toLocaleString()}>
                          {formatDistanceToNow(new Date(n.sent_at), { addSuffix: true })}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Button variant="ghost" className="w-full" onClick={() => { setOpen(false); navigate('/notifications') }}>Open notification center</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
