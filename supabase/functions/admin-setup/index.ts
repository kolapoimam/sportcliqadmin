// Creates the very first super admin. Works only while the admins table is empty
// and only with the ADMIN_SETUP_SECRET set in the function's secrets.
import { EMAIL_RE, corsHeaders, findOrCreateAuthUser, insertAdmin, json, serviceClient } from '../_shared/admin.ts'

function safeEqual(a: string, b: string) {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const secret = Deno.env.get('ADMIN_SETUP_SECRET')
    if (!secret || secret.length < 16) return json(req, { error: 'Setup is not configured on the server' }, 500)

    const body = await req.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (!safeEqual(String(body.secretKey ?? ''), secret)) return json(req, { error: 'Invalid secret key' }, 403)
    if (!EMAIL_RE.test(email)) return json(req, { error: 'Enter a valid email address' }, 400)
    if (password.length < 8) return json(req, { error: 'Password must be at least 8 characters' }, 400)

    const db = serviceClient()
    const { count, error: countError } = await db.from('admins').select('id', { count: 'exact', head: true })
    if (countError) throw countError
    if ((count ?? 0) > 0) return json(req, { error: 'The admin setup has already been completed.' }, 409)

    const { user, existed } = await findOrCreateAuthUser(db, email, password)
    if (existed) {
      // Make sure the password they just typed is what they will sign in with
      await db.auth.admin.updateUserById(user.id, { password })
    }
    const id = await insertAdmin(db, { userId: user.id, email, role: 'super_admin' })
    await db.from('audit_logs').insert({ admin_id: id, action: 'admin_management', details: `First super admin ${email} created via setup` })

    return json(req, { ok: true })
  } catch (e) {
    console.error(e)
    return json(req, { error: e instanceof Error ? e.message : 'Setup failed' }, 400)
  }
})
