import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, KeyRound, Shield, ShieldAlert, ShieldCheck, Smartphone, User } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Field, Input, PasswordInput } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { Alert, useToast } from '@/components/ui/feedback'
import { Detail, Loading, PageHeader } from '@/components/ui/page'
import { supabase } from '@/lib/supabase'
import { adminOperations } from '@/lib/adminOperations'
import { getAdminSession, setAdminSession } from '@/lib/session'
import { errorMessage, formatDate } from '@/lib/utils'

interface Profile { id: string; first_name: string | null; last_name: string | null; email: string; created_at: string; avatar_url: string | null; role: string }

export default function AdminProfile() {
  const navigate = useNavigate()
  const toast = useToast()
  const adminId = getAdminSession()?.id
  const fileRef = useRef<HTMLInputElement>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [names, setNames] = useState({ first: '', last: '' })
  const [savingName, setSavingName] = useState(false)
  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    if (!adminId) {
      setLoading(false)
      return
    }
    supabase.from('admins').select('id, first_name, last_name, email, created_at, avatar_url, role').eq('id', adminId).maybeSingle().then(({ data, error: err }) => {
      if (err) setError(err.message)
      else if (data) {
        setProfile(data as Profile)
        setNames({ first: data.first_name ?? '', last: data.last_name ?? '' })
      }
      setLoading(false)
    })
  }, [adminId])

  if (!adminId && !loading) {
    return (
      <div className="mx-auto mt-20 max-w-md p-4">
        <Alert><p>Admin session not found. Please log in.</p><Button className="mt-3" onClick={() => navigate('/login')}>Go to Login</Button></Alert>
      </div>
    )
  }

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toast.error('Use a PNG, JPG or WEBP image')
    if (f.size > 1024 * 1024) toast.info('Large image', 'Under 1MB is recommended. This one may upload slowly.')
    setFile(f)
    const reader = new FileReader()
    reader.onload = () => setPreview(String(reader.result))
    reader.readAsDataURL(f)
  }

  const upload = async () => {
    if (!file || !adminId) return
    setUploading(true)
    try {
      const url = await adminOperations.uploadAvatar(adminId, file)
      setProfile((p) => (p ? { ...p, avatar_url: url } : p))
      const s = getAdminSession()
      if (s) setAdminSession({ ...s, avatar_url: url })
      setFile(null)
      toast.success('Avatar updated')
    } catch (e) {
      toast.error('Upload failed', errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  const saveNames = async () => {
    setSavingName(true)
    try {
      await adminOperations.updateMyName(names.first.trim(), names.last.trim())
      setProfile((p) => (p ? { ...p, first_name: names.first.trim(), last_name: names.last.trim() } : p))
      const s = getAdminSession()
      if (s) setAdminSession({ ...s, first_name: names.first.trim(), last_name: names.last.trim() })
      toast.success('Name saved')
    } catch (e) {
      toast.error('Could not save', errorMessage(e))
    } finally {
      setSavingName(false)
    }
  }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwMsg(null)
    if (pw.next.length < 6) return setPwMsg({ kind: 'error', text: 'Password must be at least 6 characters.' })
    if (pw.next !== pw.confirm) return setPwMsg({ kind: 'error', text: 'Passwords do not match.' })
    setSavingPw(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw.next })
      if (err) throw err
      await adminOperations.log('settings', 'Changed own password').catch(() => undefined)
      setPw({ next: '', confirm: '' })
      setPwMsg({ kind: 'success', text: 'Password updated successfully!' })
    } catch (err) {
      setPwMsg({ kind: 'error', text: errorMessage(err) })
    } finally {
      setSavingPw(false)
    }
  }

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email

  return (
    <AdminLayout>
      <PageHeader eyebrow="Account" title="My Profile" description="Your admin details and security settings." />
      {loading ? <Card className="p-6"><Loading /></Card> : error ? <Alert>Error: {error}</Alert> : !profile ? <p className="text-sm text-muted-foreground">Admin profile not found.</p> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Card className="overflow-hidden">
            <div className="h-28 bg-[#35B551]" />
            <CardContent className="-mt-12">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="relative w-fit">
                  <Avatar src={preview ?? profile.avatar_url} name={fullName} className="h-24 w-24 text-2xl ring-4 ring-background" />
                  <button type="button" onClick={() => fileRef.current?.click()} aria-label="Choose a new avatar" className="absolute bottom-0 right-0 cursor-pointer rounded-full bg-primary p-2 text-white shadow-lg ring-4 ring-background hover:bg-primary-dark">
                    <Camera className="h-4 w-4" />
                  </button>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} />
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="truncate text-xl font-extrabold">{fullName}</p>
                  <p className="text-sm capitalize text-muted-foreground">{profile.role.replace(/_/g, ' ')}</p>
                </div>
                {file ? <Button onClick={upload} loading={uploading}><User /> Upload New Avatar</Button> : null}
              </div>
              <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <Detail label="Email">{profile.email}</Detail>
                <Detail label="Role"><span className="capitalize">{profile.role.replace(/_/g, ' ')}</span></Detail>
                <Detail label="Date joined">{formatDate(profile.created_at)}</Detail>
              </div>
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name" htmlFor="p-first"><Input id="p-first" value={names.first} onChange={(e) => setNames({ ...names, first: e.target.value })} /></Field>
                <Field label="Last name" htmlFor="p-last"><Input id="p-last" value={names.last} onChange={(e) => setNames({ ...names, last: e.target.value })} /></Field>
              </div>
              <Button variant="soft" className="mt-4" onClick={saveNames} loading={savingName}>Save name</Button>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader icon={<KeyRound />} title="Security settings" description="Change your password." />
              <CardContent>
                <form onSubmit={changePassword} className="space-y-4">
                  <Field label="New password" htmlFor="np"><PasswordInput id="np" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
                  <Field label="Confirm password" htmlFor="cp"><PasswordInput id="cp" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
                  {pwMsg ? <Alert variant={pwMsg.kind} icon={pwMsg.kind === 'success' ? <Shield /> : undefined}>{pwMsg.text}</Alert> : null}
                  <Button type="submit" className="w-full sm:w-auto" loading={savingPw}>Update Password</Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader icon={<Smartphone />} title="Two factor" description="Required for every sign in, payout approval and delete." />
              <CardContent>
                <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                  <ShieldCheck className="h-5 w-5 shrink-0" />
                  <span>Google Authenticator is on, saved as <b>SportCliq Admin</b>. If you lose your phone, ask a super admin to reset it.</span>
                </div>
              </CardContent>
            </Card>
            <Alert variant="warning" icon={<ShieldAlert />}>
              <p className="font-bold">Security tips</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>Use a strong password you do not use anywhere else.</li>
                <li>Never share authenticator codes. SportCliq will never ask for them.</li>
                <li>Report anything suspicious to a super admin straight away.</li>
              </ul>
            </Alert>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
