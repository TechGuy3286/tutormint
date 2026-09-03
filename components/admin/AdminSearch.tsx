'use client'

import { useRouter } from 'next/navigation'

import Typeahead from '@/components/search/Typeahead'

// The admin header's search. One input, no button, as everywhere else.
//
// `suggest={false}`, for the reason /admin/users has always given: the public
// suggest index holds LISTED tutors and OPEN jobs and is deliberately blind to
// parents, staff, suspended accounts and unclaimed imports -- which are exactly
// the rows somebody opens an admin screen to find. A panel here would answer a
// different question from the one being asked.
//
// It commits to the member directory rather than searching the current screen.
// A search box in a global header is read as "find a person", and the member
// page is the hub every other admin object links back to.

export default function AdminSearch() {
  const router = useRouter()

  const go = (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    router.push(`/admin/users?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <Typeahead
      placeholder="Find a member — name, email or mobile"
      ariaLabel="Find a member"
      suggest={false}
      // Deliberately NOT navigating on every keystroke: this input is in the
      // header of every admin screen, so a live redirect would throw a
      // moderator off the queue they are working the moment they typed a
      // letter. The directory's own search stays live; this one commits.
      onQueryChange={() => {}}
      onCommit={go}
    />
  )
}
