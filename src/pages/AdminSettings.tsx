import { useCallback, useEffect, useState } from 'react'
import { Building2, Check, CheckCircle2, Copy, Eye, Handshake, KeyRound, Lock, Moon, Pencil, Percent, Plus, Settings as SettingsIcon, ShieldCheck, Sun, Trash2, Trophy, Users } from 'lucide-react'
import { AdminLayout } from '@/components/AdminLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Field, Input, Switch, Textarea } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/dialog'
import { Accordion } from '@/components/ui/accordion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, useConfirm, useStepUp, useToast } from '@/components/ui/feedback'
import { EmptyState, Loading, PageHeader } from '@/components/ui/page'
import { useCan } from '@/hooks/useAdminSession'
import { useTheme } from '@/hooks/useTheme'
import { adminOperations, type CommissionRules, type PermissionModule, type RoleRow, type Settings } from '@/lib/adminOperations'
import { cn, errorMessage, naira } from '@/lib/utils'

const DEFAULT_RULES: CommissionRules = { organizer: { free_count: 2, rate: 5 }, venue: { free_count: 1, rate: 10 }, ambassador: { rate: 10 } }
const ACTION_LABEL: Record<string, string> = { view: 'View', edit: 'Edit', create: 'Create', delete: 'Delete', approve: 'Approve', export: 'Export', suspend: 'Suspend', message: 'Message', cancel: 'Cancel', send: 'Send', assign: 'Assign', payout: 'Payout', invite: 'Invite', deactivate: 'Deactivate', reset_2fa: 'Reset 2FA', manage: 'Manage' }

function RuleCard({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-muted/60 p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-background p-2.5 text-primary shadow-soft [&_svg]:size-5">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{title}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">{children}</div>
    </div>
  )
}

function NumberField({ label, value, onChange, suffix, disabled, max }: { label: string; value: number; onChange: (n: number) => void; suffix?: string; disabled?: boolean; max?: number }) {
  return (
    <Field label={label}>
      <div className="relative">
        <Input type="number" min={0} max={max} step={suffix === '%' ? 0.5 : 1} disabled={disabled} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))} className="pr-10 font-bold" />
        {suffix ? <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">{suffix}</span> : null}
      </div>
    </Field>
  )
}

