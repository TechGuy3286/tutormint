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

import { pageAll, pageAllIn } from '@/lib/pageAll'
import { testAccountIds } from '@/lib/testAccounts'
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

  // Tutors: listed tutors × their subjects. Every read PAGED (owner, 8 Oct 2026).
  const tutors = await pageAll((from, to) => db.from('tutor_directory').select('id, city').order('id').range(from, to))
  const tutorCity = new Map(tutors.map((t) => [t.id as string, (t.city as string | null) ?? null]))
  const tutorLinks = await pageAllIn([...tutorCity.keys()], (ids, from, to) =>
    db.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', ids).order('tutor_id').order('master_id').range(from, to),
  )
  for (const r of tutorLinks) add('tutors', tutorCity.get(r.tutor_id as string) ?? null, r.master_id as number, r.tutor_id as string)

  // Tuitions: open jobs × their subjects (test-named posters excluded, as in
  // landing_combinations).
  const testIds = new Set(await testAccountIds())
  const jobs = await pageAll((from, to) =>
    db.from('jobs').select('id, city, parent_id').eq('status', 'open').order('id').range(from, to),
  )
  const jobCity = new Map<string, string | null>()
  for (const r of jobs) if (!testIds.has(r.parent_id as string)) jobCity.set(r.id as string, (r.city as string | null) ?? null)
  const jobLinks = await pageAllIn([...jobCity.keys()], (ids, from, to) =>
    db.from('job_subjects').select('job_id, master_id').in('job_id', ids).order('job_id').order('master_id').range(from, to),
  )
  for (const r of jobLinks) add('tuitions', jobCity.get(r.job_id as string) ?? null, r.master_id as number, r.job_id as string)
  return [...out.values()]
}

/** The live noindex set, keyed `${kind}/${citySlug}/${masterId}`. */
export async function liveOverlapNoindex(): Promise<Map<string, { kind: LandingKind; citySlug: string; masterId: number }>> {
  return overlapNoindexSet(await loadLandingMembers())
}

