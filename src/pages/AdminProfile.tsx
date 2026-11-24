import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Shield, User } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Avatar } from '@/components/ui/avatar'
import { Detail, Field, Loading, PageHeader } from '@/components/ui/page'
import { supabase } from '@/lib/supabase'
import { adminOperations } from '@/lib/adminOperations'
import { getAdminSession, setAdminSession } from '@/lib/session'
import { errorMessage, formatDate } from '@/lib/utils'

interface Profile {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  created_at: string
  avatar_url: string | null
  role: string
}

export default function AdminProfile() {
  const navigate = useNavigate()
  const adminId = getAdminSession()?.id
  const fileRef = useRef<HTMLInputElement>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [names, setNames] = useState({ first: '', last: '' })
  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    if (!adminId) {
      setLoading(false)
      return
    }
    supabase
      .from('admins')
      .select('id, first_name, last_name, email, created_at, avatar_url, role')
      .eq('id', adminId)
      .maybeSingle()
      .then(({ data, error: err }) => {
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
        <Alert>
          <p>Admin session not found. Please log in.</p>
          <Button className="mt-3" onClick={() => navigate('/login')}>Go to Login</Button>
        </Alert>
      </div>
    )
  }

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    setUploadMsg(null)
    if (!f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
      setUploadMsg({ kind: 'error', text: 'Use a PNG, JPG or WEBP image.' })
      return
    }
    if (f.size > 1024 * 1024) setUploadMsg({ kind: 'error', text: 'Images under 1MB are recommended. This one may upload slowly.' })
    setFile(f)
    const reader = new FileReader()
    reader.onload = () => setPreview(String(reader.result))
    reader.readAsDataURL(f)
  }

  const upload = async () => {
    if (!file || !adminId) return
    setUploading(true)
    setUploadMsg(null)
    try {
      const url = await adminOperations.uploadAvatar(adminId, file)
      setProfile((p) => (p ? { ...p, avatar_url: url } : p))
      const s = getAdminSession()
      if (s) setAdminSession({ ...s, avatar_url: url })
      setFile(null)
      setUploadMsg({ kind: 'success', text: 'Avatar updated.' })
    } catch (e) {
      setUploadMsg({ kind: 'error', text: errorMessage(e) })
    } finally {
      setUploading(false)
    }
  }

  const saveNames = async () => {
    try {
      await adminOperations.updateMyName(names.first.trim(), names.last.trim())
      setProfile((p) => (p ? { ...p, first_name: names.first.trim(), last_name: names.last.trim() } : p))
      const s = getAdminSession()
      if (s) setAdminSession({ ...s, first_name: names.first.trim(), last_name: names.last.trim() })
      setUploadMsg({ kind: 'success', text: 'Name saved.' })
    } catch (e) {
      setUploadMsg({ kind: 'error', text: errorMessage(e) })
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

  const initials = ((profile?.first_name?.[0] ?? profile?.email?.[0] ?? 'A') + (profile?.last_name?.[0] ?? '')).toUpperCase()

  return (
    <AdminLayout>
      <PageHeader title="My Profile" description="Your admin details and security settings." />
      {loading ? (
        <Loading label="Loading profile..." />
      ) : error ? (
        <p className="text-sm font-medium text-red-600">Error: {error}</p>
      ) : !profile ? (
        <p className="text-sm text-muted-foreground">Admin profile not found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-4">
                <Avatar src={preview ?? profile.avatar_url} fallback={initials} className="h-20 w-20 text-xl ring-2 ring-primary ring-offset-2 dark:ring-offset-gray-800" />
                <div className="flex flex-col gap-2">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><User /> Choose image</Button>
                  {file ? <Button size="sm" onClick={upload} disabled={uploading}>{uploading ? 'Uploading...' : 'Upload New Avatar'}</Button> : null}
                  <p className="text-xs text-muted-foreground">PNG, JPG or WEBP, under 1MB</p>
                </div>
              </div>
              {uploadMsg ? <Alert variant={uploadMsg.kind}>{uploadMsg.text}</Alert> : null}
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" htmlFor="p-first"><Input id="p-first" value={names.first} onChange={(e) => setNames({ ...names, first: e.target.value })} /></Field>
                <Field label="Last name" htmlFor="p-last"><Input id="p-last" value={names.last} onChange={(e) => setNames({ ...names, last: e.target.value })} /></Field>
              </div>
              <Button variant="outline" size="sm" onClick={saveNames}>Save name</Button>
              <div className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
                <Detail label="Email">{profile.email}</Detail>
                <Detail label="Role"><span className="capitalize">{profile.role.replace(/_/g, ' ')}</span></Detail>
                <Detail label="Date joined">{formatDate(profile.created_at)}</Detail>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Security settings</CardTitle>
                <CardDescription>Change your password.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={changePassword} className="space-y-4">
                  <Field label="New password" htmlFor="np"><Input id="np" type="password" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
                  <Field label="Confirm password" htmlFor="cp"><Input id="cp" type="password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
                  {pwMsg ? <Alert variant={pwMsg.kind}>{pwMsg.text}</Alert> : null}
                  <Button type="submit" className="w-full sm:w-auto" disabled={savingPw}>{savingPw ? 'Updating...' : 'Update Password'}</Button>
                </form>
              </CardContent>
            </Card>
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-100">
              <p className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Security tips</p>
              <ul className="list-inside list-disc space-y-1">
                <li>Use a strong password you do not use anywhere else.</li>
                <li>Turn on two factor authentication when it becomes available.</li>
                <li>Report anything suspicious to a super admin straight away.</li>
              </ul>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Shield className="h-3.5 w-3.5" /> Changes to your account are recorded in the audit log.</p>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
