import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'

// The full-width action bar under the profile card on each dashboard (PR42).
//
// It is the one thing a member comes back to do — a tutor to find tuitions, a
// parent to find tutors — so it sits above the tile grid and is deliberately
// NOT a tile: full width, a solid brand-tone button, its own label and colour.
//
// ROLE CLARITY (§4): the two bars must be different at a glance. The tone is the
// only differentiator that matters here — paired with a role-specific label.
// There is no shared neutral wording and no role switching; accounts are
// single-role. The parent side stays solid NAVY; the tutor side is a light-GREEN
// bar with dark-green text (PR87 — the Verify-banner tint family), which reads as
// the "your work" surface rather than a red alert.
//
// The supporting line is either a REAL count ("12 tuitions match your subjects
// in Lahore") or a plain line — never an invented or zero number; the caller
// decides which and passes the finished string.

// Each tone: the bar surface, the icon chip, and the ink for title/line/arrow.
const TONE = {
  red: {
    bar: 'bg-tm-red hover:bg-tm-red-hover text-white',
    chip: 'bg-white/15',
    title: 'text-white',
    line: 'text-white/90',
    lineUr: 'text-white/80',
  },
  navy: {
    bar: 'bg-tm-navy hover:bg-tm-navy-hover text-white',
    chip: 'bg-white/15',
    title: 'text-white',
    line: 'text-white/90',
    lineUr: 'text-white/80',
  },
  // Light-green tint, dark-green ink (all pass AA — see scripts/contrast-check.ts).
  green: {
    bar: 'bg-tm-tint-green border border-tm-green-deep/25 hover:border-tm-green-deep/50 text-tm-green-deep',
    chip: 'bg-white',
    title: 'text-tm-green-deep',
    line: 'text-tm-green-deep',
    lineUr: 'text-tm-green-deep',
  },
} as const

export default function DashboardActionBar({
  href,
  label,
  line,
  lineUr,
  tone,
  icon,
}: {
  href: string
  label: string
  line: string
  /** The Urdu rendering of `line`, shown beneath it (PR71). */
  lineUr?: string
  tone: 'red' | 'navy' | 'green'
  icon: ReactNode
}) {
  const t = TONE[tone]
  return (
    <Link
      href={href}
      className={`flex min-h-[64px] items-center gap-3 rounded-2xl p-4 transition-colors ${t.bar}`}
    >
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${t.chip}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-black ${t.title}`}>{label}</span>
        <span className={`block text-[11px] font-medium ${t.line}`}>{line}</span>
        {lineUr && (
          // tm-ur-cap so the Urdu line is not bumped larger than the English (PR87 §2).
          <span lang="ur" dir="rtl" className={`tm-ur-cap block text-[11px] font-medium ${t.lineUr}`}>{lineUr}</span>
        )}
      </span>
      <ArrowRight aria-hidden size={18} className="shrink-0" />
    </Link>
  )
}
