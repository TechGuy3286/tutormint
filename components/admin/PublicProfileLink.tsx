import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

import { BLOCKER_LABEL, type ListingBlocker } from '@/lib/tutorListingStatus'

// "Open public profile" ONLY when the tutor is actually LISTED (PR39).
//
// A tutor is in the public directory only when the listing gate is clear
// (verified mobile, city, area, at least one subject, gender, and not
// suspended/banned/under-review/fixture). A LISTED tutor's /tutor/[slug] page
// always resolves, so the button never 404s. When the tutor is not listed there
// is no public page, so instead of a link that 404s we show a plain, disabled
// line naming the completion and exactly what the SAME gate is still missing —
// taken from directoryBlockers (lib/tutorListingStatus), never guessed.
//
// There is no admin-only preview of an unlisted profile today (PR39 §3), so none
// is offered here.
export default function PublicProfileLink({
  slug,
  listed,
  blockers,
  completion,
}: {
  slug: string | null | undefined
  listed: boolean
  blockers: ListingBlocker[]
  completion: number
}) {
  if (listed && slug) {
    return (
      <Link
        href={`/tutor/${slug}`}
        className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy"
      >
        <ExternalLink aria-hidden size={14} />
        Open public profile
      </Link>
    )
  }

  const missing = blockers.map((b) => BLOCKER_LABEL[b])
  return (
    <p
      aria-disabled="true"
      className="flex min-h-[44px] items-center rounded-xl border border-dashed border-gray-300 bg-tm-bg px-4 text-xs text-gray-500"
    >
      Not listed yet — profile {completion}% complete
      {missing.length > 0 ? ` · missing: ${missing.join(', ')}` : ''}.
    </p>
  )
}
