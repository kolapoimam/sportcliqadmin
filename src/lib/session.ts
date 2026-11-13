// The admin session kept in localStorage is only used for display (menu items, names).
// Every real permission check happens in the database through RLS and admin_* functions.

export type AdminRole = 'admin' | 'super_admin'

export interface AdminSession {
  id: string
  email: string
  role: AdminRole
  permissions: string[]
  first_name?: string | null
  last_name?: string | null
  avatar_url?: string | null
}

const KEY = 'adminSession'

export function getAdminSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as AdminSession) : null
  } catch {
    return null
  }
}

export function setAdminSession(session: AdminSession) {
  localStorage.setItem(KEY, JSON.stringify(session))
  window.dispatchEvent(new Event('admin-session'))
}

export function clearAdminSession() {
  localStorage.removeItem(KEY)
  window.dispatchEvent(new Event('admin-session'))
}

export function normalizeRole(role: string | null | undefined): AdminRole {
  return (role || '').toLowerCase().replace(/[^a-z]/g, '') === 'superadmin' ? 'super_admin' : 'admin'
}
