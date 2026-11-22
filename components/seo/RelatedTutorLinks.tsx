import Link from 'next/link'

import Avatar from '@/components/Avatar'
import VerifiedBadge from '@/components/badges/VerifiedBadge'
import type { CrawlTutor } from '@/lib/tutorCrawlCore'

// A small box of links to indexable tutor profiles (owner, 20 Nov 2026 —
// PR-11): "Tutors for this tuition" on an open tuition, "Similar tutors" on a
// tutor profile. Plain server-rendered links — real <a href> a crawler follows.
//
// PR-15: each link is a small photo (or the branded default) + name + the
// Verified tick, not a text chip. Every tutor here is indexable — fee paid and
// CNIC and photo approved (lib/seo/indexable) — which is more than the
// Verified badge asks (lib/badgeRule), so the tick is always true.
// Renders nothing for an empty list.

export default function RelatedTutorLinks({ tutors, heading, more }: { tutors: CrawlTutor[]; heading: string; more?: { href: string; label: string } | null }) {
  if (tutors.length === 0) return null
  return (
    <nav aria-label={heading} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-related-tutors="">
      <h2 className="text-xs font-black text-tm-navy">{heading}</h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tutors.map((t) => (
          <li key={t.id} className="min-w-0">
            <Link
              href={`/tutor/${t.slug}`}
              className="flex min-h-[44px] min-w-0 items-center gap-2.5 rounded-xl border border-gray-200 bg-tm-bg px-2.5 py-1.5 hover:border-tm-navy"
            >
              <Avatar name={t.name} src={t.avatarUrl ?? null} gender={t.gender} decorative className="h-9 w-9 text-[11px]" px={36} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs font-bold text-tm-navy">{t.name}</span>
                  <VerifiedBadge size="sm" />
                </span>
                <span className="block truncate text-[11px] text-gray-500">{t.city}</span>
              </span>
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
