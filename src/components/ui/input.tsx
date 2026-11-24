import * as React from 'react'
import { Eye, EyeOff, Search, X } from 'lucide-react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

const base =
  'w-full rounded-xl border bg-background px-3.5 text-sm transition-colors placeholder:text-muted-foreground hover:border-gray-300 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:opacity-50 dark:hover:border-gray-600'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(base, 'h-11', className)} {...props} />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(base, 'min-h-28 py-3', className)} {...props} />
))
Textarea.displayName = 'Textarea'

export function DatePicker({ value, onChange, label, className, ...rest }: { value: string; onChange: (v: string) => void; label?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <Input type="date" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={className} {...rest} />
}

export function SearchInput({ value, onChange, placeholder = 'Search', className, label }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        aria-label={label ?? placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(base, 'h-11 pl-10 pr-9 [&::-webkit-search-cancel-button]:hidden')}
      />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted cursor-pointer">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function Field({ label, children, htmlFor, hint, error, className }: { label: string; children: React.ReactNode; htmlFor?: string; hint?: React.ReactNode; error?: string | null; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-gray-700 dark:text-gray-300">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full bg-gray-300 transition-colors data-[state=checked]:bg-primary disabled:opacity-50 dark:bg-gray-700"
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  )
}

/** Password field with a show or hide button. */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { icon?: React.ReactNode }>(({ className, icon, ...props }, ref) => {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative">
      {icon ? <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
      <input ref={ref} type={show ? 'text' : 'password'} className={cn(base, 'h-11 pr-11', icon ? 'pl-10' : '', className)} {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
})
PasswordInput.displayName = 'PasswordInput'

/** Six digit authenticator code input. Calls onComplete when six digits are in. */
export function CodeInput({ value, onChange, onComplete, autoFocus = true, disabled }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean; disabled?: boolean }) {
  return (
    <input
      aria-label="6 digit code from your authenticator app"
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      disabled={disabled}
      maxLength={6}
      placeholder="000000"
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 6)
        onChange(v)
        if (v.length === 6) onComplete?.(v)
      }}
      className={cn(base, 'h-16 text-center font-mono text-3xl font-bold tracking-[0.5em] placeholder:tracking-[0.5em] placeholder:text-gray-300 dark:placeholder:text-gray-700')}
    />
  )
}
