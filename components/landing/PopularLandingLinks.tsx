import Link from 'next/link'
import { GraduationCap, Briefcase } from 'lucide-react'

import { liveLandingPages, type LandingKind } from '@/lib/landing'

// The internal links that stop the city × subject landing pages being orphans
// (PR43 §2). A landing page that nothing links to is one Google struggles to
// discover and values less; the browse pages are the natural parent — a reader
// on /browse/tutors is exactly who a "<subject> tutors in <city>" page is for.
//
// Server-rendered from the live set (>= threshold), so every link resolves and
// nothing points at a page that is absent. Only the matching kind is shown:
// tutor landings on /browse/tutors, tuition landings on /browse/tuitions.

const HEADING: Record<LandingKind, string> = {
  tutors: 'Popular tutor searches',
  tuitions: 'Popular tuition searches',
}

const NOUN: Record<LandingKind, string> = { tutors: 'tutors', tuitions: 'tuitions' }

export default async function PopularLandingLinks({
  kind,
  max = 30,
}: {
  kind: LandingKind
  max?: number
}) {
  const pages = (await liveLandingPages())
    .filter((p) => p.kind === kind)
    // Busiest first — the pages most worth surfacing and most worth crawling.
    .sort((a, b) => b.count - a.count)
    .slice(0, max)

  if (pages.length === 0) return null
  const Icon = kind === 'tutors' ? GraduationCap : Briefcase

  return (
    <nav
      aria-label={HEADING[kind]}
      className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5"
    >
      <p className="text-xs font-black text-tm-navy">{HEADING[kind]}</p>
      <ul className="flex flex-wrap gap-2">
        {pages.map((p) => (
          <li key={`${p.citySlug}/${p.subjectSlug}`}>
            <Link
              href={`/${p.kind}/${p.citySlug}/${p.subjectSlug}`}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-tm-bg px-3 text-[11px] font-semibold text-tm-navy hover:border-tm-navy"
            >
              <Icon aria-hidden size={12} className="shrink-0 text-gray-500" />
              {p.subjectName} {NOUN[p.kind]} in {p.city}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
