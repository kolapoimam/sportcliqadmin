import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function naira(value: number | string | null | undefined) {
  const n = Number(value ?? 0)
  return `₦${(Number.isFinite(n) ? n : 0).toLocaleString()}`
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return 'N/A'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

export function formatDate(value: string | null | undefined) {
  if (!value) return 'N/A'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

export function shortId(id: string | null | undefined) {
  return id ? id.slice(0, 8) : ''
}

export function errorMessage(err: unknown) {
  if (!err) return 'Something went wrong'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return 'Something went wrong'
}

export type DateFilter = 'all' | 'today' | '7days' | '30days' | 'custom'

/** Turn a filter choice into ISO start and end bounds (end is exclusive). */
export function dateBounds(filter: DateFilter, customStart?: string, customEnd?: string) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(startOfToday.getTime() + 86400000)
  switch (filter) {
    case 'today':
      return { start: startOfToday.toISOString(), end: tomorrow.toISOString() }
    case '7days':
      return { start: new Date(startOfToday.getTime() - 6 * 86400000).toISOString(), end: tomorrow.toISOString() }
    case '30days':
      return { start: new Date(startOfToday.getTime() - 29 * 86400000).toISOString(), end: tomorrow.toISOString() }
    case 'custom': {
      const start = customStart ? new Date(`${customStart}T00:00:00`).toISOString() : null
      const end = customEnd ? new Date(new Date(`${customEnd}T00:00:00`).getTime() + 86400000).toISOString() : null
      return { start, end }
    }
    default:
      return { start: null, end: null }
  }
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
