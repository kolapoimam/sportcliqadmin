import { LOGO_URL } from '@/lib/supabase'
import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return <img src={LOGO_URL} alt="Sport Cliq" className={cn('h-8 w-auto object-contain', className)} />
}
