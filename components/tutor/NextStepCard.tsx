import Link from 'next/link'
import { ArrowRight, ShieldCheck } from 'lucide-react'

import { fixHref } from '@/lib/onboarding/missingItems'
import type { RequiredItem } from '@/lib/profileRequired'
import {
  continueOnboardingLabel,
  continueStepLabel,
  nextItem,
  onboardingItemsDone,
  remainingChips,
} from '@/lib/onboarding/progressCore'

// "Your next step" (PR-17 E.3, owner 23 Nov 2026) — ONE card in place of the
// stacked completion chips, the "N tuitions waiting" card and the duplicate
// prompts. Until onboarding is finished: "Continue onboarding (9 of 16)", a big
// button "Continue: <next step> (step X of 16)" opening the flow at exactly
// that step, the remaining steps as small chips in onboarding order, and
// "N tuitions in <city> are waiting for you". Once every step but the fee is
// done it becomes "Pay the Verification Fee". Hidden when nothing is left (or
// while a fee receipt is with staff — the review notice says so). No price.

export default function NextStepCard({
  items,
  tuitions,
  city,
  feeUnderReview = false,
}: {
  items: RequiredItem[]
  /** The same count as "Tuitions for you" / Find tuitions. */
  tuitions: number
  city: string | null
  feeUnderReview?: boolean
}) {
  const next = nextItem(items)
  if (!next) return null
  const done = items.filter((i) => i.done).length
  const waiting =
    tuitions > 0
      ? `${tuitions} ${tuitions === 1 ? 'tuition' : 'tuitions'}${city ? ` in ${city}` : ''} ${tuitions === 1 ? 'is' : 'are'} waiting for you`
      : null

  // Only the Verification Fee is left.
  if (onboardingItemsDone(items)) {
    if (feeUnderReview) return null
    return (
      <section className="space-y-2 rounded-2xl border border-tm-green-deep bg-tm-tint-green p-4" data-next-step="verify">
        <h2 className="text-sm font-black text-tm-green-deep">Your next step</h2>
        <Link
          href="/pay/choose?plan=verified"
          className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-tm-green-deep px-4 text-sm font-black text-white hover:bg-tm-green-deep-hover"
        >
          <ShieldCheck aria-hidden size={16} /> Pay the Verification Fee
        </Link>
        {waiting && <p className="text-xs font-semibold text-tm-green-deep">{waiting}.</p>}
        <p className="text-[11px] text-tm-green-deep">It unlocks applying and the Verified badge.</p>
      </section>
    )
  }

  const chips = remainingChips(items)
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4" data-next-step={next.item.key}>
      <h2 className="text-sm font-black text-tm-navy">{continueOnboardingLabel(done, items.length)}</h2>
      <Link
        href={fixHref(next.item)}
        className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-tm-navy px-4 text-center text-sm font-black leading-snug text-white hover:bg-tm-navy-hover"
      >
        {continueStepLabel(next)}
        <ArrowRight aria-hidden size={16} className="shrink-0" />
      </Link>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Steps after this one">
          {chips.map((c) => (
            <li key={c.key}>
              <Link
                href={fixHref(c)}
                className="inline-flex min-h-[44px] items-center rounded-full border border-gray-200 bg-tm-bg px-3 text-[11px] font-bold text-slate-700 hover:border-tm-navy"
              >
                {c.button}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {waiting && <p className="text-xs font-semibold text-tm-green-deep">{waiting}.</p>}
    </section>
  )
}
