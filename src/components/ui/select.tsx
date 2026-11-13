import * as S from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Option {
  value: string
  label: string
}

/** Simple select. Radix does not allow an empty string value, so use 'all' for "no filter". */
export function Select({ value, onValueChange, options, placeholder, className, ariaLabel, disabled }: { value: string; onValueChange: (v: string) => void; options: Option[]; placeholder?: string; className?: string; ariaLabel?: string; disabled?: boolean }) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 dark:bg-gray-900',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="z-[60] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border bg-white shadow-lg dark:bg-gray-800">
          <S.Viewport className="p-1">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-gray-700"
              >
                <S.ItemIndicator className="absolute left-2">
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
