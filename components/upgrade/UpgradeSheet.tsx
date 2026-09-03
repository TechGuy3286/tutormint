'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { X, Lock, ShieldAlert, BadgeCheck } from 'lucide-react'
import type { Gate } from '@/lib/gate'

// The one answer to "you cannot do that yet".
//
// Every gated action on the platform ends here: apply, initiate a message, see
// a contact number, hire, or run out of a monthly allowance. Before this there
// was a different toast per route, which meant the member got a sentence and no
// way to act on it -- and, on the buttons that were simply disabled, not even
// the sentence.
//
// THIS IS THE ONLY PLACE A PRICE APPEARS outside /tutor/packages and
// /parent/packages, and it is only ever rendered in response to an action the
// member took. It is never mounted speculatively, never rendered on a public
// page at load, and carries no price until the server sends one in a 403.
//
// A SUSPENDED MEMBER NEVER SEES AN UPSELL. `gate.kind === 'suspended'` renders
// the suspension state with a support link and no plan card, because suspension
// is not something a purchase fixes and pricing it would be a lie.
//
// Mobile is a bottom sheet, desktop a centred modal: the same component, laid
// out by breakpoint, because the decision it presents is identical.

export default function UpgradeSheet({ gate, onClose }: { gate: Gate; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Focus moves into the sheet so a keyboard or screen-reader user is not left
  // behind on the button that opened it.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab') return
      // Trap: a dialog the tab key can walk out of is a dialog that has not
      // really taken over.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    // The page behind must not scroll under a bottom sheet.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const suspended = gate.kind === 'suspended'
  const Icon = suspended ? ShieldAlert : gate.plan ? BadgeCheck : Lock

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-tm-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-sheet-title"
        className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-lg sm:rounded-3xl sm:p-6"
      >
        {/* Grab handle: the affordance that says "this slides away", on mobile only. */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 sm:hidden" aria-hidden />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                suspended ? 'bg-tm-tint-red text-tm-red' : 'bg-tm-tint-navy text-tm-navy'
              }`}
            >
              <Icon size={18} aria-hidden />
            </span>
            <h2 id="upgrade-sheet-title" className="text-base font-black leading-tight text-tm-navy">
              {gate.title}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:text-tm-navy"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-700">{gate.body}</p>

        {/* The plan card. Absent entirely when no purchase is involved, which
            is what keeps a suspension notice from reading as a sales page. */}
        {gate.plan && (
          <div className="mt-4 rounded-2xl border border-tm-navy/15 bg-tm-tint-navy p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-black text-tm-navy">{gate.plan.name}</p>
              <p className="text-sm font-black text-tm-red">
                Rs {gate.plan.pricePkr.toLocaleString('en-PK')}
                <span className="text-[11px] font-bold text-slate-700"> / month</span>
              </p>
            </div>
            {gate.plan.displayedQuota && (
              <p className="mt-1 text-[11px] font-semibold text-tm-navy">
                {gate.plan.displayedQuota}{' '}
                {gate.audience === 'parent' ? 'job posts a month' : 'applications a month'}
              </p>
            )}
          </div>
        )}

        {/* The comparison, once, keyed on audience rather than pasted into ten
            gate bodies -- ten copies is ten places for the number to drift.
            Shown only when something is actually being sold: a suspension
            notice or a "verify your CNIC" prompt has no price to compare, and
            putting an academy's cut on one would read as a sales pitch aimed
            at somebody who has just been told their account is closed.

            WORDING RULE: visibility, never "we will get you tuitions". */}
        {gate.plan && (gate.kind === 'upgrade' || gate.kind === 'quota') && (
          <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
            {gate.audience === 'parent' ? (
              <>
                An academy takes half your first month&apos;s fee — on a Rs 20,000 tuition that is
                Rs 10,000. TutorMint takes nothing from the fee. Memberships are not refundable.
              </>
            ) : (
              <>
                A boosted post in one city costs more in a week than this does in a month, and an
                academy keeps half your first month. This puts you in front of parents already
                searching for your subject in your area. Memberships are not refundable.
              </>
            )}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          {gate.actionable && (
            <Link
              href={gate.href}
              onClick={onClose}
              className={`flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-4 text-xs font-bold text-white ${
                suspended ? 'bg-tm-black' : 'bg-tm-red hover:bg-tm-red-hover'
              }`}
            >
              {gate.ctaLabel}
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-slate-700"
          >
            {gate.actionable ? 'Not now' : 'Close'}
          </button>
        </div>

        {/* No-refunds is stated wherever money is, so nobody meets it first at
            checkout. Only when a price is actually on screen. */}
        {gate.plan && (
          <p className="mt-3 text-center text-[10px] text-gray-500">
            Plans run for 30 days. No refunds — see{' '}
            <Link href="/terms" className="underline">
              Terms
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  )
}
