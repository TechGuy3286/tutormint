import Link from 'next/link'

import type { CrawlTutor } from '@/lib/tutorCrawlCore'

// A small box of links to indexable tutor profiles (owner, 20 Nov 2026 —
// PR-11): "Tutors for this tuition" on an open tuition, "Similar tutors" on a
// tutor profile. Plain server-rendered links — real <a href> a crawler follows.
// Name and city only; renders nothing for an empty list.

export default function RelatedTutorLinks({ tutors, heading, more }: { tutors: CrawlTutor[]; heading: string; more?: { href: string; label: string } | null }) {
  if (tutors.length === 0) return null
  return (
    <nav aria-label={heading} className="space-y-1.5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-related-tutors="">
      <h2 className="text-xs font-black text-tm-navy">{heading}</h2>
      <ul className="flex flex-wrap gap-2">
        {tutors.map((t) => (
          <li key={t.id}>
            <Link
              href={`/tutor/${t.slug}`}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-200 bg-tm-bg px-3 text-[11px] font-semibold text-tm-navy hover:border-tm-navy"
            >
              {t.name} · {t.city}
            </Link>
          </li>
        ))}
      </ul>
      {more && (
        <Link href={more.href} className="inline-flex min-h-[44px] items-center text-xs font-bold text-tm-navy underline">
          {more.label}
        </Link>
      )}
    </nav>
  )
}
