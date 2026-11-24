import * as S from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Option {
  value: string
  label: string
}

/** Radix does not allow an empty string value, so use 'all' for "no filter". */
export function Select({ value, onValueChange, options, placeholder, className, ariaLabel, disabled, icon }: { value: string; onValueChange: (v: string) => void; options: Option[]; placeholder?: string; className?: string; ariaLabel?: string; disabled?: boolean; icon?: React.ReactNode }) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-background px-3.5 text-left text-sm transition-colors hover:border-gray-300 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:opacity-50 data-[placeholder]:text-muted-foreground dark:hover:border-gray-600 cursor-pointer',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {icon ? <span className="text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={6} className="z-[70] max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-2xl bg-background p-1 shadow-lift ring-1 ring-black/5 animate-fade-in dark:ring-white/10">
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-xl py-2.5 pl-9 pr-3 text-sm outline-none data-[highlighted]:bg-muted data-[state=checked]:font-semibold"
              >
                <S.ItemIndicator className="absolute left-3">
                  <Check className="h-4 w-4 text-primary" />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
