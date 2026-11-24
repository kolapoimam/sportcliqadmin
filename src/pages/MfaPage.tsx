import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Copy, KeyRound, LogOut, ScanLine, ShieldCheck, Smartphone } from 'lucide-react'
import { AuthShell } from '@/components/AuthShell'
import { Splash } from '@/components/RequireAdmin'
import { Button } from '@/components/ui/button'
import { CodeInput } from '@/components/ui/input'
import { Alert, useConfirm, useToast } from '@/components/ui/feedback'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'
import { adminOperations } from '@/lib/adminOperations'
import { MFA_NAME, assurance, startEnrollment, verifiedTotp, verifyCode } from '@/lib/mfa'
import { errorMessage } from '@/lib/utils'

/** Supabase returns the QR as raw SVG text in a data URI. Encoding it makes every browser show it. */
function qrSrc(qr: string) {
  const m = qr.match(/^data:image\/svg\+xml;(?:utf-?8,|charset=utf-?8,)(.*)$/is)
  return m && !m[1].startsWith('%3C') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(m[1])}` : qr
}

type Mode = { kind: 'loading' } | { kind: 'challenge'; factorId: string } | { kind: 'enroll'; factorId: string; qr: string; secret: string } | { kind: 'error'; message: string }

export default function MfaPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const confirm = useConfirm()
  const toast = useToast()
  const [mode, setMode] = useState<Mode>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')

  const from = (location.state as { from?: string } | null)?.from || sessionStorage.getItem('authFrom') || '/'

  const finish = useCallback(async (enrolled: boolean) => {
    await adminOperations.checkAdmin()
    await adminOperations.logEvent(enrolled ? 'mfa_enrolled' : 'mfa_verified', enrolled ? 'Set up the SportCliq Admin authenticator' : 'Passed two factor sign in').catch(() => undefined)
    sessionStorage.removeItem('authFrom')
    navigate(from === '/mfa' ? '/' : from, { replace: true })
  }, [from, navigate])

  const load = useCallback(async () => {
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) return navigate('/login', { replace: true })
      const admin = await adminOperations.checkAdmin()
      setEmail(admin.email)
      const level = await assurance()
      if (level.currentLevel === 'aal2') return finish(false)
      const factor = await verifiedTotp()
      if (factor) return setMode({ kind: 'challenge', factorId: factor.id })
      const enrol = await startEnrollment()
      setMode({ kind: 'enroll', factorId: enrol.id, qr: enrol.totp.qr_code, secret: enrol.totp.secret })
    } catch (e) {
      const msg = errorMessage(e)
      setMode({ kind: 'error', message: /mfa|factor/i.test(msg) && /disabled|not enabled/i.test(msg) ? 'Authenticator app sign in is switched off in Supabase. Turn on TOTP under Authentication, Multi Factor.' : msg })
    }
  }, [finish, navigate])

  useEffect(() => {
    load()
  }, [load])

  const submit = async (c: string) => {
    if (mode.kind !== 'challenge' && mode.kind !== 'enroll') return
    if (c.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      await verifyCode(mode.factorId, c)
      await finish(mode.kind === 'enroll')
    } catch (e) {
      setCode('')
      setError(/invalid/i.test(errorMessage(e)) ? 'That code is wrong or expired. Wait for the next one and try again.' : errorMessage(e))
      adminOperations.logEvent('mfa_failed', 'Wrong authenticator code entered').catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    const { ok } = await confirm({ title: 'Sign out?', description: 'You will need your password and authenticator code to sign in again.', confirmText: 'Sign out', tone: 'danger', icon: <LogOut /> })
    if (!ok) return
    await adminOperations.logout()
    navigate('/login', { replace: true })
  }

  if (mode.kind === 'loading') return <Splash text="Checking two factor" />

  return (
    <AuthShell>
      <Card className="p-7 sm:p-8">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-playarena-50 text-primary dark:bg-playarena-950"><ShieldCheck className="h-6 w-6" /></span>
        {mode.kind === 'error' ? (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight">Two factor sign in</h1>
            <Alert className="mt-5">{mode.message}</Alert>
            <Button className="mt-4 w-full" variant="outline" onClick={() => { setMode({ kind: 'loading' }); load() }}>Try again</Button>
          </>
        ) : mode.kind === 'challenge' ? (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight">Enter your code</h1>
            <p className="mt-1 text-sm text-muted-foreground">Open Google Authenticator and enter the 6 digit code for <b>{MFA_NAME}</b>{email ? ` (${email})` : ''}.</p>
            <div className="mt-6"><CodeInput value={code} onChange={setCode} onComplete={submit} disabled={busy} /></div>
            {error ? <Alert className="mt-4">{error}</Alert> : null}
            <Button size="lg" className="mt-5 w-full" onClick={() => submit(code)} loading={busy} disabled={code.length !== 6}>Verify</Button>
            <p className="mt-4 text-center text-xs text-muted-foreground">Lost your phone? Ask a super admin to reset your two factor.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight">Set up two factor</h1>
            <p className="mt-1 text-sm text-muted-foreground">Two factor is required for every SportCliq admin. It takes a minute.</p>
            <ol className="mt-5 space-y-3 text-sm">
              <li className="flex gap-3"><span className="rounded-xl bg-muted p-2"><Smartphone className="h-4 w-4" /></span><span>Install <b>Google Authenticator</b> on your phone.</span></li>
              <li className="flex gap-3"><span className="rounded-xl bg-muted p-2"><ScanLine className="h-4 w-4" /></span><span>Tap the plus button and scan this code. It shows up as <b>{MFA_NAME}</b>.</span></li>
            </ol>
            <div className="mt-4 flex flex-col items-center gap-3 rounded-3xl bg-white p-4 ring-1 ring-black/5">
              <img src={qrSrc(mode.qr)} alt="QR code for your authenticator app" className="h-48 w-48" />
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-2xl bg-muted px-3 py-2">
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 truncate font-mono text-xs font-bold">{mode.secret}</code>
              <button type="button" aria-label="Copy setup key" onClick={() => navigator.clipboard?.writeText(mode.secret).then(() => toast.info('Setup key copied'))} className="cursor-pointer rounded-lg p-1.5 hover:bg-background"><Copy className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Cannot scan? Choose "Enter a setup key" in the app and paste this key.</p>
            <p className="mb-2 mt-5 text-sm font-semibold">Enter the 6 digit code the app shows</p>
            <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={busy} autoFocus={false} />
            {error ? <Alert className="mt-4">{error}</Alert> : null}
            <Button size="lg" className="mt-5 w-full" onClick={() => submit(code)} loading={busy} disabled={code.length !== 6}>Turn on two factor</Button>
          </>
        )}
        <button type="button" onClick={signOut} className="mx-auto mt-5 flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"><LogOut className="h-4 w-4" /> Sign out</button>
      </Card>
    </AuthShell>
  )
}
