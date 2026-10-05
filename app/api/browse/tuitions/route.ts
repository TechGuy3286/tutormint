import { NextResponse } from 'next/server'

import { getEntitlements } from '@/lib/entitlements'
import {
  browseJobs,
  resolveTutorScope,
  tutorFeed,
  feedGenderFilter,
  type JobFilters,
  type FeedLevel,
} from '@/lib/jobFeed'
import { createClient } from '@/lib/supabase/server'
import { applyBlocksFor, type ApplyBlockMap } from '@/lib/applyBlockServer'

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

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // scope=mine (PR71/PR85): the tutor's own feed. Re-derived from the caller's
  // own session — never from the query string — so a later window filters
  // exactly as the server-rendered first window did. `level` (from the first
  // window) keeps load-more paging the SAME fallback level. A signed-in tutor is
  // always gender-filtered (Part C), even on the plain board.
  let viewerGender: string | null = null
  if (user) {
    const ent = await getEntitlements(user.id)
    if (ent.audience === 'tutor') {
      const resolved = await resolveTutorScope(supabase, user.id)
      viewerGender = feedGenderFilter(resolved?.gender)

      if (get('scope') === 'mine' && resolved) {
        const lvl = Number(get('level'))
        const forceLevel: FeedLevel | undefined = lvl === 1 || lvl === 2 || lvl === 3 ? (lvl as FeedLevel) : undefined
        const feed = await tutorFeed(supabase, resolved, viewerGender, {
          limit: PAGE_SIZE,
          cursor: get('cursor') || null,
          forceLevel,
        })
        return respond(feed.jobs, feed.nextCursor, user.id, supabase)
      }
    }
  }

  const filters: JobFilters = {
    masterId: intOrNull(get('subject')),
    city: get('city') || null,
    mode: get('mode') || null,
    budgetMin: intOrNull(get('budgetMin')),
    budgetMax: intOrNull(get('budgetMax')),
    q: get('q') || null,
    tutorScope: null,
    viewerGender,
  }

  const { jobs, nextCursor } = await browseJobs(filters, PAGE_SIZE, 0, get('cursor') || null)
  return respond(jobs, nextCursor, user?.id ?? null, supabase)
}

async function respond(
  jobs: Awaited<ReturnType<typeof browseJobs>>['jobs'],
  nextCursor: string | null,
  userId: string | null,
  supabase: Awaited<ReturnType<typeof createClient>>,
) {

  // Why Apply is inactive per job (owner, 5 Oct 2026) — the same shared rule the
  // first window used; `applied` is derived from it.
  let blocks: ApplyBlockMap = {}
  if (userId && jobs.length > 0) {
    const ent = await getEntitlements(userId)
    if (ent.audience === 'tutor') blocks = await applyBlocksFor(supabase, userId, ent, jobs)
  }

  // Merged ONTO each item, not returned beside them. useInfinite appends
  // page.items and reads nothing else off the response, so the sibling
  // `applied` array this used to send was dropped on the floor -- every card
  // after the first window offered Apply to a tutor who had already applied.
  return NextResponse.json({
    items: jobs.map((j) => ({ ...j, applied: blocks[j.id]?.kind === 'applied', applyBlock: blocks[j.id] ?? null })),
    cursor: nextCursor,
  })
}
