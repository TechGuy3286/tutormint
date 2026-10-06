import Link from 'next/link'

import { indexableCityPages, cityPagePath } from '@/lib/cityJobs'

// The "Tuition jobs by city" link strip (owner, 6 Oct 2026, item 6): every city
// page that is indexable (3+ open tuitions), so the pages are linked from the
// footer, /browse/tuitions and the homepage and are never orphans. Server
// component; renders nothing when no city clears the threshold.

export default async function CityJobsLinks({
  variant = 'strip',
  heading = 'Tuition jobs by city',
}: {
  /** 'strip' — a compact labelled row; 'footer' — plain links for the footer column. */
  variant?: 'strip' | 'footer'
  heading?: string
}) {
  const pages = await indexableCityPages()
  if (pages.length === 0) return null

  if (variant === 'footer') {
    return (
      <ul className="space-y-1">
        {pages.slice(0, 8).map((p) => (
          <li key={p.citySlug}>
            <Link href={cityPagePath(p.citySlug)} className="inline-flex min-h-[44px] items-center text-xs text-slate-300 hover:text-white">
              Tuition jobs in {p.city}
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <nav aria-label={heading} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
      <span className="font-bold text-tm-navy">{heading}:</span>
      {pages.slice(0, 10).map((p, i) => (
        <span key={p.citySlug} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          <Link href={cityPagePath(p.citySlug)} className="inline-flex min-h-[32px] items-center font-semibold text-tm-navy hover:underline">
            {p.city} ({p.count})
          </Link>
        </span>
      ))}
    </nav>
  )
}
