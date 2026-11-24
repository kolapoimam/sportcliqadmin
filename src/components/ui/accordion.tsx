import * as A from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'

/** Single open accordion: opening one item closes the others. */
export function Accordion({ items }: { items: { id: string; title: string; content: React.ReactNode }[] }) {
  return (
    <A.Root type="single" collapsible className="divide-y rounded-2xl border">
      {items.map((it) => (
        <A.Item key={it.id} value={it.id}>
          <A.Header>
            <A.Trigger className="group flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-semibold hover:bg-muted/50">
              {it.title}
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </A.Trigger>
          </A.Header>
          <A.Content className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{it.content}</A.Content>
        </A.Item>
      ))}
    </A.Root>
  )
}
