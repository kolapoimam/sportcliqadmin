import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Loading } from '@/components/ui/page'
import { adminOperations } from '@/lib/adminOperations'
import { errorMessage } from '@/lib/utils'

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export default function AdminSetup() {
  const navigate = useNavigate()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [form, setForm] = useState({ email: '', password: '', confirm: '', secret: '' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    adminOperations
      .setupAvailable()
      .then(setAvailable)
      .catch((e) => {
        console.error(e)
        setAvailable(false)
      })
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.email || !form.password || !form.secret) return setError('All fields are required.')
    if (!EMAIL_RE.test(form.email)) return setError('Enter a valid email address.')
    if (form.password.length < 8) return setError('Password must be at least 8 characters.')
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    setSubmitting(true)
    try {
      await adminOperations.createFirstAdmin(form.email.trim(), form.password, form.secret)
      navigate('/login', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-playarena-50 to-playarena-100 p-4 dark:from-gray-900 dark:to-gray-800">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-center">
          <Logo className="h-12" />
        </div>
        {available === null ? (
          <Loading />
        ) : !available ? (
          <Card>
            <CardHeader className="items-center text-center">
              <AlertTriangle className="h-8 w-8 text-yellow-500" />
              <CardTitle>Setup unavailable</CardTitle>
              <CardDescription>The admin setup has already been completed.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => navigate('/login')}>
                Go to Login
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <CardTitle>Create the first super admin</CardTitle>
              </div>
              <CardDescription>This page only works once, while there are no admins.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4" noValidate>
                <Field label="Email" htmlFor="email">
                  <Input id="email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field label="Password" htmlFor="password">
                  <Input id="password" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </Field>
                <Field label="Confirm password" htmlFor="confirm">
                  <Input id="confirm" type="password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
                </Field>
                <Field label="Setup secret key" htmlFor="secret">
                  <Input id="secret" type="password" required value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
                </Field>
                {error ? <Alert>{error}</Alert> : null}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Creating admin...' : 'Create Super Admin'}
                </Button>
              </form>
              <div className="mt-4 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100">
                Use a strong password and keep the secret key safe. Anyone with the key could create the first admin.
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
