import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { getEntitlements } from '@/lib/entitlements'
import { createClient } from '@/lib/supabase/server'
import { applyBlocksFor } from '@/lib/applyBlockServer'
import { resolveTutorScope } from '@/lib/jobFeed'
import type { ViewerJobsPayload } from '@/lib/viewerJobsCore'
import { genderApplyBlocked } from '@/lib/genderPref'

// The viewer's side of a list of job cards (push 3, owner 1 Nov 2026). Cached
// public pages render every card as a guest sees it; when the visitor is signed
// in, the page asks here for what changes for THEM: whether they are a tutor,
// their cities and Job Types (the online chip), why Apply is inactive per card,
// and which tuitions they saved. Never cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }

export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get('ids') ?? '')
    .split(',')
    .filter((s) => UUID.test(s))
    .slice(0, 60)
  const session = await getSessionUser().catch(() => null)
  if (!session) return NextResponse.json({ signedIn: false } satisfies ViewerJobsPayload, NO_STORE)
  const ent = await getEntitlements(session.user.id)
  const isTutor = ent.audience === 'tutor'
  if (!isTutor || ids.length === 0) {
    return NextResponse.json({ signedIn: true, isTutor, cities: [], jobTypes: [], blocks: {}, saved: [], genderBlocked: [] } satisfies ViewerJobsPayload, NO_STORE)
  }
  const supabase = await createClient()
  const [{ data: jobs }, resolved, { data: savedRows }, { data: me }] = await Promise.all([
    supabase.from('jobs').select('id, status, gender_preference').in('id', ids),
    resolveTutorScope(supabase, session.user.id).catch(() => null),
    supabase.from('saved_jobs').select('job_id').eq('user_id', session.user.id).in('job_id', ids),
    supabase.from('tutor_profiles').select('gender').eq('id', session.user.id).maybeSingle(),
  ])
  const gender = (me?.gender as string | null) ?? null
  const blocks = await applyBlocksFor(supabase, session.user.id, ent, (jobs ?? []) as { id: string; status: string | null }[]).catch(() => ({}))
  return NextResponse.json(
    {
      signedIn: true,
      isTutor,
      cities: resolved?.cities ?? [],
      jobTypes: resolved?.jobTypes ?? [],
      blocks,
      saved: (savedRows ?? []).map((r) => r.job_id as string),
      genderBlocked: (jobs ?? []).filter((j) => genderApplyBlocked(j.gender_preference as string | null, gender)).map((j) => j.id as string),
    } satisfies ViewerJobsPayload,
    NO_STORE,
  )
}
