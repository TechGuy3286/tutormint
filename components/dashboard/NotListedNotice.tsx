import Link from 'next/link'
import { AlertCircle, ArrowRight } from 'lucide-react'

import { tutorFixFor, type ListingBlocker } from '@/lib/tutorListingStatus'

// Shown on the tutor dashboard when a tutor has PAID the verification fee but is
// still NOT in the public directory (owner, 15 Sep 2026). It names each thing
// that is still required and links to the screen that collects it — so a paid
// tutor is never left at a silent dead end, and is one tap from being found.
//
// Visibility only: no promise of tuitions, applications or hires. Reasons that a
// tutor cannot fix himself (suspended, under review, fixture) produce no fix
// link and so do not appear here — they are surfaced in their own place.

export default function NotListedNotice({ blockers }: { blockers: ListingBlocker[] }) {
  const fixes = blockers.map(tutorFixFor).filter((f): f is { label: string; href: string } => f !== null)
  if (fixes.length === 0) return null

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
        {fixes.map((f) => (
          <li key={f.href + f.label}>
            <Link
              href={f.href}
              className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-tm-gold/40 bg-white px-3 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              {f.label}
              <ArrowRight aria-hidden size={15} className="shrink-0 text-tm-navy" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
