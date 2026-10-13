import Link from 'next/link'
import { ArrowRight, School } from 'lucide-react'

import type { SchoolSuggestion } from '@/lib/schoolSearch'

// The row shown when a search names a school (owner, 13 Oct 2026):
// "Tutors and tuitions for <School>" → the school's page, and — when that
// school's city has listed tutors — "Tutors in <City>". A school is never
// treated as a subject, so this sits beside the results, not in them.

export default function SchoolSuggestionRow({ school }: { school: SchoolSuggestion }) {
  if (!school.href && !school.tutorsHref) return null
  return (
    <nav aria-label="School" className="flex flex-wrap items-center gap-2 rounded-2xl border border-tm-green-deep/20 bg-tm-tint-green p-3">
      <School aria-hidden size={16} className="shrink-0 text-tm-green-deep" />
      {school.href && (
        <Link href={school.href} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-bold text-tm-navy hover:underline">
          {school.label}
          <ArrowRight aria-hidden size={14} />
        </Link>
      )}
      {school.tutorsHref && school.tutorsCity && (
        <Link href={school.tutorsHref} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-bold text-tm-navy hover:underline">
          Tutors in {school.tutorsCity}
          <ArrowRight aria-hidden size={14} />
        </Link>
      )}
    </nav>
  )
}
