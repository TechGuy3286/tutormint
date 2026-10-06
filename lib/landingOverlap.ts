// lib/landingOverlap.ts
//
// Near-duplicate landing pages (owner, 6 Oct 2026, item 13).
//
// Two landing pages of the same kind in the same city whose listed results are
// 80% or more identical are near-duplicates: the NARROWER one (fewer results —
// ties broken by the smaller master id, so the choice is stable) becomes
// noindex, follow and leaves the sitemap; the broader one stays indexable. The
// rule is computed from the live listings every time it is asked, so it
// re-checks itself as data changes: a page that stops overlapping is indexable
// again on the next request, with no flag to clear.
//
// The pure half (`overlapNoindexSet`) is unit-tested; the loader reads the same
// anon-readable views the landing pages themselves read.

import 'server-only'

import { createPublicClient } from '@/lib/supabase/public'
import { citySegment } from '@/lib/slugs'
import type { LandingKind } from '@/lib/landing'

export { OVERLAP_THRESHOLD, overlapKey, overlapNoindexSet, type PageMembers } from './landingOverlapCore'
import { overlapNoindexSet, type PageMembers } from './landingOverlapCore'

/** Live member sets for every (kind, city, master) with at least one listing. */
export async function loadLandingMembers(): Promise<PageMembers[]> {
  const db = createPublicClient()
  const out = new Map<string, PageMembers>()
  const add = (kind: LandingKind, city: string | null, masterId: number, id: string) => {
    if (!city || !city.trim()) return
    const citySlug = citySegment(city)
    const k = `${kind}/${citySlug}/${masterId}`
    const p = out.get(k) ?? out.set(k, { kind, citySlug, masterId, ids: [] }).get(k)!
    if (!p.ids.includes(id)) p.ids.push(id)
  }

  // Tutors: listed tutors × their subjects.
  const { data: tutors } = await db.from('tutor_directory').select('id, city').limit(5000)
  const tutorCity = new Map((tutors ?? []).map((t) => [t.id as string, (t.city as string | null) ?? null]))
  if (tutorCity.size > 0) {
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', [...tutorCity.keys()]).range(from, from + 999)
      const rows = data ?? []
      for (const r of rows) add('tutors', tutorCity.get(r.tutor_id as string) ?? null, r.master_id as number, r.tutor_id as string)
      if (rows.length < 1000) break
    }
  }

  // Tuitions: open jobs × their subjects.
  const jobCity = new Map<string, string | null>()
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('jobs').select('id, city').eq('status', 'open').range(from, from + 999)
    const rows = data ?? []
    for (const r of rows) jobCity.set(r.id as string, (r.city as string | null) ?? null)
    if (rows.length < 1000) break
  }
  const jobIds = [...jobCity.keys()]
  for (let i = 0; i < jobIds.length; i += 300) {
    const chunk = jobIds.slice(i, i + 300)
    const { data } = await db.from('job_subjects').select('job_id, master_id').in('job_id', chunk).limit(5000)
    for (const r of data ?? []) add('tuitions', jobCity.get(r.job_id as string) ?? null, r.master_id as number, r.job_id as string)
  }
  return [...out.values()]
}

/** The live noindex set, keyed `${kind}/${citySlug}/${masterId}`. */
export async function liveOverlapNoindex(): Promise<Map<string, { kind: LandingKind; citySlug: string; masterId: number }>> {
  return overlapNoindexSet(await loadLandingMembers())
}

