import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { tuitionPath } from '@/lib/slugs'
import { budgetLabel } from '@/lib/feeBands'
import { isFixtureTuition } from '@/lib/fixtures'

// The recent open tuitions a tutor's welcome email lists (PR29 §1.2).
//
// A LIVE QUERY, never invented: real open tuitions only. Fixtures (seed and
// bulk-import demo rows) are excluded via the same isFixtureTuition rule the
// sitemap uses — a new tutor must not be sent to a job nobody posted — so the
// list is the genuine team-posted and real-member tuitions, newest first. If
// none are open the caller leaves the whole section out (§1.3).

export type WelcomeTuition = { title: string; city: string; budget: string; href: string }

export async function recentOpenTuitionsForWelcome(limit = 4): Promise<WelcomeTuition[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const { data: jobs } = await admin
    .from('jobs')
    .select(
      'id, title, city, public_slug, job_tx_id, budget_min_pkr, budget_max_pkr, budget_pkr, parent_id, created_at',
    )
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(30)

  const rows = jobs ?? []
  if (rows.length === 0) return []

  // The fixture rule needs the poster: seed account vs the team account. One
  // extra query, then filter — the same shape the sitemap RPC encodes in SQL.
  const parentIds = [...new Set(rows.map((r) => r.parent_id as string).filter(Boolean))]
  const { data: parents } = parentIds.length
    ? await admin.from('profiles').select('id, is_seed, is_team_account').in('id', parentIds)
    : { data: [] as Record<string, unknown>[] }
  const byId = new Map((parents ?? []).map((p) => [p.id as string, p]))

  const out: WelcomeTuition[] = []
  for (const j of rows) {
    const p = byId.get(j.parent_id as string)
    if (
      isFixtureTuition({
        jobTxId: j.job_tx_id as string | null,
        parentIsSeed: (p?.is_seed as boolean | null) ?? false,
        postedByTeam: (p?.is_team_account as boolean | null) ?? false,
      })
    ) {
      continue
    }
    out.push({
      title: ((j.title as string | null) ?? '').trim() || 'Tuition',
      city: ((j.city as string | null) ?? '').trim(),
      budget: budgetLabel(j.budget_min_pkr as number | null, j.budget_max_pkr as number | null, j.budget_pkr as number | null) ?? '',
      href: tuitionPath(j),
    })
    if (out.length >= limit) break
  }
  return out
}
