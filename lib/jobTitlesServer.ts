import 'server-only'

import { createPublicClient } from '@/lib/supabase/public'
import { sortJobTitles } from '@/lib/jobTitlesCore'

// The server-side read of the Job Type titles, for the write paths that validate
// against the curated set (the app-layer check that stands in for the CHECK
// constraint the data model deliberately omits). Read through the anon/public
// client — job_titles is world-readable reference data (migration 77).

/** The ordered titles, or [] when the table is unreachable. */
export async function loadJobTitles(): Promise<string[]> {
  try {
    const sb = createPublicClient()
    const { data } = await sb.from('job_titles').select('name, sort_order')
    return sortJobTitles(
      (data ?? []).map((r) => ({ name: r.name as string, sort_order: (r.sort_order as number) ?? 100 })),
    )
  } catch {
    return []
  }
}
