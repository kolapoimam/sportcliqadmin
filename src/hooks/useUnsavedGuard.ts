import { useEffect } from 'react'
import { useConfirm } from '@/components/ui/feedback'

/**
 * Asks before throwing away unsaved changes in a form dialog, and warns
 * before the tab is closed while there are changes.
 */
export function useUnsavedGuard(dirty: boolean) {
  const confirm = useConfirm()
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
  return async (close: () => void) => {
    if (!dirty) return close()
    const { ok } = await confirm({ title: 'Discard your changes?', description: 'What you typed in this form has not been saved.', confirmText: 'Discard', cancelText: 'Keep editing', tone: 'danger' })
    if (ok) close()
  }
}
