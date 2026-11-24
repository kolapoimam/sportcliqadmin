import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { adminOperations } from '@/lib/adminOperations'
import { getAdminSession } from '@/lib/session'
import { Loading } from '@/components/ui/page'

let verified = false

/** Lets the page render only when there is a Supabase session that belongs to an active admin. */
export function RequireAdmin() {
  const location = useLocation()
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>(verified && getAdminSession() ? 'ok' : 'checking')

  useEffect(() => {
    if (state !== 'checking') return
    adminOperations
      .refreshSession()
      .then((s) => {
        verified = Boolean(s)
        setState(s ? 'ok' : 'denied')
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
        Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
      </div>
    )
  }
  if (state === 'checking') return <Loading label="Checking your session..." />
  if (state === 'denied') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
