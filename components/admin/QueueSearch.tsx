'use client'

import { useRouter } from 'next/navigation'
import Typeahead from '@/components/search/Typeahead'

// Search for the admin tutor and payment queues, with its Search button removed
// like every search on the platform.
//
// `suggest={false}`, for the same reason as the member directory: the public
// suggest endpoint indexes LISTED tutors and OPEN jobs, and is deliberately
// blind to pending, suspended and unclaimed rows — which are exactly the ones an
// admin opens a moderation queue to find. So there is no panel; results refresh
// as you type, but the results come from the screen's own server query.
//
// It preserves the `filter` tab while it edits `q`, so searching within
// "Pending video" stays within that tab and the URL an admin lands on is
// shareable.

export default function QueueSearch({
  basePath,
  initialQuery,
  filter,
  placeholder,
  ariaLabel,
}: {
  basePath: string
  initialQuery: string
  filter: string
  placeholder: string
  ariaLabel: string
}) {
  const router = useRouter()

  const apply = (q: string, replace: boolean) => {
    const params = new URLSearchParams()
    if (filter) params.set('filter', filter)
    if (q) params.set('q', q)
    const href = params.toString() ? `${basePath}?${params}` : basePath
    if (replace) router.replace(href, { scroll: false })
    else router.push(href)
  }

  return (
    <Typeahead
      initialQuery={initialQuery}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      suggest={false}
      onQueryChange={(q) => apply(q, true)}
      onCommit={(q) => apply(q, false)}
    />
  )
}
