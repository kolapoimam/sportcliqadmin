import * as React from 'react'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  className?: string
  /** Hide this column on the mobile card view */
  hideOnMobile?: boolean
  /** Only show this column on very wide screens (the details dialog still has it) */
  wideOnly?: boolean
}

/**
 * Shows a normal table on medium screens and up.
 * On small screens each row becomes a card, so there is no sideways scrolling.
 */
export function DataTable<T>({ columns, rows, rowKey, empty = 'No records found', actions }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; empty?: string; actions?: (row: T) => React.ReactNode }) {
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-auto text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              {columns.map((c) => (
                <th key={c.key} className={cn('px-3 py-3 font-semibold', c.wideOnly && 'hidden 2xl:table-cell', c.className)}>
                  {c.header}
                </th>
              ))}
              {actions ? <th className="px-3 py-3 text-right font-semibold">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                {columns.map((c) => (
                  <td key={c.key} className={cn('break-words px-3 py-3 align-middle', c.wideOnly && 'hidden 2xl:table-cell', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
                {actions ? (
                  <td className="px-3 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-1">{actions(row)}</div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <div key={rowKey(row)} className="rounded-lg border p-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <React.Fragment key={c.key}>
                    <dt className="text-muted-foreground">{c.header}</dt>
                    <dd className="min-w-0 break-words text-right">{c.cell(row)}</dd>
                  </React.Fragment>
                ))}
            </dl>
            {actions ? <div className="mt-3 flex flex-wrap justify-end gap-2 border-t pt-3">{actions(row)}</div> : null}
          </div>
        ))}
      </div>
    </>
  )
}
