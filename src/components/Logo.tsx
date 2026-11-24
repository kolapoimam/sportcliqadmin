import { cn } from '@/lib/utils'

export const BRAND = {
  mark: '/brand/sportcliq-mark.png',
  logo: '/brand/sportcliq-logo.png',
  logoDark: '/brand/sportcliq-logo-dark.png',
}

/** The SportCliq app mark (green rounded square with the S). */
export function Mark({ className }: { className?: string }) {
  return <img src={BRAND.mark} alt="SportCliq" className={cn('h-9 w-9 select-none object-contain', className)} draggable={false} />
}

/** Full SportCliq logo. Switches to the white text version in dark mode or on dark panels. */
export function Logo({ className, onDark = false }: { className?: string; onDark?: boolean; showText?: boolean }) {
  const img = 'h-9 w-auto select-none object-contain'
  if (onDark) return <img src={BRAND.logoDark} alt="SportCliq" className={cn(img, className)} draggable={false} />
  return (
    <span className={cn('inline-flex items-center', className)}>
      <img src={BRAND.logo} alt="SportCliq" className={cn(img, 'dark:hidden')} draggable={false} />
      <img src={BRAND.logoDark} alt="SportCliq" className={cn(img, 'hidden dark:block')} draggable={false} />
    </span>
  )
}
