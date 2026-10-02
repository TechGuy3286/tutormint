import Link from 'next/link'
import { Check, Circle, ShieldCheck } from 'lucide-react'

import { verificationFeeCardState, quotaCounter, type FeeBenefitKey } from '@/lib/tutorDashboard'

// "Your verification fee" card (PR106-B §2) + the shared-pool quota counter
// (§4–§5), on the tutor's own dashboard. Compact — one small card, so it does
// not push the main tiles far down at 360px.
//
// NO AMOUNT appears here — the Rs 199 lives only on the payment page.

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

export default function VerificationFeeCard({
  feePaid,
  verifiedOk,
  findable,
  payHref,
  quota,
}: {
  feePaid: boolean
  verifiedOk: boolean
  findable: boolean
  /** Where "Pay verification fee" goes (the verify flow → payment page). */
  payHref: string
  /** The shared-pool counter inputs. */
  quota: { plan: string | null; used: number; cap: number }
}) {
  const state = verificationFeeCardState({ feePaid, verifiedOk, findable })
  const q = quotaCounter({ plan: quota.plan, used: quota.used, quota: quota.cap })

  return (
    <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-tm-green-deep" aria-hidden />
        <h2 className="text-sm font-black text-tm-navy">Your verification fee</h2>
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
              <span lang="ur" dir="rtl" className="mt-0.5 block text-[11px] text-gray-500">
                {LINES[l.key].ur}
              </span>
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

      {/* Shared monthly applications pool (§4–§5). Shown only once the fee is paid
          (an unpaid tutor is not yet on a plan). */}
      {state.paid && quota.plan && (
        <div className="border-t border-gray-100 pt-2">
          <p className="text-[12px] font-semibold text-slate-700">
            Applications: {q.text}
            <span lang="ur" dir="rtl" className="ms-1.5 text-[11px] font-normal text-gray-500">اس ماہ کی درخواستیں</span>
          </p>
          {q.showGetMore && (
            <Link
              href="/membership-plans?for=tutors"
              className="mt-1 inline-block text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline"
            >
              Get more applications
              <span lang="ur" dir="rtl" className="ms-1.5 font-semibold text-gray-500">مزید درخواستیں حاصل کریں</span>
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
