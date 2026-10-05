'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Check, Circle, X } from 'lucide-react'

import type { FeeBenefitKey, FeeCardState } from '@/lib/tutorDashboard'

// The "what your verification gives you" pop-up (PR106-D §3), extracted from
// VerifyBadgeControl so the SAME dialog can also open from the new onboarding's
// "What do I get?" link (PR106-G4b §1) — one source for the benefit lines and
// the spam-prevention line. Three benefit lines with real done/pending ticks,
// English + Urdu, NO amount. Closes by X, tap-outside, or Esc/back.

export const FEE_BENEFIT_LINES: Record<FeeBenefitKey, { en: string; ur: string }> = {
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

export default function VerifyBenefitsDialog({
  open,
  onClose,
  state,
  payHref,
}: {
  open: boolean
  onClose: () => void
  state: FeeCardState
  /** When given and the fee is unpaid, the pop-up shows a "Pay verification fee"
   *  link. Omitted on a screen that already carries its own pay button. */
  payHref?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-tm-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Your verification"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-black text-tm-navy">
            Your verification
            <span lang="ur" dir="rtl" className="ms-2 text-[11px] font-semibold text-gray-500">آپ کی تصدیق</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Close"
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
                {FEE_BENEFIT_LINES[l.key].en}
                <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px] text-gray-500">{FEE_BENEFIT_LINES[l.key].ur}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="rounded-lg bg-tm-tint-green/60 px-3 py-2 text-[11px] leading-snug text-tm-green-deep">
          The one-time Spam Free Platform Fee keeps fake and spam accounts off TutorMint, so parents can trust verified tutors.
          <span lang="ur" dir="rtl" className="mt-0.5 block text-gray-500">
            یہ ایک بار کی فیس جعلی اور اسپام اکاؤنٹس کو ٹیوٹرمنٹ سے دور رکھتی ہے، تاکہ والدین تصدیق شدہ ٹیوٹرز پر بھروسہ کر سکیں۔
          </span>
        </p>

        {payHref && !state.paid && (
          <Link
            href={payHref}
            className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover"
          >
            Pay Spam Free Platform Fee
            <span lang="ur" dir="rtl" className="ms-1.5 text-[11px] font-semibold opacity-90">اسپام فری پلیٹ فارم فیس ادا کریں</span>
          </Link>
        )}
      </div>
    </div>
  )
}
