// Shared helpers for the admin portal edge functions.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = (Deno.env.get('ADMIN_ALLOWED_ORIGINS') ?? 'https://admin.sportcliq.com,http://localhost:5173')
  .split(',')
  .map((o) => o.trim())

export function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export async function enumLabel(db: SupabaseClient, column: string, wanted: string) {
  const { data, error } = await db.rpc('admin_enum_label', { p_table: 'admins', p_column: column, p_candidates: [wanted] })
  if (error) throw error
  return data as string
}

/** Finds an existing auth user by email, or creates one with the given password. */
export async function findOrCreateAuthUser(db: SupabaseClient, email: string, password: string) {
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (!created.error && created.data.user) return { user: created.data.user, existed: false }

  // Already registered (for example they also use the main Sport Cliq app). Link that account.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase())
    if (match) return { user: match, existed: true }
    if (data.users.length < 1000) break
  }
  throw created.error ?? new Error('Could not create the login for this admin')
}

export async function insertAdmin(
  db: SupabaseClient,
  p: { userId: string; email: string; role: 'admin' | 'super_admin'; firstName?: string; lastName?: string },
) {
  const [{ data: byUser }, { data: byEmail }] = await Promise.all([
    db.from('admins').select('id').eq('user_id', p.userId).limit(1),
    db.from('admins').select('id').ilike('email', p.email).limit(1),
  ])
  if (byUser?.length || byEmail?.length) throw new Error('An admin with this email already exists')

  const [role, status] = await Promise.all([enumLabel(db, 'role', p.role), enumLabel(db, 'status', 'active')])
  const { data, error } = await db
    .from('admins')
    .insert({
      id: p.userId,
      user_id: p.userId,
      email: p.email,
      // Passwords live in Supabase Auth. This column is NOT NULL in the existing schema.
      password_hash: 'managed_by_supabase_auth',
      role,
      status,
      first_name: p.firstName || null,
      last_name: p.lastName || null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}
