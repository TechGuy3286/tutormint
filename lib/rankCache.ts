import 'server-only'

// lib/rankCache.ts — the precomputed ranking (PR-17 Part A, migration 243).
//
// refresh_tutor_rank_cache(null) rebuilds tutor_rank_cache + the stored landing
// counts (only changed rows are written); the 1-minute admin cron calls it.
// refresh_tutor_rank_cache([id]) refreshes one tutor at once — a new or edited
// review (PR-17 Part B), so the rebuilt Browse / landing cards show the new
// rating straight away instead of after the next minute.

import { createAdminClient } from '@/lib/supabase/admin'

/** Full refresh. Returns rows changed, -1 when another refresh is running,
 *  null on failure (rank_tutors falls back to its live body by itself). */
export async function refreshRankCache(): Promise<number | null> {
  try {
    const admin = createAdminClient()
    if (!admin) return null
    const { data, error } = await admin.rpc('refresh_tutor_rank_cache', { p_ids: null })
    if (error) {
      console.error(`[rank-cache] refresh failed code=${error.code ?? '?'}`)
      return null
    }
    return typeof data === 'number' ? data : Number(data ?? 0)
  } catch {
    return null
  }
}

/** Refresh just these tutors' cache rows. Never throws. */
export async function refreshRankCacheFor(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    const admin = createAdminClient()
    if (!admin) return
    const { error } = await admin.rpc('refresh_tutor_rank_cache', { p_ids: ids })
    if (error) console.error(`[rank-cache] targeted refresh failed code=${error.code ?? '?'}`)
  } catch {
    /* the minute refresh still applies */
  }
}
