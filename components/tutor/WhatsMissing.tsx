import Link from 'next/link'
import { ArrowRight, Check, Circle } from 'lucide-react'

import { fixHref, progressLine, type OnboardingItem } from '@/lib/onboarding/missingItems'
import type { IndexRequirement } from '@/lib/seo/indexable'

// "What's missing" (owner, 13 Oct 2026) — one component for the tutor dashboard
// and the top of every onboarding step. It lists each remaining item in plain
// English with a "Fix now" link straight to its step, shows a progress bar, and
// says separately what makes the profile visible on Google. No hooks, so it
// renders on the server (the dashboard) and inside the client flow alike.
//
// On the dashboard a "Fix now" is a link; inside the flow the caller passes
// `onFix` and it is a button that jumps to the step without a page load.

export default function WhatsMissing({
  done,
  total,
  percent,
  missing,
  google,
  onFix,
  compact = false,
}: {
  done: number
  total: number
  percent: number
  missing: OnboardingItem[]
  google?: { line: string; requirements: IndexRequirement[]; visible: boolean } | null
  onFix?: (item: OnboardingItem) => void
  /** Inside a step: collapsed to its progress line until opened. */
  compact?: boolean
}) {
  const allDone = missing.length === 0
  if (allDone && (!google || google.visible)) return null

  const FIX = 'inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl border border-tm-red px-3 text-xs font-bold text-tm-red hover:bg-tm-tint-red'

  const list = (
    <>
      {missing.length > 0 && (
        <ul className="space-y-1.5">
          {missing.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-tm-bg px-3 py-1.5">
              <span className="min-w-0 break-words text-xs font-semibold text-slate-700">{item.label}</span>
              {onFix ? (
                <button type="button" onClick={() => onFix(item)} className={FIX}>
                  Fix now <ArrowRight aria-hidden size={12} />
                </button>
              ) : (
                <Link href={fixHref(item)} className={FIX}>
                  Fix now <ArrowRight aria-hidden size={12} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {google && !google.visible && (
        <div className="space-y-1.5 rounded-xl border border-tm-navy/20 bg-tm-tint-navy p-3 text-tm-navy">
          <p className="text-xs font-bold leading-relaxed">{google.line}</p>
          <ul className="space-y-0.5">
            {google.requirements.map((r) => (
              <li key={r.key} className="flex items-start gap-1.5 text-[11px] font-semibold">
                {r.met ? <Check aria-hidden size={13} className="mt-0.5 shrink-0 text-tm-green-deep" /> : <Circle aria-hidden size={13} className="mt-0.5 shrink-0" />}
                <span>
                  {r.label.charAt(0).toUpperCase() + r.label.slice(1)} — {r.met ? 'done' : 'not yet'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )

  const bar = (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile steps done">
      <div className="h-full rounded-full bg-tm-green-deep" style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
    </div>
  )

  if (compact) {
    return (
      <details className="group mb-4 rounded-2xl border border-gray-200 bg-white p-3">
        <summary className="flex min-h-[44px] cursor-pointer list-none flex-col justify-center gap-1.5">
          <span className="flex items-baseline justify-between gap-2 text-xs font-bold text-tm-navy">
            <span>What&rsquo;s missing</span>
            <span className="text-slate-700">{progressLine({ done, total })}</span>
          </span>
          {bar}
        </summary>
        <div className="mt-3 space-y-2">{list}</div>
      </details>
    )
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-tm-navy">{allDone ? 'Your profile on Google' : 'What’s missing'}</h2>
        <span className="text-xs font-black text-tm-navy">{progressLine({ done, total })}</span>
      </div>
      {bar}
      {list}
    </section>
  )
}
