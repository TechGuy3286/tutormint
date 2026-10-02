'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BadgeCheck, Check, Circle, X } from 'lucide-react'

import { verificationFeeCardState, type FeeBenefitKey } from '@/lib/tutorDashboard'

// The tutor's own dashboard verification control (PR106-D §2.4/§3). After the
// name it shows one of:
//   • verified (fee paid + docs approved) → the GREEN CHECK only, no "Verified"
//     text; tapping opens the benefits pop-up.
//   • fee paid, docs pending → a "Verification pending" chip; taps open the pop-up.
//   • fee not paid → a "Get verified" chip; taps open the pop-up with a
//     "Pay verification fee" button to the payment page.
//
// The pop-up carries the old fee-card content (three benefit lines with real
// done/pending ticks + the spam-prevention line), English + Urdu, NO amount.
// Closes by X, tap-outside, or Esc/back.

const LINES: Record<FeeBenefitKey, { en: string; ur: string }> = {
  badge: {
    en: 'Green Verified badge — after our team approves your CNIC, photo and selfie',
    ur: 'سبز تصدیق شدہ بیج — جب ہماری ٹیم آپ کا شناختی کارڈ، تصویر اور سیلفی منظور کر لے',
  },
  google: {
    en: 'Your TutorMint page can be found on Google — once your profile is 100% complete and approved',
    ur: 'آپ کا ٹیوٹرمنٹ صفحہ گوگل پر مل سکے گا — جب آپ کا پروفائل 100% مکمل اور منظور ہو جائے',
  },
  basic: {
    en: 'Apply to tuitions and view parent numbers on the Basic plan',
    ur: 'بیسک پلان پر ٹیوشنز کے لیے درخواست دیں اور والدین کے نمبر دیکھیں',
  },
}

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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

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
      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-tm-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Your verification"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-black text-tm-navy">
                Your verification
                <span lang="ur" dir="rtl" className="ms-2 text-[11px] font-semibold text-gray-500">آپ کی تصدیق</span>
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100">
                <X size={18} aria-hidden />
              </button>
            </div>

            <ul className="space-y-1.5">
              {state.lines.map((l) => (
                <li key={l.key} className="flex items-start gap-2">
                  {l.done ? (
                    <Check size={15} className="mt-0.5 shrink-0 text-tm-green-deep" aria-label="active" />
                  ) : (
                    <Circle size={15} className="mt-0.5 shrink-0 text-gray-500" aria-label="not active yet" />
                  )}
                  <span className={`text-[12px] leading-snug ${l.done ? 'text-slate-700' : 'text-gray-500'}`}>
                    {LINES[l.key].en}
                    <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px] text-gray-500">{LINES[l.key].ur}</span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="rounded-lg bg-tm-tint-green/60 px-3 py-2 text-[11px] leading-snug text-tm-green-deep">
              This one-time fee keeps fake and spam accounts off TutorMint, so parents can trust verified tutors.
              <span lang="ur" dir="rtl" className="mt-0.5 block text-gray-500">
                یہ ایک بار کی فیس جعلی اور اسپام اکاؤنٹس کو ٹیوٹرمنٹ سے دور رکھتی ہے، تاکہ والدین تصدیق شدہ ٹیوٹرز پر بھروسہ کر سکیں۔
              </span>
            </p>

            {!state.paid && (
              <Link
                href={payHref}
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover"
              >
                Pay verification fee
                <span lang="ur" dir="rtl" className="ms-1.5 text-[11px] font-semibold opacity-90">تصدیقی فیس ادا کریں</span>
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  )
}
