'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'

// The one toast on the platform.
//
// WHY IT EXISTS. Every mutation used to confirm itself its own way, or not at
// all: a green line that stayed until the next render here, a silent
// router.refresh() there, an error swallowed somewhere else. A member could not
// tell a save that worked from one that did nothing. One component, one place,
// wired to every mutation — success in green, failure in red WITH THE REASON.
//
// PLACEMENT. Bottom-centre on a phone (thumb reach, out of the way of the
// sticky action bars), bottom-right on a laptop. Fixed, above everything.
//
// ANNOUNCED. Each toast carries role="status" (success) or role="alert"
// (error), inside an aria-live region, so a screen-reader user hears the same
// confirmation a sighted one sees. The dismiss control is a full 44px target.
//
// AUTO-CLEARS. Success after 4s, error after 7s (a reason needs longer to
// read); either can be dismissed sooner. Hovering pauses the timer, so a toast
// is not snatched away mid-read.

export type ToastKind = 'success' | 'error'
type Toast = { id: number; kind: ToastKind; message: string }

type ToastApi = {
  toast: (kind: ToastKind, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** Never throws when used outside a provider — degrades to a no-op. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  const noop = useRef<ToastApi>({ toast: () => {}, success: () => {}, error: () => {} })
  return ctx ?? noop.current
}

const DURATION: Record<ToastKind, number> = { success: 4000, error: 7000 }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const arm = useCallback(
    (id: number, kind: ToastKind) => {
      const timer = setTimeout(() => dismiss(id), DURATION[kind])
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  const toast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++
      // Cap the stack: three at once is plenty, and an unbounded pile from a
      // loop of failures would cover the page.
      setToasts((prev) => [...prev.slice(-2), { id, kind, message }])
      arm(id, kind)
    },
    [arm],
  )

  const api: ToastApi = {
    toast,
    success: (m) => toast('success', m),
    error: (m) => toast('error', m),
  }

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((t) => clearTimeout(t))
      map.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            onDismiss={() => dismiss(t.id)}
            onPause={() => {
              const timer = timers.current.get(t.id)
              if (timer) clearTimeout(timer)
            }}
            onResume={() => arm(t.id, t.kind)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({
  toast,
  onDismiss,
  onPause,
  onResume,
}: {
  toast: Toast
  onDismiss: () => void
  onPause: () => void
  onResume: () => void
}) {
  const success = toast.kind === 'success'
  return (
    <div
      role={success ? 'status' : 'alert'}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border p-3 shadow-lg ${
        success
          ? 'border-tm-green-deep/20 bg-tm-tint-green text-tm-green-deep'
          : 'border-tm-red/20 bg-tm-tint-red text-tm-red-hover'
      }`}
    >
      {success ? (
        <CheckCircle2 aria-hidden size={16} className="mt-0.5 shrink-0" />
      ) : (
        <AlertCircle aria-hidden size={16} className="mt-0.5 shrink-0" />
      )}
      <p className="min-w-0 flex-1 text-xs font-semibold leading-relaxed">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-tm-black/5"
      >
        <X aria-hidden size={15} />
      </button>
    </div>
  )
}
