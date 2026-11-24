import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, KeyRound, ShieldCheck, Terminal } from 'lucide-react'
import { AuthShell } from '@/components/AuthShell'
import { Splash } from '@/components/RequireAdmin'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Alert, useToast } from '@/components/ui/feedback'
import { Card } from '@/components/ui/card'
import { adminOperations } from '@/lib/adminOperations'
import { errorMessage } from '@/lib/utils'

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

type Status = { available: boolean; secret_set: boolean; legacy_admins: number }

export default function AdminSetup() {
  const navigate = useNavigate()
  const toast = useToast()
  const [status, setStatus] = useState<Status | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '', secret: '' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = () => {
    setLoadError(null)
    adminOperations
      .setupStatus()
      .then(setStatus)
      .catch((e) => {
        const msg = errorMessage(e)
        setLoadError(
          /admin_setup_status|function|schema cache|not find/i.test(msg)
            ? 'The admin database update has not been run yet. Run the SQL files from the repo in the Supabase SQL editor, then refresh this page.'
            : msg,
        )
      })
  }
  useEffect(load, [])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.email || !form.password || !form.secret) return setError('Email, password and secret key are required.')
    if (!EMAIL_RE.test(form.email.trim())) return setError('Enter a valid email address.')
    if (form.password.length < 8) return setError('Password must be at least 8 characters.')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    setSubmitting(true)
    try {
      await adminOperations.createFirstAdmin({ email: form.email.trim(), password: form.password, secretKey: form.secret, firstName: form.firstName.trim(), lastName: form.lastName.trim() })
      toast.success('Super admin created', 'Signing you in now.')
      await adminOperations.login(form.email.trim(), form.password).then(
        () => navigate('/', { replace: true }),
        () => navigate('/login', { replace: true }),
      )
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!status && !loadError) return <Splash text="Checking setup" />

  return (
    <AuthShell>
      {loadError ? (
        <Card className="p-7">
          <Alert>{loadError}</Alert>
          <Button className="mt-4 w-full" variant="outline" onClick={load}>Try again</Button>
        </Card>
      ) : status && !status.available ? (
        <Card className="p-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950"><CheckCircle2 className="h-7 w-7" /></span>
          <h1 className="text-xl font-extrabold">Setup already completed</h1>
          <p className="mt-2 text-sm text-muted-foreground">The admin setup has already been completed. Sign in with your admin account.</p>
          <Button className="mt-6 w-full" size="lg" onClick={() => navigate('/login')}>Go to Login</Button>
        </Card>
      ) : (
        <Card className="p-7 sm:p-8">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-playarena-50 text-primary dark:bg-playarena-950"><ShieldCheck className="h-6 w-6" /></span>
          <h1 className="text-2xl font-extrabold tracking-tight">Create the first super admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">This page works once, until the first admin exists.</p>

          {status && !status.secret_set ? (
            <Alert variant="warning" className="mt-5" icon={<Terminal />}>
              <p className="font-semibold">Set your setup secret first</p>
              <p className="mt-1">In the Supabase SQL editor run this with your own phrase, then use it below.</p>
              <code className="mt-2 block rounded-lg bg-black/5 px-2 py-1.5 font-mono text-xs dark:bg-white/10">select admin_set_setup_secret('your-long-secret');</code>
              <button type="button" onClick={load} className="mt-2 cursor-pointer text-xs font-bold underline">I have done it, check again</button>
            </Alert>
          ) : null}

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" htmlFor="first"><Input id="first" value={form.firstName} onChange={set('firstName')} /></Field>
              <Field label="Last name" htmlFor="last"><Input id="last" value={form.lastName} onChange={set('lastName')} /></Field>
            </div>
            <Field label="Email" htmlFor="email"><Input id="email" type="email" required value={form.email} onChange={set('email')} placeholder="you@sportcliq.com" /></Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Password" htmlFor="password" hint="8 characters or more"><Input id="password" type="password" required value={form.password} onChange={set('password')} /></Field>
              <Field label="Confirm password" htmlFor="confirm"><Input id="confirm" type="password" required value={form.confirm} onChange={set('confirm')} /></Field>
            </div>
            <Field label="Setup secret key" htmlFor="secret">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="secret" type="password" required value={form.secret} onChange={set('secret')} className="pl-10" />
              </div>
            </Field>
            {error ? <Alert>{error}</Alert> : null}
            <Button type="submit" size="lg" className="w-full" loading={submitting}>{submitting ? 'Creating admin...' : 'Create Super Admin'}</Button>
          </form>
          <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-100">
            Use a strong password and keep the secret key safe. If this email already has a Sport Cliq login, its password becomes the one you enter here.
          </div>
          <p className="mt-4 text-center text-sm"><Link to="/login" className="font-semibold text-primary hover:underline">Back to login</Link></p>
        </Card>
      )}
    </AuthShell>
  )
}
