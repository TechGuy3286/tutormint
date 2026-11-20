import Link from 'next/link'

import { loadCrawlSet } from '@/lib/tutorCrawl'
import { cityTutorPageIndexable, cityTutorPath } from '@/lib/tutorCrawlCore'

// "Tutors by city" (owner, 20 Nov 2026 — PR-11): every city tutor page that is
// indexable (3+ indexable tutors), so each is linked from /browse/tutors and
// the homepage and is never an orphan. Names only — no counts. Server
// component; renders nothing when no city clears the threshold.

export default async function CityTutorLinks({ heading = 'Tutors by city', className, linkClassName }: { heading?: string; className?: string; linkClassName?: string }) {
  const set = await loadCrawlSet().catch(() => null)
  const cities = (set?.cities ?? []).filter(cityTutorPageIndexable)
  if (cities.length === 0) return null
  return (
    <nav aria-label={heading} className={className ?? 'flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500'} data-city-tutor-links="">
      <span className="font-bold text-tm-navy">{heading}:</span>
      {cities.map((c, i) =>
        linkClassName ? (
          <Link key={c.citySlug} href={cityTutorPath(c.citySlug)} className={linkClassName}>
            {c.city}
          </Link>
        ) : (
          <span key={c.citySlug} className="inline-flex items-center gap-2">
            {i > 0 && <span aria-hidden>·</span>}
            <Link href={cityTutorPath(c.citySlug)} className="inline-flex min-h-[32px] items-center font-semibold text-tm-navy hover:underline">
              {c.city}
            </Link>
          </span>
        ),
      )}
    </nav>
  )
}
