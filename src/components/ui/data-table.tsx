import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from './page'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** Value used for sorting. Leave out to make the column unsortable. */
  sort?: (row: T) => string | number | null | undefined
  className?: string
  align?: 'left' | 'right'
  /** Hide on the mobile card */
  hideOnMobile?: boolean
  /** Only show on very wide screens */
  wideOnly?: boolean
}

/**
 * Table on medium screens and up, stacked cards on phones (no sideways scrolling).
 * The first column becomes the card title on phones.
 */
export function DataTable<T>({ columns, rows, rowKey, empty, actions, onRowClick }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; empty?: React.ReactNode; actions?: (row: T) => React.ReactNode; onRowClick?: (row: T) => void }) {
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 } | null>(null)

  const sorted = React.useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sort) return rows
    return [...rows].sort((a, b) => {
      const va = col.sort!(a)
      const vb = col.sort!(b)
      if (va == null) return 1
      if (vb == null) return -1
      return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir
    })
  }, [rows, sort, columns])

  if (rows.length === 0) return <>{empty ?? <EmptyState title="Nothing here yet" text="Try another filter or search." />}</>

  const toggle = (c: Column<T>) => {
    if (!c.sort) return
    setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))
  }
  const [first, ...rest] = columns

  return (
    <>
      <div className="-mx-2 hidden md:block">
        <table className="w-full table-auto border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  className={cn('border-b px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground', c.align === 'right' && 'text-right', c.wideOnly && 'hidden 2xl:table-cell', c.className)}
                >
                  {c.sort ? (
                    <button type="button" onClick={() => toggle(c)} className="inline-flex cursor-pointer items-center gap-1 uppercase hover:text-foreground">
                      {c.header}
                      {sort?.key === c.key ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
              {actions ? <th className="border-b px-3 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('group transition-colors hover:bg-muted/60', onRowClick && 'cursor-pointer')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('border-b px-3 py-3.5 align-middle group-last:border-0', c.align === 'right' && 'text-right', c.wideOnly && 'hidden 2xl:table-cell', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
                {actions ? (
                  <td className="border-b px-3 py-3 text-right group-last:border-0" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">{actions(row)}</div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {sorted.map((row) => (
          <div
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn('rounded-2xl bg-muted/50 p-4 ring-1 ring-black/[0.03] dark:ring-white/5', onRowClick && 'cursor-pointer active:scale-[0.99] transition-transform')}
          >
            <div className="min-w-0">{first.cell(row)}</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              {rest
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.header}</dt>
                    <dd className="mt-0.5 break-words">{c.cell(row)}</dd>
                  </div>
                ))}
            </dl>
            {actions ? (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-black/5 pt-3 dark:border-white/10" onClick={(e) => e.stopPropagation()}>{actions(row)}</div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  )
}