export default function AdminSettings() {
  const can = useCan()
  const confirm = useConfirm()
  const stepUp = useStepUp()
  const toast = useToast()
  const { dark, set } = useTheme()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rules, setRules] = useState<CommissionRules>(DEFAULT_RULES)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [roles, setRoles] = useState<RoleRow[] | null>(null)
  const [catalog, setCatalog] = useState<PermissionModule[]>([])
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null)
  const [roleForm, setRoleForm] = useState<{ name: string; description: string; permissions: Set<string> }>({ name: '', description: '', permissions: new Set() })
  const [savingRole, setSavingRole] = useState(false)

  const canEdit = can('settings.edit')
  const canManageRoles = can('roles.manage')

  useEffect(() => {
    adminOperations.getSettings().then((s) => {
      setSettings(s)
      if (s.commission_rules) setRules({ ...DEFAULT_RULES, ...s.commission_rules })
    }).catch((e) => setError(errorMessage(e)))
  }, [])

  const loadRoles = useCallback(() => {
    adminOperations.listRoles().then((r) => { setRoles(r.roles); setCatalog(r.catalog) }).catch((e) => setError(errorMessage(e)))
  }, [])
  useEffect(() => {
    if (can('roles.view') || can('admins.view')) loadRoles()
  }, [loadRoles]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveRules = async () => {
    const vals = [rules.organizer.rate, rules.venue.rate, rules.ambassador.rate]
    if (vals.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) return toast.error('Rates must be between 0 and 100')
    const { ok } = await confirm({ title: 'Update fee rules?', description: 'Revenue, commission and ambassador earnings everywhere in the portal will use the new rules straight away, including for past activity.', confirmText: 'Continue', icon: <Percent /> })
    if (!ok) return
    if (!(await stepUp('change the fee rules'))) return
    setSaving(true)
    try {
      await adminOperations.setCommissionRules(rules)
      toast.success('Fee rules saved')
    } catch (e) {
      toast.error('Could not save', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }


  const openRole = (r: RoleRow | 'new') => {
    setRoleForm(r === 'new' ? { name: '', description: '', permissions: new Set(['dashboard.view']) } : { name: r.name, description: r.description ?? '', permissions: new Set(r.permissions) })
    setEditing(r)
  }
  const toggle = (perm: string) => setRoleForm((f) => {
    const p = new Set(f.permissions)
    if (p.has(perm)) {
      p.delete(perm)
      if (perm.endsWith('.view')) [...p].filter((x) => x.startsWith(perm.split('.')[0] + '.')).forEach((x) => p.delete(x))
    } else {
      p.add(perm)
      p.add(perm.split('.')[0] + '.view')
    }
    return { ...f, permissions: p }
  })
  const setRow = (m: PermissionModule, on: boolean) => setRoleForm((f) => {
    const p = new Set(f.permissions)
    m.actions.forEach((a) => (on ? p.add(`${m.module}.${a}`) : p.delete(`${m.module}.${a}`)))
    return { ...f, permissions: p }
  })
  const preset = (kind: 'read' | 'all' | 'none') => setRoleForm((f) => ({
    ...f,
    permissions: new Set(kind === 'none' ? [] : catalog.flatMap((m) => (kind === 'read' ? [`${m.module}.view`] : m.actions.map((a) => `${m.module}.${a}`)))),
  }))

  const saveRole = async () => {
    if (!editing) return
    setSavingRole(true)
    try {
      await adminOperations.saveRole(editing === 'new' ? null : editing.id, roleForm.name, roleForm.description, [...roleForm.permissions])
      toast.success(editing === 'new' ? 'Role created' : 'Role saved')
      setEditing(null)
      loadRoles()
    } catch (e) {
      toast.error('Could not save role', errorMessage(e))
    } finally {
      setSavingRole(false)
    }
  }

  const deleteRole = async (r: RoleRow) => {
    const { ok } = await confirm({ title: `Delete the ${r.name} role?`, description: r.members ? `${r.members} admin(s) use this role. Move them to another role first.` : 'Pending invites for this role are cancelled.', confirmText: 'Delete role', tone: 'danger', icon: <Trash2 /> })
    if (!ok) return
    if (!(await stepUp('delete this role'))) return
    try {
      await adminOperations.deleteRole(r.id)
      toast.success('Role deleted')
      loadRoles()
    } catch (e) {
      toast.error('Could not delete', errorMessage(e))
    }
  }

  const duplicate = (r: RoleRow) => {
    setRoleForm({ name: `${r.name} copy`, description: r.description ?? '', permissions: new Set(r.permissions.includes('*') ? catalog.flatMap((m) => m.actions.map((a) => `${m.module}.${a}`)) : r.permissions) })
    setEditing('new')
  }

  const example = (rate: number) => naira(Math.round(10000 * rate) / 100)

  return (
    <AdminLayout perm="settings.view">
      <PageHeader eyebrow="System" title="Settings" description="Fees, roles and permissions, appearance and help." />
      {error ? <Alert className="mb-4">{error}</Alert> : null}

      <Tabs defaultValue="fees">
        <TabsList>
          <TabsTrigger value="fees">Fees and payouts</TabsTrigger>
          <TabsTrigger value="roles">Roles and permissions</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
        </TabsList>

        <TabsContent value="fees">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader icon={<Percent />} title="SportCliq fee rules" description={canEdit ? 'Changes need your authenticator code.' : 'Only admins with settings.edit can change these.'} />
              <CardContent>
                {!settings ? <Loading rows={3} /> : (
                  <div className="space-y-3">
                    <RuleCard icon={<Trophy />} title="Organisers and hosts" hint={<>Matches and rides count together. With these numbers the first {rules.organizer.free_count} paid activities are free, then SportCliq keeps {rules.organizer.rate}%. On a {naira(10000)} activity that is {example(rules.organizer.rate)}.</>}>
                      <NumberField label="Free paid activities" value={rules.organizer.free_count} onChange={(n) => setRules({ ...rules, organizer: { ...rules.organizer, free_count: n } })} disabled={!canEdit} />
                      <NumberField label="Fee after that" suffix="%" max={100} value={rules.organizer.rate} onChange={(n) => setRules({ ...rules, organizer: { ...rules.organizer, rate: n } })} disabled={!canEdit} />
                    </RuleCard>
                    <RuleCard icon={<Building2 />} title="Venues" hint={<>Each venue gets its first {rules.venue.free_count} paid booking(s) free, then SportCliq keeps {rules.venue.rate}%. On a {naira(10000)} booking that is {example(rules.venue.rate)}.</>}>
                      <NumberField label="Free paid bookings" value={rules.venue.free_count} onChange={(n) => setRules({ ...rules, venue: { ...rules.venue, free_count: n } })} disabled={!canEdit} />
                      <NumberField label="Fee after that" suffix="%" max={100} value={rules.venue.rate} onChange={(n) => setRules({ ...rules, venue: { ...rules.venue, rate: n } })} disabled={!canEdit} />
                    </RuleCard>
                    <RuleCard icon={<Handshake />} title="Ambassadors" hint={<>Ambassadors earn this share of SportCliq&apos;s fee on bookings at their venues and on their assigned events. A rate set on an ambassador overrides it.</>}>
                      <NumberField label="Share of SportCliq fee" suffix="%" max={100} value={rules.ambassador.rate} onChange={(n) => setRules({ ...rules, ambassador: { rate: n } })} disabled={!canEdit} />
                    </RuleCard>
                    {canEdit ? <Button onClick={saveRules} loading={saving}><ShieldCheck /> Save fee rules</Button> : null}
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="space-y-4">
              <Alert variant="info" icon={<Lock />}>
                <p className="font-bold">Payouts are manual for now</p>
                <p className="mt-1">The portal is not connected to a transfer service. Cashouts and ambassador payouts are sent from the SportCliq bank account by hand, then recorded here with the transfer reference. Every approval asks for an authenticator code.</p>
              </Alert>
              <Card>
                <CardHeader title="How fees are worked out" />
                <CardContent>
                  <Accordion items={[
                    { id: 'org', title: 'Organiser and host fees', content: 'Every paid match and paid ride is counted per organiser or host in the order they were created. The first ones up to the free count pay nothing. After that the fee applies to paid slots, tickets and ride registrations.' },
                    { id: 'venue', title: 'Venue fees', content: 'Every paid booking is counted per venue in the order it was made. The first ones up to the free count pay nothing. After that the fee applies to each booking amount.' },
                    { id: 'amb', title: 'Ambassador earnings', content: 'An ambassador earns their share of SportCliq\'s fee from bookings at their venues made on or after the assignment start date, and from all paid activity on matches or rides assigned to them.' },
                  ]} />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="roles">
          <Card>
            <CardHeader icon={<ShieldCheck />} title="Roles" description="Built in roles cover most teams. Create your own for anything else." action={canManageRoles ? <Button onClick={() => openRole('new')}><Plus /> New role</Button> : undefined} />
            <CardContent>
              {!roles ? <Loading rows={4} /> : roles.length === 0 ? <EmptyState title="No roles" /> : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {roles.map((r) => (
                    <div key={r.id} className="flex flex-col rounded-3xl bg-muted/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-bold">{r.name}{r.is_system ? <Badge variant="secondary">Built in</Badge> : <Badge variant="violet">Custom</Badge>}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-background px-2.5 py-1 text-xs font-bold"><Users className="h-3.5 w-3.5" />{r.members}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {r.permissions.includes('*') ? <Badge variant="success">Every permission</Badge> : catalog.filter((m) => r.permissions.some((p) => p.startsWith(m.module + '.'))).map((m) => {
                          const n = r.permissions.filter((p) => p.startsWith(m.module + '.')).length
                          const viewOnly = n === 1 && r.permissions.includes(`${m.module}.view`)
                          return <Badge key={m.module} variant={viewOnly ? 'secondary' : 'info'}>{m.label}{viewOnly ? ' (view)' : n === m.actions.length ? ' (full)' : ` (${n})`}</Badge>
                        })}
                      </div>
                      <div className="mt-auto flex justify-end gap-1 pt-3">
                        {canManageRoles ? <Button variant="ghost" size="sm" onClick={() => duplicate(r)}><Copy /> Duplicate</Button> : null}
                        {r.key === 'super_admin' ? null : (
                          <Button variant="ghost" size="sm" onClick={() => openRole(r)}>{canManageRoles ? <><Pencil /> Edit</> : <><Eye /> View</>}</Button>
                        )}
                        {canManageRoles && !r.is_system ? <Button variant="ghost" size="sm" className="text-red-600" onClick={() => deleteRole(r)}><Trash2 /> Delete</Button> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              <CardHeader icon={<KeyRound />} title="Security" />
              <CardContent className="space-y-3 text-sm">
                <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Two factor is required for every admin, every sign in, every payout approval and every delete.</p>
                <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Every action, sign in and page view is kept in the audit log with IP and device.</p>
                <p className="flex items-center gap-2">{settings?.setup_secret_set ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Lock className="h-4 w-4 text-muted-foreground" />} Setup secret {settings?.setup_secret_set ? 'is set' : 'is not set'}. Setup only opens when no active admin exists.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        size="xl"
        icon={<ShieldCheck />}
        title={editing === 'new' ? 'New role' : canManageRoles ? `Edit ${editing?.name ?? ''}` : editing?.name ?? ''}
        description="Tick what this role can do. Any action also turns on View for that area."
        footer={canManageRoles ? <><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveRole} loading={savingRole} disabled={!roleForm.name.trim()}>Save role</Button></> : <Button onClick={() => setEditing(null)}>Close</Button>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Role name" htmlFor="r-name"><Input id="r-name" value={roleForm.name} disabled={!canManageRoles} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} /></Field>
            <Field label="Description" htmlFor="r-desc"><Textarea id="r-desc" className="min-h-11" rows={1} value={roleForm.description} disabled={!canManageRoles} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} /></Field>
          </div>
          {canManageRoles ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="soft" size="sm" onClick={() => preset('read')}><Eye /> View only</Button>
              <Button variant="outline" size="sm" onClick={() => preset('all')}>Everything</Button>
              <Button variant="outline" size="sm" onClick={() => preset('none')}>Clear</Button>
              <span className="ml-auto self-center text-xs font-semibold text-muted-foreground">{roleForm.permissions.size} permissions</span>
            </div>
          ) : null}
          <div className="divide-y overflow-hidden rounded-2xl ring-1 ring-border">
            {catalog.map((m) => {
              const on = m.actions.filter((a) => roleForm.permissions.has(`${m.module}.${a}`)).length
              return (
                <div key={m.module} className="flex flex-col gap-2.5 p-3.5 sm:flex-row sm:items-center">
                  <div className="flex items-center justify-between gap-2 sm:w-52 sm:shrink-0">
                    <span>
                      <span className="block text-sm font-bold">{m.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{on === 0 ? 'No access' : on === m.actions.length ? 'Full access' : roleForm.permissions.has(`${m.module}.view`) && on === 1 ? 'View only' : `${on} of ${m.actions.length}`}</span>
                    </span>
                    {canManageRoles ? <button type="button" onClick={() => setRow(m, on < m.actions.length)} className="cursor-pointer rounded-lg px-2 py-1 text-xs font-bold text-primary hover:bg-playarena-50 dark:hover:bg-playarena-950">{on < m.actions.length ? 'All' : 'None'}</button> : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.actions.map((a) => {
                      const perm = `${m.module}.${a}`
                      const checked = roleForm.permissions.has(perm)
                      return (
                        <label key={a} className={cn('flex cursor-pointer select-none items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3 text-xs font-bold ring-1 transition-colors', checked ? 'bg-playarena-50 text-primary ring-primary/30 dark:bg-playarena-950' : 'bg-background text-muted-foreground ring-border hover:text-foreground', !canManageRoles && 'cursor-default')}>
                          <input type="checkbox" className="peer sr-only" checked={checked} disabled={!canManageRoles} onChange={() => toggle(perm)} aria-label={`${m.label} ${ACTION_LABEL[a] ?? a}`} />
                          <span className={cn('flex h-5 w-5 items-center justify-center rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary', checked ? 'bg-primary text-white' : 'bg-muted')}>{checked ? <Check className="h-3 w-3" /> : null}</span>
                          {ACTION_LABEL[a] ?? a}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Modal>
    </AdminLayout>
  )
}
