import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, ShieldCheck, X, XCircle } from 'lucide-react'
import { stepUp as verifyStepUp } from '@/lib/mfa'
import { Modal } from './dialog'
import { Button } from './button'
import { CodeInput, Field, Textarea } from './input'
import { cn } from '@/lib/utils'

// ---------------- Toasts ----------------

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem { id: number; kind: ToastKind; title: string; text?: string }

const ToastCtx = React.createContext<{ push: (t: Omit<ToastItem, 'id'>) => void } | null>(null)

export function useToast() {
  const ctx = React.useContext(ToastCtx)
  return React.useMemo(
    () => ({
      success: (title: string, text?: string) => ctx?.push({ kind: 'success', title, text }),
      error: (title: string, text?: string) => ctx?.push({ kind: 'error', title, text }),
      info: (title: string, text?: string) => ctx?.push({ kind: 'info', title, text }),
    }),
    [ctx],
  )
}

// ---------------- Confirm ----------------

export interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  tone?: 'danger' | 'default' | 'success'
  icon?: React.ReactNode
  /** Ask for a text reason. Required unless reasonOptional is true. */
  reasonLabel?: string
  reasonOptional?: boolean
}
type ConfirmResult = { ok: boolean; reason: string }

const ConfirmCtx = React.createContext<((o: ConfirmOptions) => Promise<ConfirmResult>) | null>(null)

const StepUpCtx = React.createContext<((purpose: string) => Promise<boolean>) | null>(null)

/**
 * Asks for a fresh authenticator code before a payout approval or delete.
 * const stepUp = useStepUp(); if (!(await stepUp('Approve payout'))) return
 */
export function useStepUp() {
  const fn = React.useContext(StepUpCtx)
  if (!fn) throw new Error('useStepUp needs FeedbackProvider')
  return fn
}

