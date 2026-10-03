'use client'

import { useRef, useState } from 'react'
import { BadgeCheck, Check } from 'lucide-react'

import { verificationFeeCardState } from '@/lib/tutorDashboard'
import VerifyBenefitsDialog from '@/components/tutor/VerifyBenefitsDialog'

// The tutor's own dashboard verification control (PR106-D §2.4/§3). After the
// name it shows one of:
//   • verified (fee paid + docs approved) → the GREEN CHECK only, no "Verified"
//     text; tapping opens the benefits pop-up.
//   • fee paid, docs pending → a "Verification pending" chip; taps open the pop-up.
//   • fee not paid → a "Get verified" chip; taps open the pop-up with a
//     "Pay verification fee" button to the payment page.
//
// The pop-up itself is VerifyBenefitsDialog (PR106-G4b extracted it so the new
// onboarding's "What do I get?" opens the same one) — three benefit lines with
// real done/pending ticks + the spam-prevention line, English + Urdu, NO amount.

export default function VerifyBadgeControl({
  feePaid,
  verifiedOk,
  verificationPending,
  findable,
  payHref,
}: {
  feePaid: boolean
  /** Staff approved CNIC + photo + selfie (the Verified badge is earned). */
  verifiedOk: boolean
  /** Fee paid but documents not all approved yet. */
  verificationPending: boolean
  /** Profile is 100% complete and approved (the "findable on Google" line). */
  findable: boolean
  /** Where "Pay verification fee" goes (the verify flow → payment page). */
  payHref: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const state = verificationFeeCardState({ feePaid, verifiedOk, findable })

  const trigger =
    verifiedOk ? (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Verified — see what your verification gives you"
        className="inline-flex items-center align-middle"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full bg-tm-green-deep text-white">
          <Check size={13} strokeWidth={3} aria-hidden />
        </span>
      </button>
    ) : verificationPending ? (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex flex-col rounded-full bg-tm-tint-gold px-2.5 py-0.5 align-middle leading-none text-tm-gold-ink"
      >
        <span className="text-[11px] font-bold leading-none">Verification pending</span>
        <span lang="ur" dir="rtl" className="mt-0.5 text-[10px] font-semibold leading-none opacity-90">تصدیق زیرِ عمل</span>
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full bg-tm-tint-red px-2.5 py-0.5 align-middle text-[11px] font-bold text-tm-red"
      >
        <BadgeCheck size={13} aria-hidden /> Get verified
      </button>
    )

  return (
    <>
      {trigger}
      <VerifyBenefitsDialog open={open} onClose={() => setOpen(false)} state={state} payHref={payHref} />
    </>
  )
}
