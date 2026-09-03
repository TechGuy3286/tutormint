import { NextResponse } from 'next/server'

import { getEntitlements } from '@/lib/entitlements'
import { browseJobs, NO_JOB_FILTERS } from '@/lib/jobFeed'
import { createClient } from '@/lib/supabase/server'

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
  const { jobs, nextCursor } = await browseJobs(NO_JOB_FILTERS, PAGE_SIZE, 0, cursor)

  // Merged ONTO each item rather than returned alongside them. useInfinite
  // appends `page.items` and reads nothing else off the response, so a
  // sibling array would be silently dropped and every appended card would
  // offer Apply to a tutor who had already applied.
  let applied = new Set<string>()
  if (jobs.length > 0) {
    const ent = await getEntitlements(user.id)
    if (ent.audience === 'tutor') {
      const { data } = await supabase
        .from('applications')
        .select('job_id')
        .eq('tutor_id', user.id)
        .in(
          'job_id',
          jobs.map((j) => j.id),
        )
      applied = new Set((data ?? []).map((a) => a.job_id as string))
    }
  }

  return NextResponse.json({
    items: jobs.map((j) => ({ ...j, applied: applied.has(j.id) })),
    cursor: nextCursor,
  })
}
