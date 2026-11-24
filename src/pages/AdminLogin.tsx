import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Mail, ShieldAlert } from 'lucide-react'
import { AuthShell } from '@/components/AuthShell'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/feedback'
import { Card } from '@/components/ui/card'
import { adminOperations } from '@/lib/adminOperations'
import { errorMessage } from '@/lib/utils'

export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)

  useEffect(() => {
    adminOperations.setupStatus().then((s) => setSetupOpen(Boolean(s?.available))).catch(() => setSetupOpen(false))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await adminOperations.login(email.trim(), password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (err) {
      const msg = errorMessage(err)
      setError(/invalid login/i.test(msg) ? 'Invalid email or password.' : /not confirmed/i.test(msg) ? 'This email is not confirmed yet. Check your inbox or ask a super admin.' : msg)
    } finally {
      setLoading(false)
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
        <p className="mt-1 text-sm text-muted-foreground">Sign in to manage Sport Cliq.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <Field label="Email" htmlFor="email">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10" placeholder="you@sportcliq.com" />
            </div>
          </Field>
          <Field label="Password" htmlFor="password">
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="password" type={show ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-10 pr-11" />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
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
        <p>Access is restricted to authorised Sport Cliq administrators. Unauthorised access attempts are logged.</p>
      </div>
    </AuthShell>
  )
}
