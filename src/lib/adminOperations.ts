import { supabase, SITE_URL, MAIN_APP_URL } from './supabase'
import { normalizeRole, setAdminSession, clearAdminSession, getAdminSession, type AdminSession } from './session'

// ---------- Types ----------

export interface Metrics {
  total_users: number
  total_events: number
  pending_cashouts: number
  total_revenue: number
  active_venues: number
}

export interface AdminNotification {
  id: string
  title: string
  message: string
  category: string
  type: string
  target_type: string
  target_id: string | null
  link: string | null
  unread: boolean | null
  sent_at: string
  recipients: number | null
  status: string | null
}

export interface UserRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  account_status: string | null
  created_at: string
  categories: string[]
  event_type: 'match' | 'cycling' | null
  event_id: string | null
  event_title: string | null
  location: string | null
  value: number | null
  slots: number | null
  event_status: 'Registered' | 'Checked In' | 'Absent' | null
  confirmation_code: string | null
  events_organized: number
  events_participated: number
  total_earned: number
  total_spent: number
  super_code: string | null
  access_pin: string | null
  last_cashout: string | null
  last_activity: string | null
  badges: string[]
}

export interface EventRow {
  id: string
  event_type: 'match' | 'cycling'
  title: string
  sport: string
  organizer: string | null
  organizer_phone: string | null
  event_date: string | null
  status: string
  participants: number
  capacity: number | null
  venue: string | null
  tickets_sold: number
  avg_rating: number | null
  start_landmark: string | null
  end_landmark: string | null
  price: number
  is_paid: boolean
  super_code: string | null
  created_at: string
}

export interface CashoutRow {
  id: string
  source: 'cashouts' | 'cycling_cashouts' | 'venue_booking_cashout'
  type: 'Match' | 'Cycling' | 'Venue'
  organizer: string
  amount: number
  status: string
  created_at: string
  event_title: string | null
  checked_in: number | null
  account_name: string | null
  bank_name: string | null
  account_number: string | null
  rejection_reason: string | null
  super_code: string | null
}

export interface VenueRow {
  id: string
  name: string
  address: string
  city: string
  state: string
  map_link: string | null
  created_at: string
  booking_fee: number | null
  price_per_hour: number | null
  image_urls: string[] | null
  verification_documents: string[] | null
  rejection_reason: string | null
  status: 'pending' | 'verified' | 'rejected'
  owner_name: string | null
  owner_phone: string | null
  owner_email: string | null
  events_count: number
  revenue: number
}

export interface VenueBooking {
  id: string
  date: string
  amount: number
  status: string | null
  title: string | null
  booker_name: string | null
}

export interface AdminRow {
  id: string
  email: string
  role: string
  status: string
  last_login: string | null
  created_at: string
  first_name: string | null
  last_name: string | null
  linked: boolean
}

export interface AuditLogRow {
  id: string
  admin_id: string | null
  admin_email: string
  action: string
  details: string | null
  ip_address: string | null
  created_at: string
}

export interface Analytics {
  period_unit: 'week' | 'month'
  metrics: { total_users: number; new_users: number; total_events: number; total_revenue: number; active_venues: number }
  revenue: { match: number; cycling: number; venue: number }
  commission: { match: number; cycling: number; venue: number }
  commission_rates: { match: number; cycling: number; venue: number }
  user_growth: { period: string; count: number }[]
  revenue_trend: { period: string; match: number | null; cycling: number | null; venue: number | null }[]
  event_trend: { period: string; count: number }[]
  top_sports: { sport: string; count: number }[]
  top_venues: { id: string; name: string; city: string; events: number; revenue: number }[]
}

