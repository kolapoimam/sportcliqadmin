import { useEffect, useState } from 'react'
import { getAdminSession, type AdminSession } from '@/lib/session'

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
