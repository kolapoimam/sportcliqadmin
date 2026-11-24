import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Splash } from '@/components/RequireAdmin'
import { supabase } from '@/lib/supabase'
import { adminOperations, SIGNUP_DB_HELP } from '@/lib/adminOperations'
import { errorMessage } from '@/lib/utils'

/** Reads an error Supabase or Google sent back in the address, if any. */
function returnedError() {
  const q = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const msg = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error')
  if (!msg) return null
  const text = msg.replace(/\+/g, ' ')
  if (/database error/i.test(text)) return SIGNUP_DB_HELP
  if (/access_denied/i.test(text)) return 'Google sign in was cancelled.'
  return text
}

/** Google sends people back here. Accepts a pending invite if there is one, then goes to 2FA. */
export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    let done = false
    const fail = async (message: string) => {
      if (done) return
      done = true
      localStorage.removeItem('pendingInvite')
      sessionStorage.setItem('authError', message)
      await supabase.auth.signOut().catch(() => undefined)
      navigate('/login', { replace: true })
    }

    const early = returnedError()
    if (early) {
      fail(early)
      return
    }

    const go = async () => {
      if (done) return
      let { data } = await supabase.auth.getSession()
      // PKCE style return: swap the code for a session
      const code = new URLSearchParams(window.location.search).get('code')
      if (!data.session && code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error && !/already|used|invalid flow state/i.test(error.message)) return fail(errorMessage(error))
        data = (await supabase.auth.getSession()).data
      }
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
        done = false
        await fail(errorMessage(e))
      }
    }
    const { data: sub } = supabase.auth.onAuthStateChange(() => { setTimeout(go, 0) })
    go()
    const t = setTimeout(() => {
      if (!done) fail('Google sign in did not finish. Check that https://admin.sportcliq.com/auth/callback is listed in Supabase under Authentication, URL Configuration, Redirect URLs, then try again.')
    }, 15000)
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [navigate])

  return <Splash text="Signing you in with Google" />
}
