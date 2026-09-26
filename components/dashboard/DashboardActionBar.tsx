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
// only differentiator that matters here — brand RED for the tutor side, NAVY for
// the parent side — paired with a role-specific label. There is no shared
// neutral wording and no role switching; accounts are single-role.
//
// The supporting line is either a REAL count ("12 tuitions match your subjects
// in Lahore") or a plain line — never an invented or zero number; the caller
// decides which and passes the finished string.

const TONE = {
  red: 'bg-tm-red hover:bg-tm-red-hover',
  navy: 'bg-tm-navy hover:bg-tm-navy-hover',
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
  tone: 'red' | 'navy'
  icon: ReactNode
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-[64px] items-center gap-3 rounded-2xl p-4 text-white transition-colors ${TONE[tone]}`}
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black">{label}</span>
        <span className="block text-[11px] font-medium text-white/90">{line}</span>
        {lineUr && (
          <span lang="ur" dir="rtl" className="block text-[11px] font-medium text-white/80">{lineUr}</span>
        )}
      </span>
      <ArrowRight aria-hidden size={18} className="shrink-0" />
    </Link>
  )
}
