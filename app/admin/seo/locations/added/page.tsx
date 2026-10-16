import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadRunReview } from '@/lib/locationRunReview'
import { RUN_LABEL } from '@/lib/locationRunCore'

import RunReviewClient from './RunReviewClient'

// Admin → Locations → Review added areas (owner, 16 Oct 2026). The rows the
// "Approve all suggestions" request of 16 Oct, 1:56 pm wrote — it timed out on
// screen but finished on the server. Open to the roles that open Locations;
// every change is the Owner's (the route refuses everyone else). Nothing is
// deleted and the text on tuitions and profiles is never changed.

export const dynamic = 'force-dynamic'

export default async function AddedAreasReviewPage() {
  await requireAdminRole(...SCREEN_ACCESS.seo)
  const board = await loadRunReview()
  const s = board.summary
  return (
    <div className="space-y-4">
      <Link href="/admin/seo/locations" className="text-xs font-bold text-tm-navy hover:underline">
        ← Locations
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy">Review added areas</h1>
        <p className="text-xs text-gray-600">
          What the bulk approval of {RUN_LABEL} saved: {s.areas} new areas ({s.warned} with a warning, {s.withHub} with a public hub page today),{' '}
          {s.aliases} spellings counted as an existing area, and {s.ignored} values marked “Not an area”. {s.reviewed} reviewed so far.
        </p>
        <p className="text-[11px] text-gray-600">
          A hub page needs 3 or more open tuitions in an area on the list. A merged area&rsquo;s old hub address moves to the area it joined.
        </p>
      </header>
      <RunReviewClient board={board} />
    </div>
  )
}
