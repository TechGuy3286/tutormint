// lib/browseCities.ts
//
// The cities the Browse filters offer (owner, 20 Oct 2026): only those with an
// open tuition or a listed tutor right now, so a visitor never scrolls through
// hundreds of empty towns. Every city stays choosable on the posting and
// sign-up forms. Cached for ten minutes; public data only (open tuitions are
// world-readable, tutor_directory is the public listing view).

import 'server-only'

import { unstable_cache } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'

async function activeCities(): Promise<string[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const [jobs, tutors] = await Promise.all([
    pageAll((from, to) => admin.from('jobs').select('id, city').eq('status', 'open').order('id').range(from, to)),
    pageAll((from, to) => admin.from('tutor_directory').select('id, city').order('id').range(from, to)),
  ])
  const seen = new Map<string, string>()
  for (const r of [...jobs, ...tutors]) {
    const c = ((r.city as string | null) ?? '').trim()
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c)
  }
  return [...seen.values()]
}

export const browseCitiesCached = unstable_cache(activeCities, ['browse-active-cities'], { revalidate: 600 })
