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

/** Naira amounts. Digits and one decimal point only, shown with thousands separators. */
export function MoneyInput({ value, onChange, id, invalid, className, ...rest }: { value: string; onChange: (v: string) => void; id?: string; invalid?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [focused, setFocused] = React.useState(false)
  const shown = focused || !value ? value : Number(value).toLocaleString('en-NG', { maximumFractionDigits: 2 })
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₦</span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        value={shown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          let t = e.target.value.replace(/[^\d.]/g, '')
          const [a, ...b] = t.split('.')
          t = b.length ? `${a}.${b.join('').slice(0, 2)}` : a
          onChange(t.replace(/^0+(?=\d)/, ''))
        }}
        className={cn('pl-8 font-semibold tabular-nums', invalid && 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/15', className)}
        {...rest}
      />
    </div>
  )
}

/** Phone numbers. Keeps digits and a leading plus. */
export function PhoneInput({ value, onChange, invalid, className, ...rest }: { value: string; onChange: (v: string) => void; invalid?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      maxLength={14}
      placeholder="08012345678"
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/(?!^\+)[^\d]/g, ''))}
      className={cn('tabular-nums', invalid && 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/15', className)}
      {...rest}
    />
  )
}

/**
 * A text box with formatting buttons. Writes simple markdown (bold, italic, headings,
 * bullet and numbered lists, links) that the app shows formatted.
 */
export function RichTextarea({ value, onChange, id, maxLength, placeholder, invalid }: { value: string; onChange: (v: string) => void; id?: string; maxLength?: number; placeholder?: string; invalid?: boolean }) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const wrap = (before: string, after = before, fallback = 'text') => {
    const el = ref.current
    if (!el) return
    const s = el.selectionStart, e = el.selectionEnd
    const sel = value.slice(s, e) || fallback
    const next = value.slice(0, s) + before + sel + after + value.slice(e)
    if (maxLength && next.length > maxLength) return
    onChange(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + sel.length) })
  }
  const prefixLines = (make: (i: number) => string) => {
    const el = ref.current
    if (!el) return
    const s = value.lastIndexOf('\n', el.selectionStart - 1) + 1
    let e = value.indexOf('\n', el.selectionEnd)
    if (e === -1) e = value.length
    const block = value.slice(s, e) || 'Item'
    const next = value.slice(0, s) + block.split('\n').map((l, i) => make(i) + l.replace(/^(\s*([-*]|\d+[.)]|#{1,3})\s+)/, '')).join('\n') + value.slice(e)
    if (maxLength && next.length > maxLength) return
    onChange(next)
    requestAnimationFrame(() => el.focus())
  }
  const link = () => {
    const url = window.prompt('Link address, starting with https://')
    if (!url) return
    if (!/^https:\/\//.test(url)) return window.alert('Use a link that starts with https://')
    wrap('[', `](${url})`, 'link text')
  }
  const tools: { label: string; text: string; run: () => void; cls?: string }[] = [
    { label: 'Bold', text: 'B', run: () => wrap('**'), cls: 'font-extrabold' },
    { label: 'Italic', text: 'I', run: () => wrap('*'), cls: 'italic' },
    { label: 'Heading', text: 'H', run: () => prefixLines(() => '## '), cls: 'font-bold' },
    { label: 'Bullet list', text: '•', run: () => prefixLines(() => '- ') },
    { label: 'Numbered list', text: '1.', run: () => prefixLines((i) => `${i + 1}. `) },
    { label: 'Link', text: 'Link', run: link },
  ]
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-background focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15', invalid && 'border-red-500')}>
      <div className="flex flex-wrap gap-1 border-b bg-muted/40 px-2 py-1.5" role="toolbar" aria-label="Formatting">
        {tools.map((t) => (
          <button key={t.label} type="button" onClick={t.run} aria-label={t.label} title={t.label} className={cn('h-8 min-w-8 rounded-lg px-2 text-xs text-foreground hover:bg-background cursor-pointer', t.cls)}>{t.text}</button>
        ))}
      </div>
      <textarea ref={ref} id={id} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="block min-h-32 w-full resize-y bg-transparent px-3.5 py-3 text-sm outline-none placeholder:text-muted-foreground" />
      {maxLength ? <p className="border-t px-3.5 py-1.5 text-right text-[11px] text-muted-foreground tabular-nums">{value.length}/{maxLength}</p> : null}
    </div>
  )
}
