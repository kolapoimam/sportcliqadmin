import { createClient } from '@supabase/supabase-js'
import { supabase, SITE_URL, MAIN_APP_URL } from './supabase'
import { setAdminSession, clearAdminSession, sessionFromRecord, type AdminSession } from './session'

// ---------- Types ----------

export interface Metrics {
  total_commission?: number
  active_ambassadors?: number
  total_users: number
  total_events: number
  pending_cashouts: number
  total_revenue: number
  active_venues: number
}

export interface Dashboard {
  revenue_30d: number
  commission_30d: number
  new_users_7d: number
  events_upcoming: number
  pending_venues: number
  revenue_daily: { day: string; amount: number }[]
  signups_daily: { day: string; count: number }[]
  recent_activity: { id: string; action: string; details: string | null; created_at: string; admin_email: string | null }[]
}

export interface CommissionRules {
  organizer: { free_count: number; rate: number }
  venue: { free_count: number; rate: number }
  ambassador: { rate: number }
}

export interface RoleRow {
  id: string
  key: string
  name: string
  description: string | null
  permissions: string[]
  is_system: boolean
  members: number
  created_at: string
}
export interface PermissionModule { module: string; label: string; actions: string[] }

export interface InviteRow { id: string; email: string; first_name: string | null; last_name: string | null; role_name: string | null; status: string; expires_at: string; created_at: string; invited_by: string | null }
export interface InviteInfo { email: string; first_name: string | null; last_name: string | null; role_name: string | null; expires_at: string; invited_by: string | null; status: string }

export interface AmbassadorRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: 'active' | 'paused' | 'exited'
  commission_rate: number | null
  onboarded_at: string
  bank_name: string | null
  account_number: string | null
  account_name: string | null
  notes: string | null
  venues: number
  events: number
  revenue: number
  commission: number
  earned: number
  earned_30d: number
  paid: number
  pending: number
  balance: number
  last_paid: string | null
}
export interface AmbassadorAssignment {
  id: string
  entity_type: 'venue' | 'match' | 'cycling'
  entity_id: string
  active: boolean
  assigned_at: string
  effective_from: string
  unassigned_at: string | null
  assigned_by: string | null
  name: string
  subtitle: string | null
  revenue: number
  commission: number
  earning: number
}
export interface AmbassadorPayout {
  id: string
  amount: number
  status: 'pending' | 'paid' | 'cancelled'
  method: string
  reference: string | null
  note: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  paid_at: string | null
  created_by: string | null
  paid_by: string | null
  cancel_reason: string | null
}
export interface AmbassadorDetail {
  assignments: AmbassadorAssignment[]
  payouts: AmbassadorPayout[]
  monthly: { month: string; earning: number; revenue: number }[]
  ledger: { assignment_id: string; entity_type: string; entity_id: string; at: string; revenue: number; commission: number; rate: number; earning: number }[]
}
export interface AssignableRow { id: string; name: string; subtitle: string | null; current: string | null }

export interface AuditPage {
  total: number
  rows: AuditLogRow[]
  actions: string[]
  entities: string[]
  admins: { id: string; email: string }[]
}

export interface Settings {
  commission_rules?: CommissionRules
  commission_rates?: { match: number; cycling: number; venue: number }
  platform?: { cashout_min?: number; currency?: string }
  setup_secret_set?: boolean
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
  push_sent?: number | null
  email_sent?: number | null
  delivery_error?: string | null
  image_url?: string | null
  onesignal_id?: string | null
  push_stats?: PushStats | null
  stats_synced_at?: string | null
  delivered_at?: string | null
}

export interface PushStats { successful?: number; failed?: number; errored?: number; converted?: number; received?: number; remaining?: number }
export interface NotificationPerformance {
  id: string; recipients: number; push_sent: number; email_sent: number; status: string | null; delivered_at: string | null; delivery_error: string | null
  onesignal_id: string | null; push_stats: PushStats; stats_synced_at: string | null
  inapp_views: number; inapp_opens: number; inapp_clicks: number
  timeline: { hour: string; opens: number; clicks: number }[]
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
  phone: string | null
  email: string | null
  description: string | null
  facilities: string | null
  opening_hours: string | null
  aggregated_rating: number | null
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
  role_id: string | null
  role_name: string | null
  role_key: string | null
  mfa_enabled: boolean
  providers: string[]
  avatar_url: string | null
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
  admin_name?: string | null
  action: string
  details: string | null
  ip_address: string | null
  user_agent?: string | null
  entity_type?: string | null
  entity_id?: string | null
  metadata?: { operation?: string; changes?: Record<string, { from: unknown; to: unknown }> } & Record<string, unknown> | null
  aal?: string | null
  auth_method?: string | null
  created_at: string
}

