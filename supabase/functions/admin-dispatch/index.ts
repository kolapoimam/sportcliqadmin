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
const APP_URL = Deno.env.get('FRONTEND_URL') || 'https://sportcliq.com'
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

// Email layout shared by every SportCliq email. Works in light and dark mode:
// text never sits on a green fill except white button text, the logo mark reads on both
// backgrounds, and dark mode clients get matching dark colours through the style block.
function emailLayout(o: {
  brandUrl: string
  title: string
  bodyHtml: string
  preheader?: string
  cta?: { label: string; url: string }
  details?: [string, string][]
  footerHtml: string
}) {
  const details = o.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="panel" style="margin:22px 0 0;background:#F4F7F5;border-radius:14px">
${o.details.map(([k, v], i) => `<tr><td class="muted" style="padding:${i ? '0' : '14px'} 18px 10px;font-size:13px;color:#5B6660">${esc(k)}</td><td class="text" align="right" style="padding:${i ? '0' : '14px'} 18px 10px;font-size:14px;font-weight:700;color:#0E1411">${esc(v)}</td></tr>`).join('')}
<tr><td colspan="2" style="height:4px;line-height:4px;font-size:4px">&nbsp;</td></tr></table>`
    : ''
  const cta = o.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px"><tr><td class="btn" bgcolor="#15803D" style="border-radius:999px;background:#15803D">
<a href="${o.cta.url}" class="btn-a" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;-webkit-text-fill-color:#FFFFFF">${esc(o.cta.label)}&nbsp;&rarr;</a></td></tr></table>`
    : ''
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(o.title)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0; padding:0; }
  a { color:#15803D; }
  @media (max-width:600px) { .card-pad { padding:26px 22px !important; } .h1 { font-size:22px !important; } }
  @media (prefers-color-scheme: dark) {
    .bg { background:#0B100D !important; }
    .card { background:#141B17 !important; border-color:#243029 !important; }
    .panel { background:#1B2520 !important; }
    .text, .h1, .brand { color:#F2F5F3 !important; }
    .muted { color:#A3AEA7 !important; }
    .rule { border-color:#243029 !important; }
    .foot { background:#101612 !important; border-top-color:#243029 !important; }
    a.link { color:#4ADE80 !important; }
  }
  [data-ogsc] .bg { background:#0B100D !important; }
  [data-ogsc] .card { background:#141B17 !important; border-color:#243029 !important; }
  [data-ogsc] .panel { background:#1B2520 !important; }
  [data-ogsc] .text, [data-ogsc] .h1, [data-ogsc] .brand { color:#F2F5F3 !important; }
  [data-ogsc] .muted { color:#A3AEA7 !important; }
  [data-ogsc] .foot { background:#101612 !important; border-top-color:#243029 !important; }
  [data-ogsc] .btn-a { color:#FFFFFF !important; }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:#F3F5F2;font-family:'Plus Jakarta Sans',Segoe UI,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(o.preheader || o.title)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:#F3F5F2"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 6px 18px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle"><img src="${o.brandUrl}/brand/sportcliq-mark.png" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border-radius:10px;border:0"></td>
    <td class="brand" style="vertical-align:middle;padding-left:10px;font-size:19px;font-weight:800;letter-spacing:-0.3px;color:#0E1411">SportCliq</td>
  </tr></table>
</td></tr>
<tr><td class="card" style="background:#FFFFFF;border:1px solid #E4E8E5;border-radius:22px;overflow:hidden">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="height:5px;line-height:5px;font-size:5px;background:#35B551">&nbsp;</td></tr>
  <tr><td class="card-pad" style="padding:34px 34px 30px">
    <h1 class="h1" style="margin:0 0 14px;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.4px;color:#0E1411">${esc(o.title)}</h1>
    <div class="text" style="font-size:15px;line-height:1.65;color:#2B3530">${o.bodyHtml}</div>
    ${details}
    ${cta}
  </td></tr>
  <tr><td class="foot muted" style="padding:18px 34px 22px;background:#F8FAF8;border-top:1px solid #EDF0EE;font-size:12px;line-height:1.6;color:#69746D">${o.footerHtml}</td></tr>
  </table>
</td></tr>
<tr><td class="muted" align="center" style="padding:18px 6px 0;font-size:11px;line-height:1.6;color:#8A948E">SportCliq &middot; Play, organise and book sports near you</td></tr>
</table>
</td></tr></table>
</body></html>`
}

function emailShell(title: string, bodyHtml: string, cta?: { label: string; url: string }, extra?: { preheader?: string; details?: [string, string][] }) {
  return emailLayout({
    brandUrl: ADMIN_URL, title, bodyHtml, cta, preheader: extra?.preheader, details: extra?.details,
    footerHtml: `Questions? Reply to this email or write to <a class="link" href="mailto:${REPLY_TO}" style="color:#15803D">${REPLY_TO}</a>.`,
  })
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
  let id = ''
  try { const j = JSON.parse(text); recipients = j?.recipients ?? 0; id = j?.id ?? '' } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, recipients, id, body: text.slice(0, 300) }
}

// Delivery numbers OneSignal keeps for a sent push
async function onesignalStats(ids: string[]) {
  const scheme = ONESIGNAL_API_KEY.startsWith('os_v2') ? 'Key' : 'Basic'
  const total: Record<string, number> = { successful: 0, failed: 0, errored: 0, converted: 0, received: 0, remaining: 0 }
  for (const id of ids) {
    const res = await fetch(`https://api.onesignal.com/notifications/${encodeURIComponent(id)}?app_id=${ONESIGNAL_APP_ID}`, {
      headers: { Authorization: `${scheme} ${ONESIGNAL_API_KEY}` },
    })
    if (!res.ok) { console.error('OneSignal stats error', res.status, await res.text()); continue }
    const j = await res.json()
    for (const k of Object.keys(total)) total[k] += Number(j?.[k] ?? 0) || 0
  }
  return total
}

async function resendOne(e: { to: string; subject: string; html: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [e.to], reply_to: REPLY_TO, subject: e.subject, html: e.html }),
  })
  const text = await res.text()
  if (!res.ok) console.error('Resend error', e.to, res.status, text)
  return { ok: res.ok, status: res.status, text }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Sends in batches of 100. If a batch is refused, each email in it is tried on its own,
// so one bad address cannot stop everyone else's email.
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
    if (res.ok) { sent += group.length; await pause(600); continue }
    console.error('Resend batch error', res.status, text)
    let firstError = ''
    for (const e of group) {
      await pause(600)
      const r = await resendOne(e)
      if (r.ok) sent++
      else if (!firstError) firstError = `Resend ${r.status} for ${e.to}: ${r.text.slice(0, 160)}`
    }
    if (firstError) errors.push(firstError)
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

    // ---------- Push performance refresh ----------
    if (action === 'stats') {
      const { data: canView } = await asUser.rpc('admin_can', { p_perm: 'notifications.view' })
      if (!canView) return json(req, { error: 'Not allowed' }, 403)
      const nid = String(body.notification_id || '')
      const { data: row } = await db.from('notifications').select('id, onesignal_id').eq('id', nid).maybeSingle()
      if (!row?.onesignal_id) return json(req, { ok: true, stats: null })
      if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return json(req, { error: 'OneSignal secrets missing' }, 500)
      const stats = await onesignalStats(String(row.onesignal_id).split(',').filter(Boolean))
      await db.rpc('admin_record_push_stats', { p_id: nid, p_onesignal_id: null, p_stats: stats })
      return json(req, { ok: true, stats })
    }

    // ---------- Notification delivery ----------
    const { data: can } = await asUser.rpc('admin_can', { p_perm: 'notifications.send' })
    if (!can) return json(req, { error: 'Not allowed. Sign in with two factor and the notifications.send permission.' }, 403)

    const id = String(body.notification_id || '')
    const { data: n, error: nErr } = await db.from('notifications').select('*').eq('id', id).maybeSingle()
    if (nErr || !n) return json(req, { error: 'Notification not found' }, 404)

    const type = norm(n.channel || n.type)
    const wantPush = type === 'push' || type === 'both' || type === 'inapp'
    const wantEmail = type === 'email' || type === 'both'
    const target = norm(n.audience || n.target_type)
    const link = n.link ? (String(n.link).startsWith('http') ? n.link : APP_URL + n.link) : APP_URL

    const { data: recipients, error: rErr } = await db.rpc('admin_notification_recipients', { p_id: id })
    if (rErr) throw rErr
    const list = (recipients ?? []) as { user_id: string; email: string | null }[]

    let pushSent = 0
    let emailSent = 0
    const pushIds: string[] = []
    const image = n.image_url && String(n.image_url).startsWith('https://') ? String(n.image_url) : undefined
    const pushBody = {
      headings: { en: n.title }, contents: { en: n.message }, url: link,
      data: { notification_id: id, link, source: 'sportcliq_admin' },
      ...(image ? { chrome_web_image: image, big_picture: image, ios_attachments: { id1: image } } : {}),
    }
    const errors: string[] = []

    if (wantPush) {
      if (target === 'all') {
        const r = await onesignal({ included_segments: ['Total Subscriptions'], ...pushBody })
        if (r.ok) { pushSent = r.recipients || list.length; if (r.id) pushIds.push(r.id) }
        else errors.push(`Push ${r.status ?? ''} ${r.error ?? r.body ?? ''}`.trim())
      } else {
        for (const ids of chunk(list.map((x) => x.user_id), 2000)) {
          if (!ids.length) continue
          const r = await onesignal({ include_aliases: { external_id: ids }, ...pushBody })
          if (r.ok) { pushSent += r.recipients || ids.length; if (r.id) pushIds.push(r.id) }
          else errors.push(`Push ${r.status ?? ''} ${r.error ?? r.body ?? ''}`.trim())
        }
      }
    }

    if (wantEmail) {
      const emails = [...new Set(list.map((x) => (x.email || '').trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))]
      if (!emails.length) errors.push(`No email address found for the ${list.length} people in this audience`)
      const html = emailShell(n.title || 'SportCliq update', `<p style="margin:0">${esc(n.message).replace(/\n/g, '<br>')}</p>`, { label: 'Open SportCliq', url: link }, { preheader: n.message })
      const r = emails.length ? await resendBatch(emails.map((to) => ({ to, subject: n.title || 'SportCliq update', html }))) : { ok: true, sent: 0, error: '' }
      emailSent = r.sent
      if (!r.ok) errors.push(r.error || 'Email failed')
    }

    const expected = (wantPush ? 1 : 0) + (wantEmail ? 1 : 0)
    const okParts = (wantPush && pushSent > 0 ? 1 : 0) + (wantEmail && emailSent > 0 ? 1 : 0)
    const status = errors.length === 0 ? 'sent' : okParts === 0 ? 'failed' : okParts < expected ? 'partial' : 'partial'
    await db.rpc('admin_record_delivery', { p_id: id, p_push: pushSent, p_email: emailSent, p_status: status, p_error: errors.join(' | ') })
    if (pushIds.length) await db.rpc('admin_record_push_stats', { p_id: id, p_onesignal_id: pushIds.join(','), p_stats: null })
    return json(req, { ok: errors.length === 0, status, push_sent: pushSent, email_sent: emailSent, recipients: list.length, error: errors.join(' | ') || undefined })
  } catch (e) {
    console.error('admin-dispatch failed', e)
    return json(req, { error: e instanceof Error ? e.message : 'Dispatch failed' }, 500)
  }
})