/** const confirm = useConfirm(); const { ok, reason } = await confirm({...}) */
export function useConfirm() {
  const fn = React.useContext(ConfirmCtx)
  if (!fn) throw new Error('useConfirm needs FeedbackProvider')
  return fn
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const [confirmState, setConfirmState] = React.useState<(ConfirmOptions & { resolve: (r: ConfirmResult) => void }) | null>(null)
  const [reason, setReason] = React.useState('')
  const [stepState, setStepState] = React.useState<{ purpose: string; resolve: (ok: boolean) => void } | null>(null)
  const [code, setCode] = React.useState('')
  const [stepError, setStepError] = React.useState<string | null>(null)
  const [verifying, setVerifying] = React.useState(false)

  const stepUp = React.useCallback(
    (purpose: string) =>
      new Promise<boolean>((resolve) => {
        setCode('')
        setStepError(null)
        setStepState({ purpose, resolve })
      }),
    [],
  )

  const closeStep = (ok: boolean) => {
    stepState?.resolve(ok)
    setStepState(null)
  }

  const submitCode = async (c: string) => {
    if (c.length !== 6) return
    setVerifying(true)
    setStepError(null)
    try {
      await verifyStepUp(c)
      closeStep(true)
    } catch (e) {
      setStepError(e instanceof Error ? (/invalid/i.test(e.message) ? 'That code is wrong or expired. Try the new one.' : e.message) : 'Could not verify the code')
      setCode('')
    } finally {
      setVerifying(false)
    }
  }

  const push = React.useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list.slice(-3), { ...t, id }])
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.kind === 'error' ? 6000 : 3500)
  }, [])

  const confirm = React.useCallback(
    (o: ConfirmOptions) =>
      new Promise<ConfirmResult>((resolve) => {
        setReason('')
        setConfirmState({ ...o, resolve })
      }),
    [],
  )

  const close = (ok: boolean) => {
    confirmState?.resolve({ ok, reason: reason.trim() })
    setConfirmState(null)
  }

  const needsReason = Boolean(confirmState?.reasonLabel && !confirmState.reasonOptional)
  const tone = confirmState?.tone ?? 'default'
  const defaultIcon = tone === 'danger' ? <AlertTriangle /> : tone === 'success' ? <CheckCircle2 /> : <Info />

  return (
    <ToastCtx.Provider value={{ push }}>
      <ConfirmCtx.Provider value={confirm}>
      <StepUpCtx.Provider value={stepUp}>
        {children}
        <Modal
          open={Boolean(stepState)}
          onOpenChange={(o) => !o && closeStep(false)}
          size="sm"
          icon={<ShieldCheck />}
          title="Confirm with your authenticator"
          description={<>Enter the 6 digit code from the <b>SportCliq Admin</b> entry in Google Authenticator to {stepState?.purpose.toLowerCase()}.</>}
          footer={
            <>
              <Button variant="outline" onClick={() => closeStep(false)}>Cancel</Button>
              <Button onClick={() => submitCode(code)} loading={verifying} disabled={code.length !== 6}>Verify</Button>
            </>
          }
        >
          <CodeInput value={code} onChange={setCode} onComplete={submitCode} disabled={verifying} />
          {stepError ? <p className="mt-2 text-center text-sm font-medium text-red-600">{stepError}</p> : null}
        </Modal>
        <Modal
          open={Boolean(confirmState)}
          onOpenChange={(o) => !o && close(false)}
          size="sm"
          tone={tone}
          icon={confirmState?.icon ?? defaultIcon}
          title={confirmState?.title ?? ''}
          description={confirmState?.description}
          footer={
            <>
              <Button variant="outline" onClick={() => close(false)}>{confirmState?.cancelText ?? 'Cancel'}</Button>
              <Button
                variant={tone === 'danger' ? 'destructive' : 'default'}
                disabled={needsReason && !reason.trim()}
                onClick={() => close(true)}
                autoFocus={!confirmState?.reasonLabel}
              >
                {confirmState?.confirmText ?? 'Confirm'}
              </Button>
            </>
          }
        >
          {confirmState?.reasonLabel ? (
            <Field label={confirmState.reasonLabel + (confirmState.reasonOptional ? ' (optional)' : '')} htmlFor="confirm-reason">
              <Textarea id="confirm-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
          ) : null}
        </Modal>
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl bg-gray-950 p-4 text-white shadow-lift animate-toast-in dark:bg-white dark:text-gray-950">
              <span className={cn('mt-0.5', t.kind === 'success' ? 'text-emerald-400 dark:text-emerald-600' : t.kind === 'error' ? 'text-red-400 dark:text-red-600' : 'text-sky-400 dark:text-sky-600')}>
                {t.kind === 'success' ? <CheckCircle2 className="h-5 w-5" /> : t.kind === 'error' ? <XCircle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.text ? <p className="mt-0.5 text-xs opacity-75">{t.text}</p> : null}
              </div>
              <button type="button" aria-label="Dismiss" className="cursor-pointer rounded-full p-1 opacity-60 hover:opacity-100" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </StepUpCtx.Provider>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}

// ---------------- Inline alert ----------------

export function Alert({ variant = 'error', className, children, icon }: { variant?: 'error' | 'success' | 'warning' | 'info'; className?: string; children: React.ReactNode; icon?: React.ReactNode }) {
  const styles = {
    error: 'bg-red-50 text-red-800 ring-red-600/15 dark:bg-red-950/50 dark:text-red-200',
    success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/15 dark:bg-emerald-950/50 dark:text-emerald-200',
    warning: 'bg-amber-50 text-amber-900 ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-100',
    info: 'bg-sky-50 text-sky-900 ring-sky-600/15 dark:bg-sky-950/50 dark:text-sky-100',
  }[variant]
  const Icon = variant === 'success' ? CheckCircle2 : variant === 'info' ? Info : AlertTriangle
  return (
    <div role="alert" className={cn('flex items-start gap-3 rounded-2xl p-4 text-sm ring-1', styles, className)}>
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon ?? <Icon />}</span>
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
    </div>
  )
}
