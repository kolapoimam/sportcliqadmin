import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as D from '@radix-ui/react-dialog'
import {
  BarChart3, Bell, Building2, Calendar, ChevronLeft, ChevronRight, ClipboardList, DollarSign,
  LayoutDashboard, LogOut, Menu, Moon, ShieldCheck, Sun, Users,
} from 'lucide-react'
import { Logo } from './Logo'
import { NotificationDropdown } from './NotificationDropdown'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { SheetContent } from '@/components/ui/dialog'
import { useAdminSession } from '@/hooks/useAdminSession'
import { useTheme } from '@/hooks/useTheme'
import { adminOperations } from '@/lib/adminOperations'
import { cn } from '@/lib/utils'

const baseItems = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Users', path: '/users', icon: Users },
  { label: 'Events', path: '/events', icon: Calendar },
  { label: 'Cashouts', path: '/cashouts', icon: DollarSign },
  { label: 'Venues', path: '/venues', icon: Building2 },
  { label: 'Analytics', path: '/analytics', icon: BarChart3 },
  { label: 'Notifications', path: '/notifications', icon: Bell },
  { label: 'Audit Log', path: '/audit', icon: ClipboardList },
]
const bottomPaths = ['/', '/users', '/events', '/cashouts', '/notifications']

export function AdminLayout({ children, onNewNotification }: { children: React.ReactNode; onNewNotification?: () => void }) {
  const session = useAdminSession()
  const location = useLocation()
  const navigate = useNavigate()
  const { dark, toggle } = useTheme()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1')
  const [sheetOpen, setSheetOpen] = useState(false)

  const isSuper = session?.role === 'super_admin'
  const items = isSuper ? [...baseItems, { label: 'Admins', path: '/admins', icon: ShieldCheck }] : baseItems
  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path))

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('sidebarCollapsed', c ? '0' : '1')
      return !c
    })
  }

  const logout = async () => {
    await adminOperations.logout()
    navigate('/login', { replace: true })
  }

  const initials = (session?.first_name?.[0] ?? session?.email?.[0] ?? 'A').toUpperCase() + (session?.last_name?.[0] ?? '').toUpperCase()

  const nav = (compact: boolean, onNavigate?: () => void) => (
    <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Main">
      {items.map((item) => (
        <Link
          key={item.path}
          to={item.path}
          onClick={onNavigate}
          title={compact ? item.label : undefined}
          aria-current={isActive(item.path) ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
            compact && 'justify-center px-0',
            isActive(item.path) ? 'bg-primary-light text-white' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700',
          )}
        >
          <item.icon className="h-5 w-5 shrink-0" />
          {!compact ? <span>{item.label}</span> : <span className="sr-only">{item.label}</span>}
        </Link>
      ))}
      <button
        type="button"
        onClick={logout}
        title={compact ? 'Logout' : undefined}
        className={cn(
          'mt-auto flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 cursor-pointer',
          compact && 'justify-center px-0',
        )}
      >
        <LogOut className="h-5 w-5 shrink-0" />
        {!compact ? <span>Logout</span> : <span className="sr-only">Logout</span>}
      </button>
    </nav>
  )

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-3 border-b bg-white px-3 transition-all duration-300 sm:px-4 dark:bg-gray-800">
        <D.Root open={sheetOpen} onOpenChange={setSheetOpen}>
          <D.Trigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </D.Trigger>
          <SheetContent className="flex flex-col">
            <div className="flex h-16 items-center gap-2 border-b px-4">
              <Logo />
              <span className="font-bold">Admin</span>
            </div>
            {nav(false, () => setSheetOpen(false))}
          </SheetContent>
        </D.Root>
        <Link to="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-bold">Admin</span>
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <span className="hidden max-w-56 truncate text-sm text-muted-foreground lg:inline">{session?.email}</span>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
          <NotificationDropdown onNewNotification={onNewNotification} />
          <Link to="/profile" aria-label="My profile" className="rounded-full">
            <Avatar src={session?.avatar_url} fallback={initials} className="h-9 w-9" />
          </Link>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed bottom-0 left-0 top-16 z-30 hidden flex-col border-r bg-white transition-all duration-300 md:flex dark:bg-gray-800',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div className={cn('flex p-2', collapsed ? 'justify-center' : 'justify-end')}>
          <Button variant="ghost" size="icon" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
        {nav(collapsed)}
      </aside>

      {/* Main */}
      <main className={cn('px-3 pb-24 pt-20 transition-all duration-300 sm:px-6 md:pb-10', collapsed ? 'md:ml-16' : 'md:ml-64')}>
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-white md:hidden dark:bg-gray-800" aria-label="Quick">
        {items
          .filter((i) => bottomPaths.includes(i.path))
          .map((item) => (
            <Link
              key={item.path}
              to={item.path}
              aria-current={isActive(item.path) ? 'page' : undefined}
              className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive(item.path) ? 'text-primary' : 'text-gray-500 dark:text-gray-400')}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
      </nav>
    </div>
  )
}
