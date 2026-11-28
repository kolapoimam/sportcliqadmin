// Field checks shared by every admin form. Each returns an error message, or null when the value is fine.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const v = {
  required: (s: string, label = 'This field') => (s.trim() ? null : `${label} is required`),
  email: (s: string, optional = true) => (!s.trim() ? (optional ? null : 'Email is required') : EMAIL_RE.test(s.trim()) ? null : 'Enter a valid email, like name@example.com'),
  /** Nigerian numbers: 11 digits starting with 0, or +234 and 10 digits */
  phone: (s: string, optional = true) => {
    const t = s.replace(/[\s-]/g, '')
    if (!t) return optional ? null : 'Phone number is required'
    return /^0\d{10}$/.test(t) || /^\+234\d{10}$/.test(t) ? null : 'Use 11 digits like 08012345678, or +234 and 10 digits'
  },
  url: (s: string, optional = true) => {
    if (!s.trim()) return optional ? null : 'Link is required'
    try { const u = new URL(s.trim()); return u.protocol === 'https:' ? null : 'Use a secure link that starts with https://' } catch { return 'Enter a full link that starts with https://' }
  },
  money: (s: string, opts: { optional?: boolean; min?: number; max?: number } = {}) => {
    const t = s.replace(/,/g, '').trim()
    if (!t) return opts.optional === false ? 'Amount is required' : null
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'Enter an amount in naira, like 2500 or 2500.50'
    const n = Number(t)
    if (opts.min != null && n < opts.min) return `Must be at least ₦${opts.min.toLocaleString('en-NG')}`
    if (opts.max != null && n > opts.max) return `Must be no more than ₦${opts.max.toLocaleString('en-NG')}`
    return null
  },
  int: (s: string, opts: { optional?: boolean; min?: number; max?: number; label?: string } = {}) => {
    const t = s.trim()
    if (!t) return opts.optional === false ? `${opts.label ?? 'This number'} is required` : null
    if (!/^\d+$/.test(t)) return 'Use whole numbers only'
    const n = Number(t)
    if (opts.min != null && n < opts.min) return `Must be at least ${opts.min}`
    if (opts.max != null && n > opts.max) return `Must be no more than ${opts.max}`
    return null
  },
  percent: (s: string) => {
    if (!s.trim()) return null
    const n = Number(s)
    return Number.isFinite(n) && n >= 0 && n <= 100 ? null : 'Use a percentage from 0 to 100'
  },
  accountNumber: (s: string, optional = true) => (!s ? (optional ? null : 'Account number is required') : /^\d{10}$/.test(s) ? null : 'NUBAN account numbers have 10 digits'),
  name: (s: string, label = 'Name', optional = false) => {
    if (!s.trim()) return optional ? null : `${label} is required`
    return /^[\p{L}' .-]{2,60}$/u.test(s.trim()) ? null : `${label} can use letters, spaces, apostrophes and hyphens`
  },
  date: (s: string, opts: { optional?: boolean; notPast?: boolean } = {}) => {
    if (!s) return opts.optional === false ? 'Pick a date' : null
    const d = new Date(`${s}T00:00:00`)
    if (isNaN(d.getTime())) return 'Pick a valid date'
    if (opts.notPast) { const t = new Date(); t.setHours(0, 0, 0, 0); if (d < t) return 'Pick today or a later date' }
    return null
  },
  time: (s: string, optional = true) => (!s ? (optional ? null : 'Pick a time') : /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? null : 'Pick a valid time'),
}

/** The first error of a set, keyed by field. Empty object means the form is valid. */
export function check<T extends Record<string, string | null>>(errors: T) {
  const out: Partial<Record<keyof T, string>> = {}
  for (const k of Object.keys(errors) as (keyof T)[]) if (errors[k]) out[k] = errors[k] as string
  return out
}
