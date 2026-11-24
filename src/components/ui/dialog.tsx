import * as React from 'react'
import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = D.Root

const sizes = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

/**
 * Sleek modal. A bottom sheet on phones, a centred card on larger screens.
 */
export function Modal({
  open, onOpenChange, title, description, icon, size = 'md', footer, children, tone = 'default',
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  size?: keyof typeof sizes
  footer?: React.ReactNode
  children?: React.ReactNode
  tone?: 'default' | 'danger' | 'success'
}) {
  const iconTone = {
    default: 'bg-playarena-50 text-primary dark:bg-playarena-950',
    danger: 'bg-red-50 text-red-600 dark:bg-red-950/60',
    success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60',
  }[tone]
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-gray-950/40 backdrop-blur-[2px] animate-fade-in" />
        <D.Content
          className={cn(
            'fixed z-50 flex max-h-[92dvh] w-full flex-col bg-background shadow-lift outline-none',
            'inset-x-0 bottom-0 rounded-t-[28px] animate-sheet-up',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:animate-zoom-in',
            sizes[size],
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-gray-300 sm:hidden dark:bg-gray-700" />
          <div className="flex items-start gap-3 px-6 pb-2 pt-5">
            {icon ? <span className={cn('rounded-2xl p-2.5 [&_svg]:size-5', iconTone)}>{icon}</span> : null}
            <div className="min-w-0 flex-1 pr-8">
              <D.Title className="text-lg font-bold leading-snug">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>}
            </div>
            <D.Close className="absolute right-4 top-4 cursor-pointer rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:top-5" aria-label="Close">
              <X className="h-4 w-4" />
            </D.Close>
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div> : null}
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">{footer}</div>
          ) : (
            <div className="pb-[max(1rem,env(safe-area-inset-bottom))]" />
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Left slide-in panel used for the mobile menu. */
export function SheetContent({ className, children, ...p }: D.DialogContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-gray-950/40 backdrop-blur-[2px] animate-fade-in" />
      <D.Content className={cn('fixed inset-y-0 left-0 z-50 flex h-full w-[82%] max-w-80 flex-col bg-background shadow-lift outline-none animate-sheet-left', className)} {...p}>
        <D.Title className="sr-only">Menu</D.Title>
        <D.Description className="sr-only">Main navigation</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  )
}