export interface AnalyticsTx { at: string; kind: 'match' | 'cycling' | 'venue'; title: string; sport: string; city: string; amount: number; rate: number; commission: number }
export interface AnalyticsFilters { stream: string; sport: string; city: string }

export interface Analytics {
  commission_rules?: CommissionRules
  free_activities?: number
  period_unit: 'day' | 'week' | 'month'
  metrics: { total_users: number; new_users: number; total_events: number; total_revenue: number; active_venues: number; total_commission?: number; transactions?: number; avg_ticket?: number }
  options?: { sports: string[]; cities: string[] }
  top_cities?: { city: string; revenue: number; count: number }[]
  transactions_list?: AnalyticsTx[]
  revenue: { match: number; cycling: number; venue: number }
  commission: { match: number; cycling: number; venue: number }
  commission_rates: { match: number; cycling: number; venue: number }
  user_growth: { period: string; count: number }[]
  revenue_trend: { period: string; match: number | null; cycling: number | null; venue: number | null; commission?: number }[]
  event_trend: { period: string; count: number }[]
  top_sports: { sport: string; count: number }[]
  top_venues: { id: string; name: string; city: string; events: number; revenue: number }[]
}

// ---------- Helpers ----------

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    if (error.message?.startsWith('MFA_REQUIRED') && !window.location.pathname.startsWith('/mfa')) {
      window.location.assign('/mfa')
    }
    throw error
  }
  return data as T
}

/** Calls the admin-dispatch edge function (push, email, invite emails). */
async function dispatch<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-dispatch', { body })
  if (error) {
    let message = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json()
        if (j?.error) message = j.error
      }
    } catch {
      /* keep message */
    }
    throw new Error(/Failed to send a request|FunctionsFetchError|not found/i.test(message) ? 'The admin-dispatch function is not deployed yet. Run the "Deploy admin Supabase functions" GitHub Action.' : message)
  }
  return data as T
}

/**
 * Creates a Supabase Auth login without touching the current admin's own session.
 * "Already registered" is fine: the database step links the existing login.
 */
/** Letters only, as the app's profile table expects */
const nameOrDefault = (v: string | undefined, fallback: string) => {
  const clean = (v || '').replace(/[^a-zA-Z]/g, '')
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : fallback
}

async function signUpLogin(email: string, password: string, firstName?: string, lastName?: string) {
  const url = import.meta.env.VITE_SUPABASE_URL as string
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const temp = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sportcliq-admin-temp' } })
  const first_name = nameOrDefault(firstName, nameOrDefault(email.split('@')[0], 'Admin'))
  const last_name = nameOrDefault(lastName, 'Admin')
  const { error } = await temp.auth.signUp({
    email, password,
    options: { emailRedirectTo: `${SITE_URL}/login`, data: { first_name, last_name, full_name: `${first_name} ${last_name}` } },
  })
  if (error && !/already|registered|exists/i.test(error.message)) {
    console.warn('Sign up step returned', error.message)
  }
}

// ---------- Operations ----------

