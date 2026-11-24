import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Lock, MailOpen, XCircle } from 'lucide-react'
import { AuthShell } from '@/components/AuthShell'
import { GoogleButton, OrDivider } from '@/components/GoogleButton'
import { Splash } from '@/components/RequireAdmin'
import { Button } from '@/components/ui/button'
import { Field, Input, PasswordInput } from '@/components/ui/input'
import { Alert } from '@/components/ui/feedback'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { adminOperations, type InviteInfo } from '@/lib/adminOperations'
import { errorMessage, formatDate } from '@/lib/utils'

export default function AcceptInvite() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined)
  const [form, setForm] = useState({ first: '', last: '', password: '', confirm: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  useEffect(() => {
    if (!token) return setInfo(null)
    adminOperations.inviteInfo(token).then((i) => {
      setInfo(i)
      if (i) setForm((f) => ({ ...f, first: i.first_name ?? '', last: i.last_name ?? '' }))
    }).catch(() => setInfo(null))
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!info) return
    setError(null)
    if (form.password.length < 8) return setError('Password must be at least 8 characters.')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      await adminOperations.acceptInvite(token, info.email, form.password, form.first.trim(), form.last.trim())
      await adminOperations.login(info.email, form.password)
      navigate('/mfa', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    setGoogleBusy(true)
    localStorage.setItem('pendingInvite', token)
    try {
      await adminOperations.loginWithGoogle()
    } catch (err) {
      setError(errorMessage(err))
      setGoogleBusy(false)
    }
  }

  if (info === undefined) return <Splash text="Opening your invite" />

  const usable = info && info.status === 'pending'

  return (
    <AuthShell>
      <Card className="p-7 sm:p-8">
        {!usable ? (
          <div className="text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950"><XCircle className="h-7 w-7" /></span>
            <h1 className="text-xl font-extrabold">Invite not available</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {!info ? 'This link is not valid.' : info.status === 'expired' ? 'This invite has expired.' : info.status === 'accepted' ? 'This invite was already accepted. Sign in instead.' : 'This invite was cancelled.'} Ask a SportCliq super admin for a new one.
            </p>
            <Button className="mt-6 w-full" onClick={() => navigate('/login')}>Go to Login</Button>
          </div>
        ) : (
          <>
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-playarena-50 text-primary dark:bg-playarena-950"><MailOpen className="h-6 w-6" /></span>
            <h1 className="text-2xl font-extrabold tracking-tight">Join SportCliq Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">{info.invited_by ?? 'A super admin'} invited <b className="text-foreground">{info.email}</b>.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="success">{info.role_name ?? 'Admin'}</Badge>
              <Badge variant="secondary">Expires {formatDate(info.expires_at)}</Badge>
            </div>
            <div className="mt-6"><GoogleButton onClick={google} loading={googleBusy} label="Accept with Google" /></div>
            <p className="mt-2 text-center text-xs text-muted-foreground">Use the Google account for {info.email}.</p>
            <OrDivider />
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" htmlFor="first"><Input id="first" value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} /></Field>
                <Field label="Last name" htmlFor="last"><Input id="last" value={form.last} onChange={(e) => setForm({ ...form, last: e.target.value })} /></Field>
              </div>
              <Field label="Create a password" htmlFor="pw" hint="8 characters or more"><PasswordInput id="pw" icon={<Lock />} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></Field>
              <Field label="Confirm password" htmlFor="pw2"><PasswordInput id="pw2" icon={<Lock />} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" /></Field>
              {error ? <Alert>{error}</Alert> : null}
              <Button type="submit" size="lg" className="w-full" loading={busy}>Accept invite</Button>
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">Next you will set up two factor with Google Authenticator.</p>
          </>
        )}
        <p className="mt-5 text-center text-sm"><Link to="/login" className="font-semibold text-primary hover:underline">Back to login</Link></p>
      </Card>
    </AuthShell>
  )
}
