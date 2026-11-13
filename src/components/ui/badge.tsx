import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold [&_svg]:size-3', {
  variants: {
    variant: {
      default: 'bg-primary text-white',
      secondary: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100',
      destructive: 'bg-red-600 text-white',
      outline: 'border text-foreground',
      success: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
      warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
      danger: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
      info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Badge({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...p} />
}
