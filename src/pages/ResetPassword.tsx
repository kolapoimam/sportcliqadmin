import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, MailCheck } from 'lucide-react'
import { AuthShell } from '@/components/AuthShell'
import { Button } from '@/components/ui/button'
import { Field, Input, PasswordInput } from '@/components/ui/input'
import { Alert } from '@/components/ui/feedback'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'
import { adminOperations } from '@/lib/adminOperations'
import { errorMessage } from '@/lib/utils'

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
    if (password.length < 8) return setMessage({ kind: 'error', text: 'Password must be at least 8 characters.' })
    if (password !== confirm) return setMessage({ kind: 'error', text: 'Passwords do not match.' })
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      await supabase.auth.signOut()
      setMessage({ kind: 'success', text: 'Password updated. Taking you to sign in.' })
      setTimeout(() => navigate('/login', { replace: true }), 1500)
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <Card className="p-7 sm:p-8">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-playarena-50 text-primary dark:bg-playarena-950">
          {recovery ? <KeyRound className="h-6 w-6" /> : <MailCheck className="h-6 w-6" />}
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight">{recovery ? 'Set a new password' : 'Reset your password'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{recovery ? 'Choose a new password for your admin account.' : 'We will email you a secure reset link.'}</p>
        {recovery ? (
          <form onSubmit={setNewPassword} className="mt-6 space-y-4">
            <Field label="New password" htmlFor="pw"><PasswordInput id="pw" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Confirm password" htmlFor="pw2"><PasswordInput id="pw2" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            {message ? <Alert variant={message.kind}>{message.text}</Alert> : null}
            <Button type="submit" size="lg" className="w-full" loading={busy}>Update Password</Button>
          </form>
        ) : (
          <form onSubmit={requestEmail} className="mt-6 space-y-4">
            <Field label="Email" htmlFor="email"><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            {message ? <Alert variant={message.kind}>{message.text}</Alert> : null}
            <Button type="submit" size="lg" className="w-full" loading={busy}>Send Reset Link</Button>
          </form>
        )}
        <p className="mt-5 text-center text-sm"><Link to="/login" className="font-semibold text-primary hover:underline">Back to login</Link></p>
      </Card>
    </AuthShell>
  )
}
