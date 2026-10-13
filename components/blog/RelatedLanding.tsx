import Link from 'next/link'
import { GraduationCap, Briefcase } from 'lucide-react'

import type { LandingItem } from '@/lib/blogRelevance'

// "Browse verified listings" on a post (owner, 13 Oct 2026).
//
// The pages shown are chosen at RENDER by the one relevance rule
// (lib/blogRelevanceCore, loaded by lib/blogRelevance landingForPost): only
// indexable landing pages matching the post's subject + level + city, then
// subject + city, then level + city, and city-only pages when nothing closer
// exists. The author's own picks are only a preference among related pages —
// an unrelated pick is never shown. With nothing related the box is hidden.

export default function RelatedLanding({ items }: { items: LandingItem[] }) {
  if (!items || items.length === 0) return null

  return (
    <nav aria-label="Related directory pages" className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
        Browse verified listings
      </p>
      <ul className="flex flex-wrap gap-2">
        {items.map((p) => (
          <li key={p.path}>
            <Link
              href={`/${p.path}`}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-tm-bg px-3 text-[11px] font-semibold text-tm-navy hover:border-tm-navy"
            >
              {p.kind === 'tutors' ? (
                <GraduationCap aria-hidden size={12} />
              ) : (
                <Briefcase aria-hidden size={12} />
              )}
              {p.name} · {p.city}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
