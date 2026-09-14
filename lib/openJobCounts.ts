import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

// The live open-tuition counts behind the tutor onboarding counter, and the
// demand ordering for its chips (owner, 14 Sep 2026).
//
// EVERY number is a count of real open jobs — never seed/team filtered, because
// the counter's whole job is to show a tutor how much work is waiting, and a
// real open tuition is real work whoever posted it. Matching by subject/level
// is on taxonomy_master ids via job_subjects (rule 12), never subject strings.
//
// Read through the service role: the counter runs before a tutor is listed and
// must see the true board, and it returns only aggregate counts, no personal
// data.

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export type Facet = { name: string; count: number }
export type SubjectFacet = { slug: string; name: string; count: number }
/** A fee band the tutor can tap. `rep` is the representative value stored in
 *  hourly_rate_pkr (bands, never a rupee field). */
export type FeeFacet = { value: string; label: string; rep: number; count: number }

export type OnboardingFacets = {
  national: number
  cities: Facet[]
  /** All areas of a city, ordered by open-job count, keyed by city name. */
  areasByCity: Record<string, Facet[]>
  subjects: SubjectFacet[]
  levels: SubjectFacet[]
  /** Fee bands, ordered by how many open jobs fall in each (real demand). */
  feeBands: FeeFacet[]
}

type OpenJob = { id: string; city: string; area: string; budget: number | null }

// The four fee bands (the same demand bands jobs are posted in — lib/feeBands),
// each with the representative value stored in hourly_rate_pkr.
const FEE_OPTIONS: { value: string; label: string; rep: number }[] = [
  { value: 'u5', label: 'Under Rs 5,000', rep: 4000 },
  { value: '5-10', label: 'Rs 5,000–10,000', rep: 7500 },
  { value: '10-20', label: 'Rs 10,000–20,000', rep: 15000 },
  { value: 'o20', label: 'Over Rs 20,000', rep: 25000 },
]

/** Which fee band a monthly figure falls in (half-open, matching lib/feeBands). */
function bandOf(pkr: number | null): string | null {
  if (pkr == null) return null
  if (pkr < 5000) return 'u5'
  if (pkr < 10000) return '5-10'
  if (pkr < 20000) return '10-20'
  return 'o20'
}

async function openJobs(admin: Admin): Promise<OpenJob[]> {
  const { data } = await admin
    .from('jobs')
    .select('id, city, area, budget_pkr, budget_min_pkr')
    .eq('status', 'open')
    .limit(5000)
  return (data ?? []).map((j) => ({
    id: j.id as string,
    city: ((j.city as string) ?? '').trim(),
    area: ((j.area as string) ?? '').trim(),
    // budget_pkr is the single figure every job carries; the band's lower bound
    // is the fallback for a band-posted job whose figure is that bound.
    budget: (j.budget_pkr as number) ?? (j.budget_min_pkr as number) ?? null,
  }))
}

/** job_id → the subject and level slugs it references (via job_subjects → master). */
async function jobTaxonomy(
  admin: Admin,
  jobIds: string[],
): Promise<Map<string, { subjects: Set<string>; levels: Set<string> }>> {
  const out = new Map<string, { subjects: Set<string>; levels: Set<string> }>()
  if (jobIds.length === 0) return out

  const { data: links } = await admin
    .from('job_subjects')
    .select('job_id, master_id')
    .in('job_id', jobIds)
  const rows = links ?? []
  const masterIds = Array.from(new Set(rows.map((r) => r.master_id as number)))
  if (masterIds.length === 0) return out

  // master_id → { subject_slug, level_slug }. Paginate: taxonomy_master is
  // thousands of rows, but we only ask for the ids actually in use.
  const master = new Map<number, { subject: string | null; level: string | null }>()
  for (let i = 0; i < masterIds.length; i += 1000) {
    const chunk = masterIds.slice(i, i + 1000)
    const { data } = await admin
      .from('taxonomy_master')
      .select('id, subject_slug, level_slug')
      .in('id', chunk)
    for (const m of data ?? []) {
      master.set(m.id as number, {
        subject: (m.subject_slug as string) ?? null,
        level: (m.level_slug as string) ?? null,
      })
    }
  }

  for (const r of rows) {
    const jobId = r.job_id as string
    const m = master.get(r.master_id as number)
    if (!m) continue
    let entry = out.get(jobId)
    if (!entry) {
      entry = { subjects: new Set(), levels: new Set() }
      out.set(jobId, entry)
    }
    if (m.subject) entry.subjects.add(m.subject)
    if (m.level) entry.levels.add(m.level)
  }
  return out
}

const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The facets for the onboarding page: the national count, and every city, area,
 * subject and level with its open-job demand, ordered by that demand descending.
 * The chips are drawn in this order so the busiest choices come first.
 */
