import { Bell, Calendar, DollarSign, ShieldCheck, Users } from 'lucide-react'
import { Logo } from './Logo'

const features = [
  { icon: Users, title: 'User Management', text: 'Find players, organizers and hosts in seconds.' },
  { icon: Calendar, title: 'Event Management', text: 'Edit, cancel and track every match and ride.' },
  { icon: DollarSign, title: 'Financial Oversight', text: 'Approve payouts and watch revenue live.' },
  { icon: ShieldCheck, title: 'System Settings', text: 'Admins, roles, venues and commission.' },
  { icon: Bell, title: 'Notification Center', text: 'Real time alerts and user messaging.' },
]

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <section className="relative hidden w-[46%] overflow-hidden bg-[#0B1410] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-y-0 left-0 w-2 bg-[#35B551]" />
        <div className="relative flex items-center gap-3">
          <Logo onDark className="h-12" />
          <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#0B1410]">Admin</span>
        </div>
        <div className="relative mt-auto">
          <h2 className="max-w-md text-4xl font-extrabold leading-[1.1] tracking-tight">
            Run every match, venue and <span className="text-playarena-400">payout</span> from one place.
          </h2>
          <ul className="mt-10 space-y-2">
            {features.map((f) => (
              <li key={f.title} className="flex items-center gap-4 rounded-2xl p-3 transition-colors hover:bg-white/[0.06]">
                <span className="rounded-xl bg-white/10 p-2.5 text-playarena-300 ring-1 ring-white/10"><f.icon className="h-5 w-5" /></span>
                <span>
                  <span className="block font-bold">{f.title}</span>
                  <span className="block text-sm text-white/60">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="relative flex flex-1 items-center justify-center bg-canvas px-4 py-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex justify-center lg:hidden"><Logo className="[&_img]:h-11" /></div>
          {children}
        </div>
      </section>
    </div>
  )
}