// ---------- Helpers ----------

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    // Edge function errors carry the JSON body in error.context
    let message = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json()
        if (j?.error) message = j.error
      }
    } catch {
      /* keep default message */
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

// ---------- Operations ----------

export const adminOperations = {
  // Auth
  async login(email: string, password: string): Promise<AdminSession> {
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) throw authError

    const record = await rpc<Record<string, unknown> | null>('admin_get_session').catch(async (e) => {
      await supabase.auth.signOut()
      throw e
    })
    if (!record) {
      await supabase.auth.signOut()
      throw new Error('This account does not have admin access.')
    }
    const session: AdminSession = {
      id: String(record.id),
      email: String(record.email),
      role: normalizeRole(String(record.role)),
      permissions: Array.isArray(record.permissions) ? (record.permissions as string[]) : [],
      first_name: (record.first_name as string) ?? null,
      last_name: (record.last_name as string) ?? null,
      avatar_url: (record.avatar_url as string) ?? null,
    }
    setAdminSession(session)
    await supabase
      .from('audit_logs')
      .insert({ admin_id: session.id, action: 'login', details: `Admin ${session.email} logged in`, ip_address: window.location.hostname })
    return session
  },

  async logout() {
    const s = getAdminSession()
    if (s) {
      await supabase
        .from('audit_logs')
        .insert({ admin_id: s.id, action: 'logout', details: `Admin ${s.email} logged out`, ip_address: window.location.hostname })
        .then(() => undefined, () => undefined)
    }
    clearAdminSession()
    await supabase.auth.signOut()
  },

  async refreshSession(): Promise<AdminSession | null> {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      clearAdminSession()
      return null
    }
    const record = await rpc<Record<string, unknown> | null>('admin_get_session').catch(() => null)
    if (!record) {
      clearAdminSession()
      return null
    }
    const session: AdminSession = {
      id: String(record.id),
      email: String(record.email),
      role: normalizeRole(String(record.role)),
      permissions: Array.isArray(record.permissions) ? (record.permissions as string[]) : [],
      first_name: (record.first_name as string) ?? null,
      last_name: (record.last_name as string) ?? null,
      avatar_url: (record.avatar_url as string) ?? null,
    }
    setAdminSession(session)
    return session
  },

  setupAvailable: () => rpc<boolean>('admin_setup_available'),

  createFirstAdmin: (email: string, password: string, secretKey: string) =>
    callFunction<{ ok: boolean }>('admin-setup', { email, password, secretKey }),

  sendPasswordReset: (email: string, forAdmin = true) =>
    supabase.auth
      .resetPasswordForEmail(email, { redirectTo: forAdmin ? `${SITE_URL}/reset-password` : MAIN_APP_URL })
      .then(({ error }) => {
        if (error) throw error
      }),

  // Dashboard and analytics
  getMetrics: () => rpc<Metrics>('admin_get_metrics'),
  getAnalytics: (start: string, end: string) => rpc<Analytics>('admin_get_analytics', { p_start: start, p_end: end }),
  getSettings: () => rpc<Record<string, unknown>>('admin_get_settings'),
  setCommissionRates: (rates: { match: number; cycling: number; venue: number }) =>
    rpc<void>('admin_set_commission_rates', { p_rates: rates }),

  // Users
  getUsers: (params: { page: number; perPage: number; category: string; start: string | null; end: string | null; search?: string }) =>
    rpc<{ total: number; rows: UserRow[] }>('admin_get_users', {
      p_page: params.page,
      p_per_page: params.perPage,
      p_category: params.category,
      p_start: params.start,
      p_end: params.end,
      p_search: params.search || null,
    }),
  updateUserStatus: (userId: string, eventType: string, eventId: string, status: string) =>
    rpc<void>('admin_update_user_status', { p_user_id: userId, p_event_type: eventType, p_event_id: eventId, p_status: status }),
  performCustomAction: (userId: string, action: string, targetTable: string) =>
    rpc<void>('admin_user_action', { p_user_id: userId, p_action: action, p_target_table: targetTable }),

  // Events
  getEvents: (f: { search?: string; status: string; sport: string; start: string | null; end: string | null }) =>
    rpc<EventRow[]>('admin_get_events', { p_search: f.search || null, p_status: f.status, p_sport: f.sport, p_start: f.start, p_end: f.end }),
  updateEvent: (type: string, id: string, title: string, date: string | null) =>
    rpc<void>('admin_update_event', { p_event_type: type, p_id: id, p_title: title, p_date: date }),
  updateEventStatus: (type: string, id: string, status: string) =>
    rpc<void>('admin_set_event_status', { p_event_type: type, p_id: id, p_status: status }),
  deleteEvent: (type: string, id: string) => rpc<void>('admin_delete_event', { p_event_type: type, p_id: id }),

  // Cashouts
  getCashouts: (status: string, start: string | null, end: string | null) =>
    rpc<CashoutRow[]>('admin_get_cashouts', { p_status: status, p_start: start, p_end: end }),
  updateCashoutStatus: (source: string, id: string, status: 'approved' | 'rejected', reason?: string) =>
    rpc<void>('admin_update_cashout_status', { p_source: source, p_id: id, p_status: status, p_reason: reason ?? null }),

  // Venues
  getVenues: () => rpc<VenueRow[]>('admin_get_venues'),
  getVenueBookings: (venueId: string) => rpc<VenueBooking[]>('admin_get_venue_bookings', { p_venue_id: venueId }),
  toggleVenueStatus: (id: string, status: 'pending' | 'verified' | 'rejected', reason?: string) =>
    rpc<void>('admin_set_venue_status', { p_id: id, p_status: status, p_reason: reason ?? null }),
  deleteVenue: (id: string) => rpc<void>('admin_delete_venue', { p_id: id }),

  // Notifications
  async getNotifications(opts: { limit?: number; alertsOnly?: boolean; excludeAlerts?: boolean; start?: string | null; end?: string | null } = {}) {
    let q = supabase.from('notifications').select('*').order('sent_at', { ascending: false })
    if (opts.start) q = q.gte('sent_at', opts.start)
    if (opts.end) q = q.lt('sent_at', opts.end)
    if (opts.limit) q = q.limit(opts.limit)
    const { data, error } = await q
    if (error) throw error
    const rows = (data || []) as AdminNotification[]
    if (opts.alertsOnly) return rows.filter((n) => isAdminAlert(n))
    if (opts.excludeAlerts) return rows.filter((n) => !isAdminAlert(n))
    return rows
  },
  async markNotificationRead(id: string) {
    const { error } = await supabase.from('notifications').update({ unread: false, read_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  },
  sendNotification: (p: { type: string; target: string; targetId: string | null; title: string; message: string }) =>
    rpc<AdminNotification>('admin_send_notification', {
      p_type: p.type,
      p_target: p.target,
      p_target_id: p.targetId,
      p_title: p.title,
      p_message: p.message,
    }),

  // Audit
  getAuditLogs: (action?: string) => rpc<AuditLogRow[]>('admin_get_audit_logs', { p_action: action && action !== 'all' ? action : null, p_limit: 1000 }),
  log: (action: string, details: string) =>
    rpc<void>('admin_log', { p_action: action, p_details: details, p_ip: window.location.hostname }),

  // Admin management
  getAdmins: () => rpc<AdminRow[]>('admin_list_admins'),
  setAdminStatus: (id: string, status: 'active' | 'inactive') => rpc<void>('admin_set_admin_status', { p_admin_id: id, p_status: status }),
  createAdmin: (p: { email: string; password: string; role: string; firstName?: string; lastName?: string }) =>
    callFunction<{ ok: boolean; id: string }>('admin-create', p),

  // Profile
  async uploadAvatar(adminId: string, file: File) {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `public/${adminId}_${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, contentType: file.type })
    if (error) throw error
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    await rpc<void>('admin_update_my_avatar', { p_url: data.publicUrl })
    return data.publicUrl
  },
  updateMyName: (first: string, last: string) => rpc<void>('admin_update_my_name', { p_first: first, p_last: last }),
}

export function isAdminAlert(n: Pick<AdminNotification, 'target_type' | 'category'>) {
  const t = (n.target_type || '').toLowerCase()
  const c = (n.category || '').toLowerCase().replace(/[^a-z]/g, '')
  return t === 'admin' || c === 'adminalert'
}
