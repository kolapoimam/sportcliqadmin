import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/page'
import { supabase } from '@/lib/supabase'
import { adminOperations } from '@/lib/adminOperations'
import { errorMessage } from '@/lib/utils'

/** Handles both asking for a reset email and setting a new password from the email link. */
export default function ResetPassword() {
  const navigate = useNavigate()
  const [recovery, setRecovery] = useState(() => window.location.hash.includes('type=recovery'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const requestEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await adminOperations.sendPasswordReset(email.trim(), true)
      setMessage({ kind: 'success', text: 'If that email belongs to an admin, a reset link is on its way.' })
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const setNewPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) return setMessage({ kind: 'error', text: 'Password must be at least 6 characters.' })
    if (password !== confirm) return setMessage({ kind: 'error', text: 'Passwords do not match.' })
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      await supabase.auth.signOut()
      setMessage({ kind: 'success', text: 'Password updated. You can sign in now.' })
      setTimeout(() => navigate('/login', { replace: true }), 1500)
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-playarena-50 to-playarena-100 p-4 dark:from-gray-900 dark:to-gray-800">
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-center">
          <Logo className="h-12" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{recovery ? 'Set a new password' : 'Reset your password'}</CardTitle>
            <CardDescription>{recovery ? 'Choose a new password for your admin account.' : 'We will email you a reset link.'}</CardDescription>
          </CardHeader>
          <CardContent>
            {recovery ? (
              <form onSubmit={setNewPassword} className="space-y-4">
                <Field label="New password" htmlFor="pw">
                  <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Field label="Confirm password" htmlFor="pw2">
                  <Input id="pw2" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </Field>
                {message ? <Alert variant={message.kind}>{message.text}</Alert> : null}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? 'Saving...' : 'Update Password'}
                </Button>
              </form>
            ) : (
              <form onSubmit={requestEmail} className="space-y-4">
                <Field label="Email" htmlFor="email">
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                {message ? <Alert variant={message.kind}>{message.text}</Alert> : null}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? 'Sending...' : 'Send Reset Link'}
                </Button>
              </form>
            )}
            <p className="mt-4 text-center text-sm">
              <Link to="/login" className="font-semibold text-primary hover:underline">Back to login</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
