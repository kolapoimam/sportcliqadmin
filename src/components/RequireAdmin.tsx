import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { adminOperations } from '@/lib/adminOperations'
import { getAdminSession } from '@/lib/session'
import { assurance } from '@/lib/mfa'
import { Mark } from './Logo'

let verified = false

export function Splash({ text = 'Checking your session' }: { text?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <Mark className="h-14 w-14 animate-pulse" />
      <p className="text-sm font-medium text-muted-foreground">{text}</p>
    </div>
  )
}

/** Renders the admin pages only when there is a Supabase session that belongs to an active admin. */
export function RequireAdmin() {
  const location = useLocation()
  const [state, setState] = useState<'checking' | 'ok' | 'denied' | 'mfa'>(verified && getAdminSession() ? 'ok' : 'checking')

  useEffect(() => {
    if (state !== 'checking') return
    adminOperations
      .refreshSession()
      .then(async (s) => {
        if (!s) return setState('denied')
        const level = await assurance()
        if (level.currentLevel !== 'aal2') return setState('mfa')
        verified = true
        setState('ok')
      })
      .catch(() => setState('denied'))
  }, [state])

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        verified = false
        setState('denied')
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm text-red-600">
        Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel, then redeploy.
      </div>
    )
  }
  if (state === 'checking') return <Splash />
  if (state === 'denied') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (state === 'mfa') return <Navigate to="/mfa" replace state={{ from: location.pathname }} />
  return <Outlet />
}
