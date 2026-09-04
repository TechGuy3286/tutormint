'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

// The one confirmation dialog on the platform.
//
// Every action that cannot be undone asks first: removing a document,
// withdrawing an application, deleting a child, closing a tuition, blocking
// someone, signing out of all devices. `useConfirm()` returns a function that
// resolves true or false, so a handler reads as:
//
//   if (!(await confirm({ title: 'Withdraw application?', ... }))) return
//
// ACCESSIBILITY. role="dialog" aria-modal, labelled by its title. Escape and a
// backdrop click both cancel. Focus moves into the dialog on open (to Cancel,
// deliberately — a destructive action should never be one stray Enter away)
// and returns to the trigger on close. Tab is trapped inside while it is open.
//
// The confirm button is tm-red for a destructive action; a non-destructive
// confirmation (rare) uses navy.

export type ConfirmOptions = {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive (red) by default — this dialog exists for destructive actions. */
  destructive?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  const fallback = useRef<ConfirmFn>(async () => true)
  return ctx ?? fallback.current
}

type Pending = { options: ConfirmOptions; resolve: (value: boolean) => void }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null
    return new Promise<boolean>((resolve) => setPending({ options, resolve }))
  }, [])

  const settle = useCallback(
    (value: boolean) => {
      pending?.resolve(value)
      setPending(null)
      // Return focus to whatever opened the dialog.
      requestAnimationFrame(() => triggerRef.current?.focus?.())
    },
    [pending],
  )

  useEffect(() => {
    if (!pending) return
    // Focus Cancel once the dialog is in the DOM.
    requestAnimationFrame(() => cancelRef.current?.focus())

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        settle(false)
        return
      }
      if (e.key === 'Tab') {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        )
        if (!focusables || focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending, settle])

  const destructive = pending?.options.destructive !== false

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-tm-black/50 p-4 sm:items-center"
          onClick={() => settle(false)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-start gap-2.5">
              {destructive && (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-tm-tint-red">
                  <AlertTriangle aria-hidden size={18} className="text-tm-red" />
                </span>
              )}
              <div className="min-w-0 space-y-1">
                <h2 id="confirm-title" className="text-sm font-black text-tm-navy">
                  {pending.options.title}
                </h2>
                {pending.options.body && (
                  <p className="text-xs leading-relaxed text-gray-600">{pending.options.body}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => settle(false)}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
              >
                {pending.options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-xs font-bold text-white ${
                  destructive ? 'bg-tm-red hover:bg-tm-red-hover' : 'bg-tm-navy hover:bg-tm-navy-hover'
                }`}
              >
                {pending.options.confirmLabel ?? (destructive ? 'Remove' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
