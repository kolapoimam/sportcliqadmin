import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Splash } from '@/components/RequireAdmin'
import { supabase } from '@/lib/supabase'
import { adminOperations } from '@/lib/adminOperations'
import { errorMessage } from '@/lib/utils'

/** Google sends people back here. Accepts a pending invite if there is one, then goes to 2FA. */
export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    let done = false
    const go = async () => {
      if (done) return
      const { data } = await supabase.auth.getSession()
      if (!data.session) return
      done = true
      try {
        const token = localStorage.getItem('pendingInvite')
        if (token) {
          await adminOperations.acceptInviteOAuth(token)
          localStorage.removeItem('pendingInvite')
        }
        await adminOperations.checkAdmin()
        await adminOperations.logEvent('login_google', 'Google sign in').catch(() => undefined)
        navigate('/mfa', { replace: true })
      } catch (e) {
        localStorage.removeItem('pendingInvite')
        sessionStorage.setItem('authError', errorMessage(e))
        await supabase.auth.signOut()
        navigate('/login', { replace: true })
      }
    }
    const { data: sub } = supabase.auth.onAuthStateChange(() => { go() })
    go()
    const t = setTimeout(async () => {
      if (!done) {
        sessionStorage.setItem('authError', 'Google sign in did not finish. Try again.')
        navigate('/login', { replace: true })
      }
    }, 15000)
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [navigate])

  return <Splash text="Signing you in with Google" />
}
