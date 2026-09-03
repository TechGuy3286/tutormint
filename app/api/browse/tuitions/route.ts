import { NextResponse } from 'next/server'

import { getEntitlements } from '@/lib/entitlements'
import { browseJobs, type JobFilters } from '@/lib/jobFeed'
import { createClient } from '@/lib/supabase/server'

// Load-more for /browse/tuitions.
//
// PUBLIC, like the page it extends. browseJobs returns exactly what JobCard
// renders — the parent's first name, badges, avatar and whether they can hire.
// Phone, WhatsApp and email are not in that shape and cannot leave through
// here; the contact gate is unchanged.
//
// "Have I already applied?" is resolved from the caller's own session, never
// from an id in the query string, so nobody can read another tutor's
// application history by asking for it.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 12

function intOrNull(v: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const get = (k: string) => (url.searchParams.get(k) ?? '').trim()

  const filters: JobFilters = {
    masterId: intOrNull(get('subject')),
    city: get('city') || null,
    mode: get('mode') || null,
    budgetMin: intOrNull(get('budgetMin')),
    budgetMax: intOrNull(get('budgetMax')),
    q: get('q') || null,
  }

  const { jobs, nextCursor } = await browseJobs(filters, PAGE_SIZE, 0, get('cursor') || null)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let applied: string[] = []
  if (user && jobs.length > 0) {
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
      applied = (data ?? []).map((a) => a.job_id as string)
    }
  }

  return NextResponse.json({ items: jobs, cursor: nextCursor, applied })
}
