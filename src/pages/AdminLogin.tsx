import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { AlertTriangle, Bell, Calendar, DollarSign, Settings, Users } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { Field } from '@/components/ui/page'
import { adminOperations } from '@/lib/adminOperations'
import { errorMessage } from '@/lib/utils'

const features = [
  { icon: Users, title: 'User Management', description: 'Find users, update event status and manage accounts.' },
  { icon: Calendar, title: 'Event Management', description: 'Monitor, edit and cancel matches and cycling events.' },
  { icon: DollarSign, title: 'Financial Oversight', description: 'Review cashouts and track platform revenue.' },
  { icon: Settings, title: 'System Settings', description: 'Manage admins, venues and platform settings.' },
  { icon: Bell, title: 'Notification Center', description: 'Send updates and get real time platform alerts.' },
]

export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setError(msg === 'Invalid login credentials' ? 'Invalid email or password.' : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-playarena-50 to-playarena-100 dark:from-gray-900 dark:to-gray-800">
      <section className="hidden w-1/2 flex-col justify-center gap-8 p-12 lg:flex">
        <div className="flex items-center gap-3">
          <Logo className="h-12" />
          <h1 className="text-3xl font-extrabold">Sport Cliq Admin</h1>
        </div>
        <ul className="space-y-3">
          {features.map((f) => (
            <li key={f.title} className="flex items-start gap-4 rounded-xl p-4 transition-colors hover:bg-white/80 dark:hover:bg-gray-800/80">
              <span className="rounded-lg bg-primary p-2 text-white">
                <f.icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-semibold">{f.title}</span>
                <span className="block text-sm text-muted-foreground">{f.description}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex w-full items-center justify-center p-4 lg:w-1/2">
        <div className="w-full max-w-md space-y-4">
          <div className="rounded-2xl bg-white/80 p-8 shadow-xl backdrop-blur dark:bg-gray-800/80">
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <Logo className="h-12" />
              <div>
                <h2 className="text-2xl font-bold">Admin sign in</h2>
                <p className="text-sm text-muted-foreground">Sign in to manage Sport Cliq</p>
              </div>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="bg-white dark:bg-gray-900" />
              </Field>
              <Field label="Password" htmlFor="password">
                <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-white dark:bg-gray-900" />
              </Field>
              {error ? <Alert>{error}</Alert> : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Forgot your password? <Link to="/reset-password" className="font-semibold text-primary hover:underline">Reset it</Link>
              </p>
            </form>
          </div>
          <div className="flex gap-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>Access is restricted to authorised Sport Cliq administrators. Unauthorised access attempts are logged.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
