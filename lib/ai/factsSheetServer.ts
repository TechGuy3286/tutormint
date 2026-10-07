import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { liveCombinationsAll, LANDING_THRESHOLD } from '@/lib/landing'
import { cityPages, CITY_PAGE_THRESHOLD } from '@/lib/cityJobs'
import { buildPlatformFacts, DEFAULT_PLANS, type FactsPlan, type PlatformFacts } from './factsSheet'

// The facts sheet built from the LIVE plan rows (owner, 7 Oct 2026), read at
// request time so a plan change reaches the writer and the checker at once.
// Falls back to the built-in rows only when the database cannot be read.

export async function loadPlatformFacts(): Promise<PlatformFacts> {
  const admin = createAdminClient()
  if (!admin) return buildPlatformFacts(DEFAULT_PLANS)
  const { data, error } = await admin
    .from('plans')
    .select('code, audience, name, active, can_initiate_message, can_view_contact, can_hire, search_rank, monthly_quota')
  if (error || !data?.length) return buildPlatformFacts(DEFAULT_PLANS)
  const plans: FactsPlan[] = data.map((r) => ({
    code: r.code as string,
    audience: r.audience === 'parent' ? 'parent' : 'tutor',
    name: r.name as string,
    active: r.active !== false,
    canInitiateMessage: !!r.can_initiate_message,
    canViewContact: !!r.can_view_contact,
    canHire: !!r.can_hire,
    searchRank: Number(r.search_rank ?? 0),
    monthlyQuota: Number(r.monthly_quota ?? 0),
  }))
  return buildPlatformFacts(plans)
}

/**
 * The pages a post must NOT link because Google is told not to index them right
 * now, each with the page to link instead (owner, 7 Oct 2026):
 *   - a city × subject landing page with fewer than 3 listings (it renders, but
 *     is noindex) → the matching /tuition-jobs/<city> page when that city page
 *     is indexable, else /browse/tuitions;
 *   - a /tuition-jobs/<city> page under its threshold → /browse/tuitions.
 * Plus the indexable /tuition-jobs/<city> pages, which are valid link targets.
 */
export async function loadLinkIndexing(): Promise<{ noindexLinks: Record<string, string>; cityJobPaths: string[] }> {
  const [combos, cities] = await Promise.all([liveCombinationsAll().catch(() => []), cityPages().catch(() => [])])
  const cityOk = new Set(cities.filter((c) => c.count >= CITY_PAGE_THRESHOLD).map((c) => c.citySlug))
  const cityJobPaths = [...cityOk].map((s) => `/tuition-jobs/${s}`)
  const noindexLinks: Record<string, string> = {}
  for (const c of combos) {
    if (c.count >= LANDING_THRESHOLD) continue
    noindexLinks[`/${c.kind}/${c.citySlug}/${c.subjectSlug}`] = cityOk.has(c.citySlug)
      ? `/tuition-jobs/${c.citySlug}`
      : '/browse/tuitions'
  }
  for (const c of cities) {
    if (c.count < CITY_PAGE_THRESHOLD) noindexLinks[`/tuition-jobs/${c.citySlug}`] = '/browse/tuitions'
  }
  return { noindexLinks, cityJobPaths }
}
