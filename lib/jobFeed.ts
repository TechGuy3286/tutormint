// lib/jobFeed.ts
//
// Open tuitions, shaped for JobCard.
//
// Two things need care here.
//
// 1. Matching is on taxonomy_master ids, never on subject strings. "O Levels
//    Physics" matches only "O Levels Physics" -- not "Physics" at Primary --
//    because both sides store master ids in join tables.
//
// 2. The parent's badges and hire rights come from their plan, and a tutor
//    cannot read `profiles` rows other than their own under RLS. That lookup
//    therefore goes through the service-role client, and returns first name,
//    badges and can_hire only. Nothing else about the parent crosses over.
//    Tutors have asked for exactly one thing before spending an application:
//    whether the person on the other end can actually complete a hire.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { badgesForPlan, type BadgeName } from '@/lib/entitlements'
import type { JobCardData } from '@/components/JobCard'

type ParentFacts = { name: string | null; badges: BadgeName[]; canHire: boolean }

async function parentFacts(ids: string[]): Promise<Map<string, ParentFacts>> {
  const out = new Map<string, ParentFacts>()
  if (ids.length === 0) return out

  const admin = createAdminClient()
  if (!admin) return out

  const [{ data: profiles }, { data: subs }, { data: plans }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, profile_completion, cnic_verified_at, address_verified_at')
      .in('id', ids),
    admin
      .from('subscriptions')
      .select('user_id, plan_code, expires_at')
      .in('user_id', ids)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString()),
    admin.from('plans').select('code, audience, can_hire, search_rank'),
  ])

  const planByCode = new Map(
    (plans ?? []).map((p) => [p.code as string, p as { code: string; audience: string; can_hire: boolean; search_rank: number }]),
  )

  const bestPlan = new Map<string, string>()
  for (const s of subs ?? []) {
    const p = planByCode.get(s.plan_code as string)
    if (!p || p.audience !== 'parent') continue
    const current = bestPlan.get(s.user_id as string)
    if (!current || (planByCode.get(current)?.search_rank ?? 0) < p.search_rank) {
      bestPlan.set(s.user_id as string, p.code)
    }
  }

  for (const p of profiles ?? []) {
    const id = p.id as string
    // A verified parent pays nothing, so they have no subscription row; their
    // free plan is implied by CNIC + address approval.
    let code = bestPlan.get(id) ?? null
    if (!code && p.cnic_verified_at && p.address_verified_at) code = 'parent_verified'

    out.set(id, {
      name: (p.full_name as string | null)?.split(' ')[0] ?? null,
      badges: badgesForPlan(code, (p.profile_completion ?? 0) >= 100),
      canHire: !!(code && planByCode.get(code)?.can_hire),
    })
  }

  return out
}

async function decorate(rawJobs: Record<string, unknown>[]): Promise<JobCardData[]> {
  if (rawJobs.length === 0) return []

  const supabase = await createClient()
  const jobIds = rawJobs.map((j) => j.id as string)

  // Subject labels for the chips, resolved from the join table.
  const { data: links } = await supabase
    .from('job_subjects')
    .select('job_id, master_id')
    .in('job_id', jobIds)

  const masterIds = Array.from(new Set((links ?? []).map((l) => l.master_id as number)))
  const labelByMaster = new Map<number, string>()

  if (masterIds.length > 0) {
    const { data: master } = await supabase
      .from('taxonomy_master')
      .select('id, level_slug, subject_slug')
      .in('id', masterIds)

    const levelSlugs = Array.from(new Set((master ?? []).map((m) => m.level_slug as string)))
    const subjectSlugs = Array.from(
      new Set((master ?? []).map((m) => m.subject_slug as string | null).filter(Boolean) as string[]),
    )

    const [{ data: levels }, { data: subjects }] = await Promise.all([
      supabase.from('taxonomy_levels').select('slug, name').in('slug', levelSlugs),
      subjectSlugs.length > 0
        ? supabase.from('taxonomy_subjects').select('slug, name').in('slug', subjectSlugs)
        : Promise.resolve({ data: [] as { slug: string; name: string }[] }),
    ])

    const levelName = new Map((levels ?? []).map((l) => [l.slug as string, l.name as string]))
    const subjectName = new Map((subjects ?? []).map((s) => [s.slug as string, s.name as string]))

    for (const m of master ?? []) {
      const subject = m.subject_slug ? subjectName.get(m.subject_slug as string) : null
      labelByMaster.set(m.id as number, subject ?? levelName.get(m.level_slug as string) ?? '')
    }
  }

  const subjectsByJob = new Map<string, string[]>()
  for (const l of links ?? []) {
    const label = labelByMaster.get(l.master_id as number)
    if (!label) continue
    const list = subjectsByJob.get(l.job_id as string) ?? []
    if (!list.includes(label)) list.push(label)
    subjectsByJob.set(l.job_id as string, list)
  }

  const facts = await parentFacts(
    Array.from(new Set(rawJobs.map((j) => j.parent_id as string).filter(Boolean))),
  )

  return rawJobs.map((j) => {
    const f = facts.get(j.parent_id as string)
    return {
      id: j.id as string,
      job_tx_id: (j.job_tx_id as string) ?? null,
      title: (j.title as string) ?? 'Tuition required',
      // Fall back to the legacy text column for jobs posted before the join
      // table existed, so old posts still show what they are for.
      subjects: subjectsByJob.get(j.id as string) ?? (j.subjects as string[] | null) ?? null,
      class_level: (j.class_level as string) ?? null,
      city: (j.city as string) ?? null,
      area: (j.area as string) ?? null,
      teaching_mode: (j.teaching_mode as string) ?? null,
      budget_pkr: (j.budget_pkr as number) ?? null,
      description: (j.description as string) ?? null,
      created_at: (j.created_at as string) ?? new Date().toISOString(),
      is_featured: (j.is_featured as boolean) ?? false,
      parent_id: (j.parent_id as string) ?? null,
      parent_name: f?.name ?? null,
      parent_badges: f?.badges ?? [],
      parent_can_hire: f?.canHire ?? false,
    }
  })
}

