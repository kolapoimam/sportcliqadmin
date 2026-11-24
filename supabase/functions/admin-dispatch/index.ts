// SportCliq Admin: sends notifications by OneSignal push and Resend email,
// and sends admin invite emails. Uses the same secrets as the SportCliq app's
// send-notification function (ONESIGNAL_APP_ID, ONESIGNAL_API_KEY, RESEND_API_KEY, EMAIL_FROM).
//
// Only a signed in admin who passed two factor and has the right permission can call it.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID') ?? ''
const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'SportCliq <hello@sportcliq.com>'
const REPLY_TO = 'sportcliqapp@gmail.com'
const APP_URL = Deno.env.get('FRONTEND_URL') || 'https://app.sportcliq.com'
const ADMIN_URL = Deno.env.get('ADMIN_URL') || 'https://admin.sportcliq.com'
const ALLOWED = (Deno.env.get('ADMIN_ALLOWED_ORIGINS') || 'https://admin.sportcliq.com,http://localhost:5173,http://localhost:4173')
  .split(',').map((s) => s.trim()).filter(Boolean)

function cors(req: Request) {
  const origin = req.headers.get('origin') || ''
  const ok = ALLOWED.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } })

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

function emailShell(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#F4F5F1;font-family:Arial,Helvetica,sans-serif;color:#0E1411">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F1;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB">
<tr><td style="background:#16A34A;padding:22px 28px"><img src="${APP_URL}/icons/icon-192x192.png" width="40" height="40" alt="SportCliq" style="vertical-align:middle;border-radius:10px"> <span style="color:#fff;font-size:20px;font-weight:bold;vertical-align:middle;margin-left:8px">SportCliq</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.6;color:#374151">${bodyHtml}</div>
${cta ? `<p style="margin:24px 0 0"><a href="${cta.url}" style="display:inline-block;background:#16A34A;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">${esc(cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:18px 28px;background:#F9FAFB;font-size:12px;color:#6B7280">Questions? Reply to this email or write to ${REPLY_TO}.</td></tr>
</table></td></tr></table></body></html>`
}

async function onesignal(payload: Record<string, unknown>) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return { ok: false, error: 'OneSignal secrets missing' }
  const scheme = ONESIGNAL_API_KEY.startsWith('os_v2') ? 'Key' : 'Basic'
  const res = await fetch('https://api.onesignal.com/notifications?c=push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `${scheme} ${ONESIGNAL_API_KEY}` },
    body: JSON.stringify({ app_id: ONESIGNAL_APP_ID, target_channel: 'push', chrome_web_icon: `${APP_URL}/icons/icon-192x192.png`, ...payload }),
  })
  const text = await res.text()
  if (!res.ok) console.error('OneSignal error', res.status, text)
  let recipients = 0
  try { recipients = JSON.parse(text)?.recipients ?? 0 } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, recipients, body: text.slice(0, 300) }
}

