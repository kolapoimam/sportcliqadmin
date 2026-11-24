// The admin session in localStorage only decides what the website shows.
// Every real check happens in the database (2FA level, role permissions).

export type AdminRole = 'admin' | 'super_admin'

export interface AdminSession {
  id: string
  email: string
  role: AdminRole
  role_id?: string | null
  role_key?: string | null
  role_name?: string | null
  permissions: string[]
  first_name?: string | null
  last_name?: string | null
  avatar_url?: string | null
  aal?: string | null
  mfa_enrolled?: boolean
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

export function hasPermission(session: AdminSession | null, perm: string) {
  if (!session) return false
  const p = session.permissions || []
  return p.includes('*') || p.includes(perm)
}

export function sessionFromRecord(record: Record<string, unknown>): AdminSession {
  return {
    id: String(record.id),
    email: String(record.email),
    role: normalizeRole(String(record.role)),
    role_id: (record.role_id as string) ?? null,
    role_key: (record.role_key as string) ?? null,
    role_name: (record.role_name as string) ?? null,
    permissions: Array.isArray(record.permissions) ? (record.permissions as string[]) : [],
    first_name: (record.first_name as string) ?? null,
    last_name: (record.last_name as string) ?? null,
    avatar_url: (record.avatar_url as string) ?? null,
    aal: (record.aal as string) ?? null,
    mfa_enrolled: Boolean(record.mfa_enrolled),
  }
}
