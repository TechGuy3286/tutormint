import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { applyBlockFor, type ApplyBlock } from '@/lib/applyBlock'
import { isUnlimitedDisplay, type Entitlements } from '@/lib/entitlements'

// The one server loader behind every Apply surface: given the signed-in TUTOR's
// entitlements and a window of jobs, it reads that tutor's own applications for
// those jobs (through the caller's RLS-scoped client — a member sees only their
// own rows) and returns the reason each job's Apply is inactive, or null.
//
// Used by the Browse first window and its load-more route, the tutor jobs board
// and its load-more route, the saved-tuitions list and the tuition page, so the
// five surfaces share one rule (lib/applyBlock.ts) and one query shape.

export type ApplyBlockMap = Record<string, ApplyBlock | null>

export async function applyBlocksFor(
  supabase: SupabaseClient,
  tutorId: string,
  ent: Entitlements,
  jobs: { id: string; status?: string | null }[],
): Promise<ApplyBlockMap> {
  const out: ApplyBlockMap = {}
  if (jobs.length === 0) return out

  const { data } = await supabase
    .from('applications')
    .select('job_id, created_at')
    .eq('tutor_id', tutorId)
    .in(
      'job_id',
      jobs.map((j) => j.id),
    )
  const appliedAt = new Map<string, string>()
  for (const a of data ?? []) {
    const id = a.job_id as string
    const at = a.created_at as string
    // The earliest application is the one the member made (a withdrawn one still
    // used the quota and still shows as applied — no refund, as the rules say).
    const prev = appliedAt.get(id)
    if (!prev || at < prev) appliedAt.set(id, at)
  }

  const shared = {
    hasPlan: !!ent.plan,
    quotaLeft: ent.quotaLeft,
    quota: ent.quota,
    unlimitedDisplay: isUnlimitedDisplay(ent.displayedQuota),
    docRejected: !!ent.docRejected,
    reuploadHref: ent.reuploadHref ?? null,
  }
  for (const j of jobs) {
    out[j.id] = applyBlockFor({ ...shared, appliedAt: appliedAt.get(j.id) ?? null, jobStatus: j.status ?? null })
  }
  return out
}
