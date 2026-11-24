import { useEffect, useState } from 'react'
import { getAdminSession, hasPermission, type AdminSession } from '@/lib/session'

export function useAdminSession(): AdminSession | null {
  const [session, setSession] = useState(getAdminSession)
  useEffect(() => {
    const update = () => setSession(getAdminSession())
    window.addEventListener('admin-session', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('admin-session', update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return session
}

/** const can = useCan(); can('users.edit') */
export function useCan() {
  const session = useAdminSession()
  return (perm: string) => hasPermission(session, perm)
}
