import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as D from '@radix-ui/react-dialog'
import * as Tip from '@radix-ui/react-tooltip'
import {
  BarChart3, Bell, Building2, Calendar, ClipboardList, LayoutDashboard, LogOut, Menu as MenuIcon, Moon,
  PanelLeftClose, PanelLeftOpen, Settings, Download, ShieldCheck, Sun, User, Users, Wallet, Handshake, ShieldAlert,
} from 'lucide-react'
import { Logo, Mark } from './Logo'
import { NotificationDropdown } from './NotificationDropdown'
import { useInstallApp } from './InstallApp'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { SheetContent } from '@/components/ui/dialog'
import { Menu } from '@/components/ui/menu'
import { useConfirm } from '@/components/ui/feedback'
import { useAdminSession, useCan } from '@/hooks/useAdminSession'
import { useTheme } from '@/hooks/useTheme'
import { adminOperations } from '@/lib/adminOperations'
import { cn } from '@/lib/utils'

type Item = { label: string; path: string; icon: typeof Users; perm: string }
const groups: { title: string; items: Item[] }[] = [
  { title: 'Overview', items: [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard, perm: 'dashboard.view' },
    { label: 'Analytics', path: '/analytics', icon: BarChart3, perm: 'analytics.view' },
  ] },
  { title: 'Manage', items: [
    { label: 'Users', path: '/users', icon: Users, perm: 'users.view' },
    { label: 'Events', path: '/events', icon: Calendar, perm: 'events.view' },
    { label: 'Venues', path: '/venues', icon: Building2, perm: 'venues.view' },
    { label: 'Ambassadors', path: '/ambassadors', icon: Handshake, perm: 'ambassadors.view' },
  ] },
  { title: 'Money', items: [{ label: 'Cashouts', path: '/cashouts', icon: Wallet, perm: 'cashouts.view' }] },
  { title: 'System', items: [
    { label: 'Notifications', path: '/notifications', icon: Bell, perm: 'notifications.view' },
    { label: 'Audit Log', path: '/audit', icon: ClipboardList, perm: 'audit.view' },
    { label: 'Admins', path: '/admins', icon: ShieldCheck, perm: 'admins.view' },
    { label: 'Settings', path: '/settings', icon: Settings, perm: 'settings.view' },
  ] },
]
const bottom: Item[] = [
  { label: 'Home', path: '/', icon: LayoutDashboard, perm: 'dashboard.view' },
  { label: 'Users', path: '/users', icon: Users, perm: 'users.view' },
  { label: 'Events', path: '/events', icon: Calendar, perm: 'events.view' },
  { label: 'Cashouts', path: '/cashouts', icon: Wallet, perm: 'cashouts.view' },
  { label: 'Ambassadors', path: '/ambassadors', icon: Handshake, perm: 'ambassadors.view' },
  { label: 'Alerts', path: '/notifications', icon: Bell, perm: 'notifications.view' },
]

/** Shown when a page is opened without the permission to see it. */
export function NoAccess({ perm }: { perm: string }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-3xl bg-background p-10 text-center shadow-soft ring-1 ring-black/[0.04]">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-red-50 text-red-500 dark:bg-red-950"><ShieldAlert className="h-8 w-8" /></span>
      <h1 className="mt-5 text-xl font-extrabold">Access Denied</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your role does not include <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-bold">{perm}</code>. Ask a super admin if you need it.</p>
    </div>
  )
}

