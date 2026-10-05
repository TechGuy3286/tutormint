import { NextResponse } from 'next/server'

import { getEntitlements } from '@/lib/entitlements'
import { browseJobs, NO_JOB_FILTERS, resolveTutorScope, feedGenderFilter } from '@/lib/jobFeed'
import { createClient } from '@/lib/supabase/server'
import { applyBlocksFor, type ApplyBlockMap } from '@/lib/applyBlockServer'

// Load-more for /tutor/dashboard/jobs.
//
// The page is the whole open board with no filters, which is exactly
// browseJobs with none set -- so this reuses that keyset rather than writing a
// second one. Two orderings over the same table is how they start disagreeing,
// and a cursor is only total because of the id tiebreaker that function
// already applies.
//
// SIGNED-IN ONLY, unlike /api/browse/tuitions. The rows are the same public
// jobs, but this response carries `applied` per job, which is the caller's own
// application history. It is resolved from the SESSION, never from an id in
// the query string, so nobody can ask whether another tutor applied.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 12

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  const cursor = new URL(request.url).searchParams.get('cursor')
  // PR85 Part C: gender-filter the board for the signed-in tutor.
  const resolved = await resolveTutorScope(supabase, user.id)
  const viewerGender = feedGenderFilter(resolved?.gender)
  const { jobs, nextCursor } = await browseJobs({ ...NO_JOB_FILTERS, viewerGender }, PAGE_SIZE, 0, cursor)

  // Merged ONTO each item rather than returned alongside them. useInfinite
  // appends `page.items` and reads nothing else off the response, so a
  // sibling array would be silently dropped and every appended card would
  // offer Apply to a tutor who had already applied.
  // Why Apply is inactive per job (owner, 5 Oct 2026) — the shared rule.
  let blocks: ApplyBlockMap = {}
  if (jobs.length > 0) {
    const ent = await getEntitlements(user.id)
    if (ent.audience === 'tutor') blocks = await applyBlocksFor(supabase, user.id, ent, jobs)
  }

  return NextResponse.json({
    items: jobs.map((j) => ({ ...j, applied: blocks[j.id]?.kind === 'applied', applyBlock: blocks[j.id] ?? null })),
    cursor: nextCursor,
  })
}
