// lib/hiddenTuition.ts
//
// Server reads for hidden tuitions (rules in lib/hiddenTuitionCore). Service
// role: the jobs table is world-readable anyway, but these feed admin and
// tutor screens that must agree with each other.

import { createAdminClient } from '@/lib/supabase/admin'
import { hiddenTuitionTarget } from '@/lib/hiddenTuitionCore'
import { pageAllIn } from '@/lib/pageAll'

/** The address a hidden tuition redirects to (the page's 308 backstop). */
export async function hiddenTuitionTargetFor(city: string | null | undefined): Promise<string> {
  const c = (city ?? '').trim()
  if (!c) return hiddenTuitionTarget(null, false)
  const admin = createAdminClient()
  if (!admin) return hiddenTuitionTarget(null, false)
  const { data } = await admin.from('jobs').select('id').eq('status', 'open').ilike('city', c).limit(1)
  return hiddenTuitionTarget(c, (data ?? []).length > 0)
}

/** Which of these tuitions are hidden. */
export async function hiddenJobIds(jobIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(jobIds.filter(Boolean))]
  if (ids.length === 0) return new Set()
  const admin = createAdminClient()
  if (!admin) return new Set()
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin.from('jobs').select('id').in('id', part).eq('status', 'hidden').order('id').range(from, to),
  )
  return new Set(rows.map((r) => r.id as string))
}
