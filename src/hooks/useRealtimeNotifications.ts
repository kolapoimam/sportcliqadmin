import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { adminOperations, isAdminAlert, type AdminNotification } from '@/lib/adminOperations'

const LIMIT = 10

/** Latest 10 admin alerts, kept live with a Supabase Realtime subscription on INSERT. */
export function useRealtimeNotifications(onInsert?: (n: AdminNotification) => void) {
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const onInsertRef = useRef(onInsert)
  useEffect(() => {
    onInsertRef.current = onInsert
  }, [onInsert])

  useEffect(() => {
    let active = true
    adminOperations
      .getNotifications({ limit: 50, alertsOnly: true })
      .then((rows) => active && setNotifications(rows.slice(0, LIMIT)))
      .catch((e) => console.error('Failed to load notifications', e))

    const channel = supabase
      .channel(`admin-notifications-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const n = payload.new as AdminNotification
        if (!isAdminAlert(n)) return
        setNotifications((prev) => [n, ...prev.filter((p) => p.id !== n.id)].slice(0, LIMIT))
        onInsertRef.current?.(n)
      })
      .subscribe((status, err) => {
        if (err || status === 'CHANNEL_ERROR') console.error('Notification subscription error', err ?? status)
      })

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, unread: false } : n)))
    try {
      await adminOperations.markNotificationRead(id)
    } catch (e) {
      console.error('Failed to mark notification as read', e)
    }
  }, [])

  const unreadCount = notifications.filter((n) => n.unread !== false).length
  return { notifications, unreadCount, markRead }
}
