'use client'

import Link from 'next/link'
import type { ChecklistItem } from '@/lib/profileChecklist'

// Completion widget. Reads its numbers from lib/profileChecklist.ts via the
// server, rather than recomputing them with its own rules -- the old version
// had a second, divergent 4-item formula that disagreed with the stored
// percentage.
//
// Every missing item deep-links to the step of the form that fixes it.

export default function ProfileCompletionWidget({
  percent,
  items,
  role = 'tutor',
  compact = false,
}: {
  percent: number
  items: ChecklistItem[]
  role?: 'tutor' | 'parent'
  compact?: boolean
}) {
  const missing = items.filter((i) => !i.done)
  const done = items.length - missing.length
  const href = role === 'tutor' ? '/tutor/complete-profile' : '/parent/verify'

  if (percent >= 100) {
    return (
      <div className="bg-tm-tint-green border border-tm-green-deep/30 rounded-2xl p-4 flex items-center gap-3">
        <span className="text-lg" aria-hidden="true">
          ✓
        </span>
        <div>
          <p className="text-xs font-black text-tm-green-deep">Your profile is 100% complete</p>
          <p className="text-[11px] text-tm-green-deep">
            {role === 'tutor'
              ? 'You are listed in the tutor directory.'
              : 'Your details are with our team for verification.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-tm-navy">Complete your profile</h2>
        <span className="text-sm font-black text-tm-navy">{percent}%</span>
      </div>

      <div
        className="h-2 w-full bg-gray-100 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Profile completion"
      >
        <div
          className="h-full bg-tm-green-deep rounded-full transition-all duration-300"
          style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        />
      </div>

      <p className="text-[11px] text-gray-500">
        {done} of {items.length} done.{' '}
        {role === 'tutor'
          ? 'You need 100% to appear in the tutor directory.'
          : 'You need 100% before you can post a job.'}
      </p>

      {!compact && (
        <ul className="space-y-1.5 pt-1">
          {missing.slice(0, 6).map((item) => (
            <li key={item.key}>
              <Link
                href={`${href}?step=${item.step}#${item.anchor}`}
                className="flex items-center justify-between gap-3 min-h-[44px] px-3 py-2 rounded-xl bg-tm-bg hover:bg-gray-100 border border-gray-100 transition-colors"
              >
                <span className="text-xs font-medium text-slate-700">{item.label}</span>
                <span className="text-[10px] font-bold text-tm-red uppercase tracking-wider shrink-0">
                  Add
                </span>
              </Link>
            </li>
          ))}
          {missing.length > 6 && (
            <li className="text-[11px] text-gray-400 px-3">+{missing.length - 6} more</li>
          )}
        </ul>
      )}

      <Link
        href={href}
        className="flex items-center justify-center min-h-[44px] w-full py-3 bg-tm-black hover:bg-tm-green-deep text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors"
      >
        Continue
      </Link>
    </section>
  )
}