export const adminOperations = {
  // Auth
  /** Password sign in. Two factor comes next on the /mfa page. */
  async login(email: string, password: string): Promise<AdminSession> {
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) throw authError
    const session = await this.checkAdmin()
    await rpc('admin_log_event', { p_action: 'login_password', p_details: `Password sign in by ${session.email}` }).catch(() => undefined)
    return session
  },

  async loginWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${SITE_URL}/auth/callback`, queryParams: { prompt: 'select_account' } },
    })
    if (error) throw error
  },

  /** Confirms the signed in user is an active admin. Signs out if not. */
  async checkAdmin(): Promise<AdminSession> {
    const record = await rpc<Record<string, unknown> | null>('admin_get_session').catch(async (e) => {
      await supabase.auth.signOut()
      throw e
    })
    if (!record) {
      await supabase.auth.signOut()
      throw new Error('This account does not have admin access.')
    }
    const session = sessionFromRecord(record)
    setAdminSession(session)
    return session
  },

  logEvent: (action: string, details?: string, entityType?: string, entityId?: string, metadata?: Record<string, unknown>) =>
    rpc<void>('admin_log_event', { p_action: action, p_details: details ?? null, p_entity_type: entityType ?? null, p_entity_id: entityId ?? null, p_metadata: metadata ?? null }),

  async logout() {
    await rpc('admin_log_event', { p_action: 'logout', p_details: 'Signed out' }).catch(() => undefined)
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
    const session = sessionFromRecord(record)
    setAdminSession(session)
    return session
  },

  setupStatus: () => rpc<{ available: boolean; secret_set: boolean; legacy_admins: number }>('admin_setup_status'),

  async createFirstAdmin(p: { email: string; password: string; secretKey: string; firstName?: string; lastName?: string }) {
    await signUpLogin(p.email, p.password, p.firstName, p.lastName)
    const res = await rpc<{ ok: boolean; error?: string }>('admin_bootstrap_super_admin', {
      p_email: p.email,
      p_password: p.password,
      p_secret: p.secretKey,
      p_first: p.firstName || null,
      p_last: p.lastName || null,
    })
    if (!res?.ok) throw new Error(res?.error || 'Setup failed')
    return res
  },

  sendPasswordReset: (email: string, forAdmin = true) =>
    supabase.auth
      .resetPasswordForEmail(email, { redirectTo: forAdmin ? `${SITE_URL}/reset-password` : MAIN_APP_URL })
      .then(({ error }) => {
        if (error) throw error
      }),

  // Dashboard and analytics
  getMetrics: () => rpc<Metrics>('admin_get_metrics'),
  getDashboard: () => rpc<Dashboard>('admin_get_dashboard'),
  getAnalytics: (start: string, end: string) => rpc<Analytics>('admin_get_analytics', { p_start: start, p_end: end }),
  /** Filtered analytics. Falls back to the older function until the v4 SQL has been run. */
  async getAnalyticsFiltered(start: string, end: string, f: AnalyticsFilters): Promise<Analytics> {
    const opt = (v: string) => (v && v !== 'all' ? v : null)
    try {
      return await rpc<Analytics>('admin_get_analytics_v2', { p_start: start, p_end: end, p_stream: opt(f.stream), p_sport: opt(f.sport), p_city: opt(f.city) })
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? '')
      if (!/admin_get_analytics_v2|PGRST202|Could not find the function/i.test(msg)) throw e
      return rpc<Analytics>('admin_get_analytics', { p_start: start, p_end: end })
    }
  },
  getSettings: () => rpc<Settings>('admin_get_settings'),
  setCommissionRules: (rules: CommissionRules) => rpc<void>('admin_set_commission_rules', { p_rules: rules }),

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
  updateUser: (userId: string, data: Record<string, string>) => rpc<void>('admin_update_user', { p_user_id: userId, p_data: data }),
  performCustomAction: (userId: string, action: string, targetTable: string) =>
    rpc<void>('admin_user_action', { p_user_id: userId, p_action: action, p_target_table: targetTable }),

  // Events
  getEvents: (f: { search?: string; status: string; sport: string; start: string | null; end: string | null }) =>
    rpc<EventRow[]>('admin_get_events', { p_search: f.search || null, p_status: f.status, p_sport: f.sport, p_start: f.start, p_end: f.end }),
  updateEvent: (type: string, id: string, title: string, date: string | null) =>
    rpc<void>('admin_update_event', { p_event_type: type, p_id: id, p_title: title, p_date: date }),
  editEvent: (type: string, id: string, data: Record<string, string>) => rpc<void>('admin_edit_event', { p_event_type: type, p_id: id, p_data: data }),
  updateEventStatus: (type: string, id: string, status: string) =>
    rpc<void>('admin_set_event_status', { p_event_type: type, p_id: id, p_status: status }),
  deleteEvent: (type: string, id: string) => rpc<void>('admin_delete_event', { p_event_type: type, p_id: id }),

  // Cashouts
  getCashouts: (status: string, start: string | null, end: string | null) =>
    rpc<CashoutRow[]>('admin_get_cashouts', { p_status: status, p_start: start, p_end: end }),
  updateCashoutStatus: (source: string, id: string, status: 'approved' | 'rejected', reason?: string, reference?: string) =>
    rpc<void>('admin_update_cashout_status', { p_source: source, p_id: id, p_status: status, p_reason: reason ?? null, p_reference: reference ?? null }),

  // Venues
  getVenues: () => rpc<VenueRow[]>('admin_get_venues'),
  getVenueBookings: (venueId: string) => rpc<VenueBooking[]>('admin_get_venue_bookings', { p_venue_id: venueId }),
  toggleVenueStatus: (id: string, status: 'pending' | 'verified' | 'rejected', reason?: string) =>
    rpc<void>('admin_set_venue_status', { p_id: id, p_status: status, p_reason: reason ?? null }),
  deleteVenue: (id: string) => rpc<void>('admin_delete_venue', { p_id: id }),
  saveVenue: (id: string | null, data: Record<string, string>) => rpc<string>('admin_save_venue', { p_id: id, p_data: data }),

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
  dispatchNotification: (id: string) =>
    dispatch<{ ok: boolean; status: string; push_sent: number; email_sent: number; recipients: number; error?: string }>({ action: 'notification', notification_id: id }),
  markAllAlertsRead: () => rpc<void>('admin_mark_all_alerts_read'),
  deleteNotification: (id: string) => rpc<void>('admin_delete_notification', { p_id: id }),
  async sendNotification(p: { type: string; target: string; targetId: string | null; title: string; message: string; link?: string; image?: string }) {
    const base = { p_type: p.type, p_target: p.target, p_target_id: p.targetId, p_title: p.title, p_message: p.message }
    try {
      return await rpc<AdminNotification>('admin_send_notification_v2', { ...base, p_link: p.link || null, p_image: p.image || null })
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? '')
      if (!/admin_send_notification_v2|PGRST202|Could not find the function/i.test(msg)) throw e
      return rpc<AdminNotification>('admin_send_notification', base)
    }
  },
  cashoutReceipt: (source: string, id: string) =>
    rpc<{ payout_reference: string | null; payout_method: string | null; reviewed_at: string | null; reviewed_by: string | null; reviewer_email: string | null; status: string }>('admin_cashout_receipt', { p_source: source, p_id: id }),
  notificationPerformance: (id: string) => rpc<NotificationPerformance>('admin_notification_performance', { p_id: id }),
  notificationSummary: (ids: string[]) =>
    rpc<Record<string, { push_stats: PushStats; views: number; opens: number; clicks: number }>>('admin_notification_summary', { p_ids: ids }),
  refreshPushStats: (id: string) => dispatch<{ ok: boolean; stats: PushStats | null }>({ action: 'stats', notification_id: id }),

  // Audit
  getAuditLogs: (f: { action?: string; admin?: string; entity?: string; start?: string | null; end?: string | null; search?: string; includeViews?: boolean; limit: number; offset: number }) =>
    rpc<AuditPage>('admin_get_audit_logs_v2', {
      p_action: f.action && f.action !== 'all' ? f.action : null,
      p_admin: f.admin && f.admin !== 'all' ? f.admin : null,
      p_entity_type: f.entity && f.entity !== 'all' ? f.entity : null,
      p_start: f.start ?? null, p_end: f.end ?? null, p_search: f.search || null,
      p_include_views: Boolean(f.includeViews), p_limit: f.limit, p_offset: f.offset,
    }),
  log: (action: string, details: string) =>
    rpc<void>('admin_log', { p_action: action, p_details: details, p_ip: window.location.hostname }),

  // Admin management
  getAdmins: () => rpc<AdminRow[]>('admin_list_admins'),
  setAdminStatus: (id: string, status: 'active' | 'inactive') => rpc<void>('admin_set_admin_status', { p_admin_id: id, p_status: status }),
  async createAdmin(p: { email: string; password: string; role: string; firstName?: string; lastName?: string }) {
    await signUpLogin(p.email, p.password, p.firstName, p.lastName)
    return rpc<{ ok: boolean; id: string; existed: boolean }>('admin_create_admin', {
      p_email: p.email,
      p_role: p.role,
      p_first: p.firstName || null,
      p_last: p.lastName || null,
    })
  },
  assignRole: (adminId: string, roleId: string) => rpc<void>('admin_assign_role', { p_admin_id: adminId, p_role_id: roleId }),
  resetAdminMfa: (adminId: string) => rpc<void>('admin_reset_admin_mfa', { p_admin_id: adminId }),

  // Roles
  listRoles: () => rpc<{ roles: RoleRow[]; catalog: PermissionModule[] }>('admin_list_roles'),
  saveRole: (id: string | null, name: string, description: string, permissions: string[]) =>
    rpc<string>('admin_save_role', { p_id: id, p_name: name, p_description: description, p_permissions: permissions }),
  deleteRole: (id: string) => rpc<void>('admin_delete_role', { p_id: id }),

  // Invites
  createInvite: (email: string, roleId: string, firstName?: string, lastName?: string) =>
    rpc<{ id: string; token: string; email: string; role_name: string; expires_at: string }>('admin_create_invite', { p_email: email, p_role_id: roleId, p_first: firstName || null, p_last: lastName || null }),
  emailInvite: (p: { email: string; link: string; role_name: string; inviter: string }) => dispatch<{ ok: boolean }>({ action: 'invite', ...p }),
  listInvites: () => rpc<InviteRow[]>('admin_list_invites'),
  revokeInvite: (id: string) => rpc<void>('admin_revoke_invite', { p_id: id }),
  inviteInfo: (token: string) => rpc<InviteInfo | null>('admin_invite_info', { p_token: token }),
  async acceptInvite(token: string, email: string, password: string, firstName: string, lastName: string) {
    await signUpLogin(email, password, firstName, lastName)
    const res = await rpc<{ ok: boolean; error?: string }>('admin_accept_invite', { p_token: token, p_password: password, p_first: firstName || null, p_last: lastName || null })
    if (!res?.ok) throw new Error(res?.error || 'Could not accept the invite')
    return res
  },
  async acceptInviteOAuth(token: string) {
    const res = await rpc<{ ok: boolean; error?: string }>('admin_accept_invite_oauth', { p_token: token })
    if (!res?.ok) throw new Error(res?.error || 'Could not accept the invite')
    return res
  },

  // Ambassadors
  getAmbassadors: () => rpc<AmbassadorRow[]>('admin_get_ambassadors'),
  getAmbassador: (id: string) => rpc<AmbassadorDetail>('admin_get_ambassador', { p_id: id }),
  saveAmbassador: (id: string | null, data: Record<string, string>) => rpc<string>('admin_save_ambassador', { p_id: id, p_data: data }),
  setAmbassadorStatus: (id: string, status: string) => rpc<void>('admin_set_ambassador_status', { p_id: id, p_status: status }),
  deleteAmbassador: (id: string) => rpc<void>('admin_delete_ambassador', { p_id: id }),
  assignToAmbassador: (ambassadorId: string, type: string, entityId: string, effectiveFrom?: string | null) =>
    rpc<string>('admin_assign_to_ambassador', { p_ambassador: ambassadorId, p_entity_type: type, p_entity_id: entityId, p_effective_from: effectiveFrom ?? null }),
  unassign: (assignmentId: string) => rpc<void>('admin_unassign_from_ambassador', { p_assignment: assignmentId }),
  searchAssignable: (type: string, q: string) => rpc<AssignableRow[]>('admin_search_assignable', { p_type: type, p_query: q || null }),
  createAmbassadorPayout: (id: string, amount: number, note?: string, start?: string | null, end?: string | null) =>
    rpc<string>('admin_create_ambassador_payout', { p_ambassador: id, p_amount: amount, p_note: note ?? null, p_start: start || null, p_end: end || null }),
  markAmbassadorPayoutPaid: (payoutId: string, reference: string) => rpc<void>('admin_mark_ambassador_payout_paid', { p_payout: payoutId, p_reference: reference }),
  cancelAmbassadorPayout: (payoutId: string, reason: string) => rpc<void>('admin_cancel_ambassador_payout', { p_payout: payoutId, p_reason: reason }),

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
