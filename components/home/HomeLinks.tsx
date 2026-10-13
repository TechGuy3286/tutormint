import Link from 'next/link'

import { indexableCityPages, cityPagePath } from '@/lib/cityJobs'
import { liveLandingPages } from '@/lib/landing'
import { HOME_MORE_LINKS } from '@/lib/siteIdentity'

// The homepage's link block (owner-approved, 13 Oct 2026): the city tuition-job
// links it already had — each ONCE — and, beside them, the busiest tutor
// city × subject pages that are indexable now (at most six, by live tutor
// count), then Browse tutors, Post a tuition, Become a tutor and Blog. Both
// sides of the site are reachable from the homepage, not only tuition jobs.
//
// Server component. Every link is to a page that exists today: the city and
// landing sets are the same ones the sitemap lists. The city links keep the
// open-job count they always showed; no new count is added.

export const HOME_TUTOR_PAGES_MAX = 6

const ROW = 'flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-gray-500'
const LINK = 'inline-flex min-h-[32px] items-center font-semibold text-tm-navy hover:underline'

export default async function HomeLinks() {
  const [cities, landing] = await Promise.all([indexableCityPages().catch(() => []), liveLandingPages().catch(() => [])])
  const tutorPages = landing
    .filter((p) => p.kind === 'tutors')
    .sort((a, b) => b.count - a.count || a.subjectName.localeCompare(b.subjectName))
    .slice(0, HOME_TUTOR_PAGES_MAX)

  return (
    <div className="space-y-2">
      {cities.length > 0 && (
        <nav aria-label="Tuition jobs by city" className={ROW}>
          <span className="font-bold text-tm-navy">Tuition jobs by city:</span>
          {cities.slice(0, 10).map((p, i) => (
            <span key={p.citySlug} className="inline-flex items-center gap-2">
              {i > 0 && <span aria-hidden>·</span>}
              <Link href={cityPagePath(p.citySlug)} className={LINK}>
                {p.city} ({p.count})
              </Link>
            </span>
          ))}
        </nav>
      )}
      {tutorPages.length > 0 && (
        <nav aria-label="Tutors by subject and city" className={ROW}>
          <span className="font-bold text-tm-navy">Tutors:</span>
          {tutorPages.map((p, i) => (
            <span key={`${p.citySlug}/${p.subjectSlug}`} className="inline-flex items-center gap-2">
              {i > 0 && <span aria-hidden>·</span>}
              <Link href={`/tutors/${p.citySlug}/${p.subjectSlug}`} className={LINK}>
                {p.subjectName} tutors in {p.city}
              </Link>
            </span>
          ))}
        </nav>
      )}
      <nav aria-label="More" className={ROW}>
        {HOME_MORE_LINKS.map((l, i) => (
          <span key={l.href} className="inline-flex items-center gap-2">
            {i > 0 && <span aria-hidden>·</span>}
            <Link href={l.href} className={LINK}>
              {l.label}
            </Link>
          </span>
        ))}
      </nav>
    </div>
  )
}
