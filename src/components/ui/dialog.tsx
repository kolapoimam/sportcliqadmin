import * as React from 'react'
import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({ className, children, ...p }: D.DialogContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-white p-6 shadow-xl dark:bg-gray-800',
          className,
        )}
        {...p}
      >
        {children}
        <D.Close className="absolute right-4 top-4 rounded-md p-1 opacity-70 hover:opacity-100" aria-label="Close">
          <X className="h-4 w-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  )
}
export function DialogHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1 pr-6', className)} {...p} />
}
export function DialogFooter({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...p} />
}
export function DialogTitle({ className, ...p }: D.DialogTitleProps) {
  return <D.Title className={cn('text-lg font-semibold', className)} {...p} />
}
export function DialogDescription({ className, ...p }: D.DialogDescriptionProps) {
  return <D.Description className={cn('text-sm text-muted-foreground', className)} {...p} />
}

/** Sheet built on the same dialog primitive, slides in from the left */
export function SheetContent({ className, children, ...p }: D.DialogContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <D.Content className={cn('fixed inset-y-0 left-0 z-50 h-full w-72 bg-white shadow-xl dark:bg-gray-800', className)} {...p}>
        <D.Title className="sr-only">Menu</D.Title>
        {children}
      </D.Content>
    </D.Portal>
  )
}