const JOB_COLUMNS =
  'id, job_tx_id, title, subjects, class_level, city, area, teaching_mode, budget_pkr, description, created_at, is_featured, parent_id, status'

/**
 * Open jobs that match a tutor's subjects, their city first.
 *
 * A tutor with no subjects saved yet gets the open jobs in their city rather
 * than an empty list -- an empty dashboard tells them nothing about whether
 * the platform has work on it.
 */
export async function matchingJobsForTutor(
  tutorId: string,
  city: string | null,
  limit = 5,
): Promise<JobCardData[]> {
  const supabase = await createClient()

  const { data: mine } = await supabase
    .from('tutor_subjects')
    .select('master_id')
    .eq('tutor_id', tutorId)

  const masterIds = (mine ?? []).map((m) => m.master_id as number)

  let jobIds: string[] = []
  if (masterIds.length > 0) {
    const { data: links } = await supabase
      .from('job_subjects')
      .select('job_id')
      .in('master_id', masterIds)
    jobIds = Array.from(new Set((links ?? []).map((l) => l.job_id as string)))
  }

  let query = supabase.from('jobs').select(JOB_COLUMNS).eq('status', 'open')

  if (jobIds.length > 0) {
    query = query.in('id', jobIds)
  } else if (city) {
    query = query.ilike('city', city)
  }

  const { data } = await query
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  return decorate((data ?? []) as Record<string, unknown>[])
}

/** Every open job, featured first. Used by /tutor/dashboard/jobs. */
export async function openJobs(limit = 50): Promise<JobCardData[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('jobs')
    .select(JOB_COLUMNS)
    .eq('status', 'open')
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  return decorate((data ?? []) as Record<string, unknown>[])
}

export type JobFilters = {
  masterId: number | null
  city: string | null
  mode: string | null
  budgetMin: number | null
  budgetMax: number | null
  q: string | null
}

/**
 * The public tuition board.
 *
 * Ranking is the whole of the jobs rule from CLAUDE.md: featured jobs first,
 * then newest. There is nothing to blend and nothing to tune -- a parent buys
 * the top of this list, and a tutor should be able to predict what they are
 * looking at.
 *
 * Filtering on subject compares taxonomy_master ids through job_subjects, so
 * "O Levels Physics" matches only that, never "Physics" at Primary.
 */
export async function browseJobs(
  filters: JobFilters,
  limit = 12,
  offset = 0,
): Promise<{ jobs: JobCardData[]; total: number }> {
  const supabase = await createClient()

  let matchingIds: string[] | null = null
  if (filters.masterId) {
    const { data: links } = await supabase
      .from('job_subjects')
      .select('job_id')
      .eq('master_id', filters.masterId)
    matchingIds = Array.from(new Set((links ?? []).map((l) => l.job_id as string)))
    if (matchingIds.length === 0) return { jobs: [], total: 0 }
  }

  const build = () => {
    let q = supabase.from('jobs').select(JOB_COLUMNS, { count: 'exact' }).eq('status', 'open')
    if (matchingIds) q = q.in('id', matchingIds)
    if (filters.city) q = q.ilike('city', filters.city)
    if (filters.mode) {
      // "Both" satisfies a search for either mode, the same way it does for
      // tutors -- a parent open to either should see both kinds of job.
      q = q.or(`teaching_mode.ilike.${filters.mode},teaching_mode.ilike.Both`)
    }
    if (filters.budgetMin !== null) q = q.gte('budget_pkr', filters.budgetMin)
    if (filters.budgetMax !== null) q = q.lte('budget_pkr', filters.budgetMax)
    if (filters.q) q = q.ilike('title', `%${filters.q}%`)
    return q
  }

  const { data, count } = await build()
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  return {
    jobs: await decorate((data ?? []) as Record<string, unknown>[]),
    total: count ?? 0,
  }
}

/** One job by its human id or uuid, for the detail view. */
export async function jobByRef(ref: string): Promise<JobCardData | null> {
  const supabase = await createClient()
  const isUuid = /^[0-9a-f-]{36}$/i.test(ref)

  const { data } = await supabase
    .from('jobs')
    .select(JOB_COLUMNS)
    .eq(isUuid ? 'id' : 'job_tx_id', ref)
    .maybeSingle()

  if (!data) return null
  const [job] = await decorate([data as Record<string, unknown>])
  return job ?? null
}
