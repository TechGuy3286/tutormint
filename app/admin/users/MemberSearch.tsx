'use client'

import { useRouter } from 'next/navigation'
import Typeahead from '@/components/search/Typeahead'

// The member directory's search, with its Search button removed.
//
// `suggest={false}` on purpose. The public suggest endpoint indexes LISTED
// tutors and OPEN jobs -- it is deliberately blind to parents, staff,
// suspended accounts and unclaimed imports, which are exactly the rows an
// admin comes to this screen to find. Offering that panel here would quietly
// answer a different question from the one being asked, and would hide the
// member whose account was just suspended.
//
// So this is the other half of the rule: no button, results refresh as you
// type, but the results themselves come from the screen's own server query
// over name, email, phone and slug.

export default function MemberSearch({
  initialQuery,
  role,
  status,
}: {
  initialQuery: string
  role: string
  status: string
}) {
  const router = useRouter()

  const apply = (q: string, replace: boolean) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (role !== 'all') params.set('role', role)
    if (status !== 'all') params.set('status', status)
    const href = params.toString() ? `/admin/users?${params}` : '/admin/users'
    if (replace) router.replace(href, { scroll: false })
    else router.push(href)
  }

  return (
    <div className="flex gap-2">
      <Typeahead
        initialQuery={initialQuery}
        placeholder="Name, email, mobile or profile slug"
        ariaLabel="Search members"
        suggest={false}
        onQueryChange={(q) => apply(q, true)}
        onCommit={(q) => apply(q, false)}
      />
    </div>
  )
}
