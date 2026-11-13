// Creates a new admin. Only an active super admin can call this.
import { EMAIL_RE, corsHeaders, findOrCreateAuthUser, insertAdmin, json, serviceClient } from '../_shared/admin.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const db = serviceClient()

    // Who is calling?
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: caller, error: callerError } = await db.auth.getUser(token)
    if (callerError || !caller.user) return json(req, { error: 'Not signed in' }, 401)

    const { data: callerAdmin } = await db.from('admins').select('id, role, status').eq('user_id', caller.user.id).maybeSingle()
    const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '')
    if (!callerAdmin || norm(callerAdmin.status) !== 'active' || norm(callerAdmin.role) !== 'superadmin') {
      return json(req, { error: 'Only super admins can create admins' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const role = body.role === 'super_admin' ? 'super_admin' : 'admin'
    if (!EMAIL_RE.test(email)) return json(req, { error: 'Enter a valid email address' }, 400)
    if (password.length < 8) return json(req, { error: 'Temporary password must be at least 8 characters' }, 400)

    const { user, existed } = await findOrCreateAuthUser(db, email, password)
    const id = await insertAdmin(db, { userId: user.id, email, role, firstName: body.firstName, lastName: body.lastName })

    await db.from('audit_logs').insert({
      admin_id: callerAdmin.id,
      action: 'admin_management',
      details: `Created ${role} ${email}${existed ? ' (linked existing login, password unchanged)' : ''}`,
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    })

    return json(req, { ok: true, id, existed })
  } catch (e) {
    console.error(e)
    return json(req, { error: e instanceof Error ? e.message : 'Could not create admin' }, 400)
  }
})