export function AdminLayout({ children, onNewNotification, perm }: { children: React.ReactNode; onNewNotification?: () => void; perm?: string }) {
  const session = useAdminSession()
  const can = useCan()
  const location = useLocation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { dark, toggle } = useTheme()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1')
  const [sheetOpen, setSheetOpen] = useState(false)
  const installApp = useInstallApp()

  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path))
  const name = [session?.first_name, session?.last_name].filter(Boolean).join(' ') || session?.email || 'Admin'

  // Page views go into the audit trail (shown when "page views" is ticked on the Audit Log)
  useEffect(() => {
    const t = setTimeout(() => {
      adminOperations.logEvent('page_view', location.pathname).catch(() => undefined)
    }, 800)
    return () => clearTimeout(t)
  }, [location.pathname])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('sidebarCollapsed', c ? '0' : '1')
      return !c
    })
  }

  const logout = async () => {
    const { ok } = await confirm({ title: 'Log out?', description: 'You will need to sign in again to use the admin portal.', confirmText: 'Log out', icon: <LogOut /> })
    if (!ok) return
    await adminOperations.logout()
    navigate('/login', { replace: true })
  }

  const nav = (compact: boolean, onNavigate?: () => void) => (
    <nav className="no-scrollbar flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {groups.map((g) => {
        const items = g.items.filter((i) => can(i.perm))
        if (!items.length) return null
        return (
          <div key={g.title}>
            {!compact ? <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80">{g.title}</p> : <div className="mx-auto mb-2 h-px w-6 bg-border" />}
            <div className="flex flex-col gap-1">
              {items.map((item) => {
                const active = isActive(item.path)
                const link = (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-all',
                      compact && 'justify-center px-0',
                      active
                        ? 'bg-primary-light text-white shadow-md shadow-primary/25'
                        : 'text-gray-600 hover:bg-muted hover:text-foreground dark:text-gray-300',
                    )}
                  >
                    <item.icon className={cn('h-[18px] w-[18px] shrink-0', !active && 'text-gray-400 group-hover:text-primary dark:text-gray-500')} />
                    {!compact ? <span>{item.label}</span> : <span className="sr-only">{item.label}</span>}
                  </Link>
                )
                return compact ? (
                  <Tip.Root key={item.path} delayDuration={100}>
                    <Tip.Trigger asChild>{link}</Tip.Trigger>
                    <Tip.Portal>
                      <Tip.Content side="right" sideOffset={10} className="z-50 rounded-lg bg-gray-950 px-2.5 py-1.5 text-xs font-semibold text-white animate-fade-in dark:bg-white dark:text-gray-950">
                        {item.label}
                      </Tip.Content>
                    </Tip.Portal>
                  </Tip.Root>
                ) : (
                  link
                )
              })}
            </div>
          </div>
        )
      })}
    </nav>
  )

  const profileCard = (compact: boolean) => (
    <div className={cn('border-t p-3', compact && 'flex flex-col items-center gap-2')}>
      {compact ? (
        <>
          <Link to="/profile" aria-label="My profile"><Avatar src={session?.avatar_url} name={name} className="h-9 w-9" /></Link>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Log out" className="text-red-600"><LogOut /></Button>
        </>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl bg-muted/70 p-2.5">
          <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar src={session?.avatar_url} name={name} className="h-9 w-9" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{session?.role_name || (session?.role || 'admin').replace('_', ' ')}</span>
            </span>
          </Link>
          <Button variant="ghost" size="icon-sm" onClick={logout} aria-label="Log out" className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950"><LogOut /></Button>
        </div>
      )}
    </div>
  )

  return (
    <Tip.Provider>
      <div className="min-h-dvh">
        {/* Desktop sidebar */}
        <aside className={cn('fixed inset-y-0 left-0 z-40 hidden flex-col border-r bg-background transition-[width] duration-300 md:flex', collapsed ? 'w-[76px]' : 'w-64')}>
          <div className={cn('flex h-16 items-center border-b', collapsed ? 'justify-center px-2' : 'justify-between px-5')}>
            <Link to="/" className="flex items-center gap-2" aria-label="Dashboard">
              {collapsed ? <Mark className="h-9 w-9" /> : <><Logo className="[&_img]:h-8" /><span className="rounded-md bg-gray-950 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white dark:bg-white dark:text-gray-950">Admin</span></>}
            </Link>
          </div>
          {nav(collapsed)}
          {profileCard(collapsed)}
        </aside>

        {/* Header */}
        <header
          className={cn(
            'sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-xl transition-[margin] duration-300 sm:px-5',
            collapsed ? 'md:ml-[76px]' : 'md:ml-64',
          )}
        >
          <D.Root open={sheetOpen} onOpenChange={setSheetOpen}>
            <D.Trigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu"><MenuIcon className="!size-5" /></Button>
            </D.Trigger>
            <SheetContent>
              <div className="flex h-16 items-center gap-2 border-b px-5">
                <Logo className="[&_img]:h-8" />
                <span className="rounded-md bg-gray-950 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white dark:bg-white dark:text-gray-950">Admin</span>
              </div>
              {nav(false, () => setSheetOpen(false))}
              {profileCard(false)}
            </SheetContent>
          </D.Root>
          <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen className="!size-5" /> : <PanelLeftClose className="!size-5" />}
          </Button>
          <Link to="/" className="md:hidden" aria-label="Dashboard"><Mark className="h-8 w-8" /></Link>
          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {dark ? <Sun className="!size-[18px]" /> : <Moon className="!size-[18px]" />}
            </Button>
            <NotificationDropdown onNewNotification={onNewNotification} />
            <Menu
              trigger={
                <button type="button" aria-label="Account menu" className="ml-1 flex cursor-pointer items-center gap-2 rounded-full p-0.5 pr-0.5 transition-colors hover:bg-muted sm:pr-3">
                  <Avatar src={session?.avatar_url} name={name} className="h-9 w-9" />
                  <span className="hidden max-w-40 truncate text-sm font-semibold sm:inline">{session?.first_name || session?.email}</span>
                </button>
              }
              items={[
                { label: 'My profile', icon: <User />, onSelect: () => navigate('/profile') },
                { label: 'Settings', icon: <Settings />, onSelect: () => navigate('/settings'), hidden: !can('settings.view') },
                { label: 'Install app', icon: <Download />, onSelect: installApp.run, hidden: !installApp.available },
                'separator',
                { label: 'Log out', icon: <LogOut />, tone: 'danger', onSelect: logout },
              ]}
            />
          </div>
        </header>

        {/* Main */}
        <main className={cn('px-4 pb-32 pt-6 transition-[margin] duration-300 sm:px-6 md:pb-12 lg:px-8', collapsed ? 'md:ml-[76px]' : 'md:ml-64')}>
          <div className="mx-auto max-w-7xl animate-fade-in">{perm && session && !can(perm) ? <NoAccess perm={perm} /> : children}</div>
        </main>

        {installApp.modal}

        {/* Floating pill bottom nav on phones */}
        <nav className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between rounded-full bg-gray-950/95 p-1.5 shadow-lift backdrop-blur md:hidden dark:bg-white/95" aria-label="Quick">
          {bottom.filter((i) => can(i.perm)).slice(0, 5).map((item) => {
            const active = isActive(item.path)
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 text-[10px] font-bold transition-all',
                  active ? 'bg-primary-light text-white' : 'text-white/60 dark:text-gray-500',
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </Tip.Provider>
  )
}
