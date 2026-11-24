import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Lock, Mail, ShieldAlert } from 'lucide-react'
import { AuthShell } from '@/components/AuthShell'
import { GoogleButton, OrDivider } from '@/components/GoogleButton'
import { Button } from '@/components/ui/button'
import { Field, Input, PasswordInput } from '@/components/ui/input'
import { Alert } from '@/components/ui/feedback'
import { Card } from '@/components/ui/card'
import { adminOperations } from '@/lib/adminOperations'
import { errorMessage } from '@/lib/utils'

export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(() => sessionStorage.getItem('authError'))
  const [setupOpen, setSetupOpen] = useState(false)

  useEffect(() => {
    sessionStorage.removeItem('authError')
    adminOperations.setupStatus().then((s) => setSetupOpen(Boolean(s?.available))).catch(() => setSetupOpen(false))
  }, [])

  const from = (location.state as { from?: string } | null)?.from

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await adminOperations.login(email.trim(), password)
      navigate('/mfa', { replace: true, state: { from } })
    } catch (err) {
      const msg = errorMessage(err)
      setError(/invalid login/i.test(msg) ? 'Invalid email or password.' : /not confirmed/i.test(msg) ? 'This email is not confirmed yet. Use the invite link you were sent, or ask a super admin.' : msg)
    } finally {
      setLoading(false)
    }
  }

  const google = async () => {
    setGoogleLoading(true)
    setError(null)
    try {
      if (from) sessionStorage.setItem('authFrom', from)
      await adminOperations.loginWithGoogle()
    } catch (err) {
      setError(/provider is not enabled|unsupported provider/i.test(errorMessage(err)) ? 'Google sign in is not switched on in Supabase yet.' : errorMessage(err))
      setGoogleLoading(false)
    }
  }

  return (
    <AuthShell>
      {setupOpen ? (
        <Alert variant="info" className="mb-4">
          No admin account exists yet. <Link to="/setup" className="font-bold underline">Create the first super admin</Link>.
        </Alert>
      ) : null}
      <Card className="p-7 sm:p-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to manage SportCliq. You will confirm with your authenticator app next.</p>
        <div className="mt-6">
          <GoogleButton onClick={google} loading={googleLoading} />
        </div>
        <OrDivider />
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10" placeholder="you@sportcliq.com" />
            </div>
          </Field>
          <Field label="Password" htmlFor="password">
            <PasswordInput id="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} icon={<Lock />} />
          </Field>
          <div className="flex justify-end">
            <Link to="/reset-password" className="text-sm font-semibold text-primary hover:underline">Forgot password?</Link>
          </div>
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" size="lg" className="w-full" loading={loading}>{loading ? 'Signing in...' : 'Sign In'}</Button>
        </form>
      </Card>
      <div className="mt-4 flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-100">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <p>Access is restricted to authorised SportCliq administrators. Two factor authentication is required and every attempt is logged.</p>
      </div>
    </AuthShell>
  )
}
