import { useEffect, useState } from 'react'
import { Bike, Building2, CheckCircle2, KeyRound, Moon, Percent, Settings as SettingsIcon, Sun, Trophy } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input, Switch } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Accordion } from '@/components/ui/accordion'
import { Alert, useConfirm, useToast } from '@/components/ui/feedback'
import { Loading, PageHeader } from '@/components/ui/page'
import { useAdminSession } from '@/hooks/useAdminSession'
import { useTheme } from '@/hooks/useTheme'
import { adminOperations, type Settings } from '@/lib/adminOperations'
import { errorMessage, naira } from '@/lib/utils'

const STREAMS = [
  { key: 'match', label: 'Match revenue', hint: 'Paid match slots and tickets', icon: Trophy },
  { key: 'cycling', label: 'Cycling revenue', hint: 'Paid cycling registrations', icon: Bike },
  { key: 'venue', label: 'Venue revenue', hint: 'Paid venue bookings', icon: Building2 },
] as const

export default function AdminSettings() {
  const session = useAdminSession()
  const isSuper = session?.role === 'super_admin'
  const confirm = useConfirm()
  const toast = useToast()
  const { dark, set } = useTheme()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rates, setRates] = useState({ match: '10', cycling: '10', venue: '10' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    adminOperations.getSettings().then((s) => {
      setSettings(s)
      const r = s.commission_rates
      if (r) setRates({ match: String(r.match), cycling: String(r.cycling), venue: String(r.venue) })
    }).catch((e) => setError(errorMessage(e)))
  }, [])

  const saveRates = async () => {
    const parsed = { match: Number(rates.match), cycling: Number(rates.cycling), venue: Number(rates.venue) }
    if (Object.values(parsed).some((n) => Number.isNaN(n) || n < 0 || n > 100)) return toast.error('Each rate must be between 0 and 100')
    const { ok } = await confirm({ title: 'Update commission rates?', description: 'Analytics and dashboard commission figures will use the new rates straight away, including for past periods.', confirmText: 'Save rates', icon: <Percent /> })
    if (!ok) return
    setSaving(true)
    try {
      await adminOperations.setCommissionRates(parsed)
      toast.success('Commission rates saved')
    } catch (e) {
      toast.error('Could not save', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout>
      <PageHeader eyebrow="System" title="Settings" description="Commission, appearance and setup." />
      {error ? <Alert className="mb-4">{error}</Alert> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader icon={<Percent />} title="Commission rates" description={isSuper ? 'The share Sport Cliq keeps from each revenue stream.' : 'Only super admins can change these.'} />
          <CardContent>
            {!settings ? <Loading rows={3} /> : (
              <>
                <div className="space-y-3">
                  {STREAMS.map((s) => {
                    const value = Number(rates[s.key]) || 0
                    return (
                      <div key={s.key} className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4 sm:flex-row sm:items-center">
                        <span className="flex flex-1 items-center gap-3">
                          <span className="rounded-xl bg-background p-2.5 text-primary shadow-soft"><s.icon className="h-5 w-5" /></span>
                          <span><span className="block font-bold">{s.label}</span><span className="block text-xs text-muted-foreground">{s.hint}. On {naira(10000)} you keep {naira(Math.round(10000 * value) / 100)}.</span></span>
                        </span>
                        <div className="relative w-full sm:w-28">
                          <Input aria-label={`${s.label} commission percent`} type="number" min={0} max={100} step={0.5} disabled={!isSuper} value={rates[s.key]} onChange={(e) => setRates({ ...rates, [s.key]: e.target.value })} className="pr-8 text-right font-bold" />
                          <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        </div>
                      </div>
                    )
                  })}
                </div>
                {isSuper ? <Button className="mt-4" onClick={saveRates} loading={saving}>Save rates</Button> : null}
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader icon={<SettingsIcon />} title="Appearance" />
            <CardContent>
              <div className="flex items-center justify-between rounded-2xl bg-muted/60 p-4">
                <span className="flex items-center gap-3 font-semibold">{dark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />} Dark mode</span>
                <Switch label="Dark mode" checked={dark} onCheckedChange={set} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader icon={<KeyRound />} title="First admin setup" />
            <CardContent>
              {settings?.setup_secret_set ? (
                <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Setup secret is set. Setup closes once an active admin exists.</p>
              ) : (
                <p className="text-sm text-muted-foreground">No setup secret saved. You only need one if every admin gets locked out.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Help" />
            <CardContent>
              <Accordion items={[
                { id: 'commission', title: 'How is commission worked out?', content: 'Revenue comes from paid match slots, match tickets, paid cycling registrations and paid venue bookings. Commission is that revenue multiplied by the rate for its stream.' },
                { id: 'cashout', title: 'When should I approve a cashout?', content: 'Approve only after you have sent the transfer to the bank details shown. Rejecting asks for a reason that the requester will see.' },
                { id: 'lockout', title: 'What if every admin is locked out?', content: "In the Supabase SQL editor run select admin_set_setup_secret('a-new-secret'); then deactivate the locked admins in the admins table. Setup reopens at /setup." },
              ]} />
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  )
}