export async function onboardingFacets(): Promise<OnboardingFacets | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const jobs = await openJobs(admin)
  const national = jobs.length

  const [{ data: cityRows }, { data: areaRows }, { data: subjectRows }, { data: levelRows }, tax] =
    await Promise.all([
      admin.from('location_cities').select('name, sort_order'),
      admin.from('location_areas').select('name, city_id'),
      admin.from('taxonomy_subjects').select('slug, name'),
      // Non-legacy levels only — the pickers never offer a retired level.
      admin.from('taxonomy_levels').select('slug, name').eq('legacy', false),
      jobTaxonomy(
        admin,
        jobs.map((j) => j.id),
      ),
    ])

  // City id → name, for grouping areas under their city.
  const { data: cityIdRows } = await admin.from('location_cities').select('id, name')
  const cityNameById = new Map((cityIdRows ?? []).map((c) => [c.id as number, c.name as string]))

  // ---- city demand ----
  const cities: Facet[] = (cityRows ?? [])
    .map((c) => ({
      name: c.name as string,
      count: jobs.filter((j) => ci(j.city, c.name as string)).length,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  // ---- area demand, per city ----
  const areasByCity: Record<string, Facet[]> = {}
  for (const a of areaRows ?? []) {
    const cityName = cityNameById.get(a.city_id as number)
    if (!cityName) continue
    const areaName = a.name as string
    const count = jobs.filter((j) => ci(j.city, cityName) && ci(j.area, areaName)).length
    ;(areasByCity[cityName] ??= []).push({ name: areaName, count })
  }
  for (const city of Object.keys(areasByCity)) {
    areasByCity[city].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }

  // ---- subject & level demand ----
  const subjectCount = new Map<string, number>()
  const levelCount = new Map<string, number>()
  for (const entry of tax.values()) {
    for (const s of entry.subjects) subjectCount.set(s, (subjectCount.get(s) ?? 0) + 1)
    for (const l of entry.levels) levelCount.set(l, (levelCount.get(l) ?? 0) + 1)
  }

  const subjects: SubjectFacet[] = (subjectRows ?? [])
    .map((s) => ({
      slug: s.slug as string,
      name: s.name as string,
      count: subjectCount.get(s.slug as string) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const levels: SubjectFacet[] = (levelRows ?? [])
    .map((l) => ({
      slug: l.slug as string,
      name: l.name as string,
      count: levelCount.get(l.slug as string) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  // ---- fee band demand ----
  const feeCount = new Map<string, number>()
  for (const j of jobs) {
    const band = bandOf(j.budget)
    if (band) feeCount.set(band, (feeCount.get(band) ?? 0) + 1)
  }
  const feeBands: FeeFacet[] = FEE_OPTIONS.map((f) => ({
    ...f,
    count: feeCount.get(f.value) ?? 0,
  })).sort((a, b) => b.count - a.count)

  return { national, cities, areasByCity, subjects, levels, feeBands }
}

export type CountFilters = {
  city?: string | null
  area?: string | null
  subjectSlugs?: string[]
  levelSlugs?: string[]
}

export type OnboardingCounts = {
  national: number
  city: number | null
  area: number | null
  subjects: number | null
  level: number | null
}

/**
 * The scoped open-tuition counts for the live counter, given the answers so far.
 * Each field is the open-job count at one scope; the client applies the floor
 * rule (never show a lonely small number — always a broader fallback).
 */
export async function onboardingCounts(filters: CountFilters): Promise<OnboardingCounts> {
  const admin = createAdminClient()
  if (!admin) return { national: 0, city: null, area: null, subjects: null, level: null }

  const jobs = await openJobs(admin)
  const national = jobs.length

  const hasCity = !!filters.city
  const hasArea = !!filters.area
  const subjectSlugs = filters.subjectSlugs ?? []
  const levelSlugs = filters.levelSlugs ?? []

  const inCity = hasCity ? jobs.filter((j) => ci(j.city, filters.city!)) : jobs
  const inArea = hasArea ? inCity.filter((j) => ci(j.area, filters.area!)) : inCity

  const city = hasCity ? inCity.length : null
  const area = hasArea ? inArea.length : null

  // Subject/level narrowing needs the per-job taxonomy for the geo-scoped set.
  let subjects: number | null = null
  let level: number | null = null
  if (subjectSlugs.length > 0) {
    const scope = hasArea ? inArea : inCity
    const tax = await jobTaxonomy(
      admin,
      scope.map((j) => j.id),
    )
    const subjectSet = new Set(subjectSlugs)
    const levelSet = new Set(levelSlugs)
    subjects = scope.filter((j) => {
      const t = tax.get(j.id)
      return t && [...t.subjects].some((s) => subjectSet.has(s))
    }).length
    if (levelSlugs.length > 0) {
      level = scope.filter((j) => {
        const t = tax.get(j.id)
        return (
          t &&
          [...t.subjects].some((s) => subjectSet.has(s)) &&
          [...t.levels].some((l) => levelSet.has(l))
        )
      }).length
    }
  }

  return { national, city, area, subjects, level }
}
