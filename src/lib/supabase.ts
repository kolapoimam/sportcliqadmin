import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sportcliq-admin-auth' },
})

export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || window.location.origin
export const MAIN_APP_URL = (import.meta.env.VITE_MAIN_APP_URL as string | undefined) || 'https://sportcliq.com'
export const LOGO_URL = 'https://sportcliq.com/playarenalight.png'
