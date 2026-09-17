import Link from 'next/link'
import { AlertCircle, ArrowRight, Clock } from 'lucide-react'

import { listingFixItems, type ListingBlocker } from '@/lib/tutorListingStatus'

// Shown on the tutor dashboard when a tutor is NOT in the public directory
// (PR16 §1). It names each thing that is still required for VISIBILITY — mobile,
// city, area, subjects, gender — and links to the screen that collects it, so a
// tutor is never at a silent dead end and is one tap from being found. The fee is
// NOT a visibility requirement (PR16 §1) and never appears here.
//
// Visibility only: no promise of tuitions, applications or hires. Reasons that a
// tutor cannot fix himself (suspended, under review, fixture) produce no fix
// link and so do not appear here — they are surfaced in their own place.

export default function NotListedNotice({
  blockers,
}: {
  blockers: ListingBlocker[]
}) {
  const items = listingFixItems(blockers)
  if (items.length === 0) return null

  return (
    <section className="space-y-3 rounded-2xl border border-tm-gold/40 bg-tm-tint-gold p-4">
      <h2 className="flex items-center gap-2 text-sm font-black text-tm-gold-ink">
        <AlertCircle aria-hidden size={16} />
        You are not in search results yet
      </h2>
      <p className="text-xs leading-relaxed text-tm-gold-ink">
        Parents find tutors by these. Add each one and you appear in search:
      </p>
      <ul className="space-y-2">
        {items.map((f) =>
          f.status || !f.href ? (
            <li
              key={f.key}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-tm-gold/40 bg-white px-3 text-xs font-bold text-tm-gold-ink"
            >
              <Clock aria-hidden size={15} className="shrink-0" />
              {f.label}
            </li>
          ) : (
            <li key={f.key}>
              <Link
                href={f.href}
                className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-tm-gold/40 bg-white px-3 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
              >
                {f.label}
                <ArrowRight aria-hidden size={15} className="shrink-0 text-tm-navy" />
              </Link>
            </li>
          ),
        )}
      </ul>
    </section>
  )
}