async function resendBatch(emails: { to: string; subject: string; html: string }[]) {
  if (!RESEND_API_KEY) return { ok: false, sent: 0, error: 'RESEND_API_KEY missing' }
  let sent = 0
  const errors: string[] = []
  for (const group of chunk(emails, 100)) {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(group.map((e) => ({ from: EMAIL_FROM, to: [e.to], reply_to: REPLY_TO, subject: e.subject, html: e.html }))),
    })
    const text = await res.text()
    if (res.ok) sent += group.length
    else { console.error('Resend error', res.status, text); errors.push(`Resend ${res.status}: ${text.slice(0, 160)}`) }
  }
  return { ok: errors.length === 0, sent, error: errors.join(' | ') }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty */ }
  const action = String(body.action || 'notification')

  try {
    // ---------- Admin invite email ----------
    if (action === 'invite') {
      const { data: can } = await asUser.rpc('admin_can', { p_perm: 'admins.invite' })
      if (!can) return json(req, { error: 'Not allowed. Sign in with two factor and the admins.invite permission.' }, 403)
      const email = String(body.email || '')
      const link = String(body.link || '')
      if (!email || !link.startsWith(ADMIN_URL)) return json(req, { error: 'Missing email or invalid link' }, 400)
      const html = emailShell(
        'You have been invited to SportCliq Admin',
        `<p>${esc(body.inviter || 'A SportCliq admin')} invited you to the SportCliq admin portal as <b>${esc(body.role_name || 'an admin')}</b>.</p>
         <p>Accept the invite to set your password or continue with Google. You will also set up an authenticator app for two factor sign in. The link works for 7 days.</p>`,
        { label: 'Accept invite', url: link },
      )
      const r = await resendBatch([{ to: email, subject: 'Your SportCliq Admin invite', html }])
      return json(req, r.ok ? { ok: true } : { error: r.error }, r.ok ? 200 : 502)
    }

    // ---------- Notification delivery ----------
    const { data: can } = await asUser.rpc('admin_can', { p_perm: 'notifications.send' })
    if (!can) return json(req, { error: 'Not allowed. Sign in with two factor and the notifications.send permission.' }, 403)

    const id = String(body.notification_id || '')
    const { data: n, error: nErr } = await db.from('notifications').select('*').eq('id', id).maybeSingle()
    if (nErr || !n) return json(req, { error: 'Notification not found' }, 404)

    const type = norm(n.type)
    const wantPush = type === 'push' || type === 'both' || type === 'inapp'
    const wantEmail = type === 'email' || type === 'both'
    const target = norm(n.target_type)
    const link = n.link ? (String(n.link).startsWith('http') ? n.link : APP_URL + n.link) : APP_URL

    const { data: recipients, error: rErr } = await db.rpc('admin_notification_recipients', { p_id: id })
    if (rErr) throw rErr
    const list = (recipients ?? []) as { user_id: string; email: string | null }[]

    let pushSent = 0
    let emailSent = 0
    const errors: string[] = []

    if (wantPush) {
      if (target === 'all') {
        const r = await onesignal({ included_segments: ['Total Subscriptions'], headings: { en: n.title }, contents: { en: n.message }, url: link })
        if (r.ok) pushSent = r.recipients || list.length
        else errors.push(`Push ${r.status ?? ''} ${r.error ?? r.body ?? ''}`.trim())
      } else {
        for (const ids of chunk(list.map((x) => x.user_id), 2000)) {
          if (!ids.length) continue
          const r = await onesignal({ include_aliases: { external_id: ids }, headings: { en: n.title }, contents: { en: n.message }, url: link })
          if (r.ok) pushSent += r.recipients || ids.length
          else errors.push(`Push ${r.status ?? ''} ${r.error ?? r.body ?? ''}`.trim())
        }
      }
    }

    if (wantEmail) {
      const emails = [...new Set(list.map((x) => (x.email || '').trim().toLowerCase()).filter((e) => /.+@.+\..+/.test(e)))]
      const html = emailShell(n.title, `<p>${esc(n.message).replace(/\n/g, '<br>')}</p>`, { label: 'Open SportCliq', url: link })
      const r = await resendBatch(emails.map((to) => ({ to, subject: n.title, html })))
      emailSent = r.sent
      if (!r.ok) errors.push(r.error || 'Email failed')
    }

    const expected = (wantPush ? 1 : 0) + (wantEmail ? 1 : 0)
    const okParts = (wantPush && pushSent > 0 ? 1 : 0) + (wantEmail && emailSent > 0 ? 1 : 0)
    const status = errors.length === 0 ? 'sent' : okParts === 0 ? 'failed' : okParts < expected ? 'partial' : 'partial'
    await db.rpc('admin_record_delivery', { p_id: id, p_push: pushSent, p_email: emailSent, p_status: status, p_error: errors.join(' | ') })
    return json(req, { ok: errors.length === 0, status, push_sent: pushSent, email_sent: emailSent, recipients: list.length, error: errors.join(' | ') || undefined })
  } catch (e) {
    console.error('admin-dispatch failed', e)
    return json(req, { error: e instanceof Error ? e.message : 'Dispatch failed' }, 500)
  }
})
