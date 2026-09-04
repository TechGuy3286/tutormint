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
//    badges, avatar and can_hire only. Nothing else about the parent crosses
//    over. Tutors have asked for exactly one thing before spending an
//    application: whether the person on the other end can actually complete a
//    hire.
//
//    The avatar is part of that set on purpose. A photo is not contact
//    information -- it cannot be dialled, messaged or looked up -- and the
//    profile it comes from is one a tutor may already open from an applicant
//    thread. Phone, WhatsApp and email stay behind canViewContact as before.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { badgesForPlan, type BadgeName } from '@/lib/entitlements'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import type { JobCardData } from '@/components/JobCard'

type ParentFacts = {
  name: string | null
  avatarUrl: string | null
  badges: BadgeName[]
  canHire: boolean
}

async function parentFacts(ids: string[]): Promise<Map<string, ParentFacts>> {
  const out = new Map<string, ParentFacts>()
  if (ids.length === 0) return out

  const admin = createAdminClient()
  if (!admin) return out

  const [{ data: profiles }, { data: subs }, { data: plans }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, avatar_url, profile_completion, cnic_verified_at, address_verified_at')
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
      avatarUrl: (p.avatar_url as string | null) ?? null,
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
  // The same labels with their taxonomy ids attached, so a subject chip can be
  // a link to the tutors who teach that exact thing rather than a dead pill.
  // Matching is on master_id everywhere, so the link lands on the same set the
  // job itself would match against.
  const linksByJob = new Map<string, { label: string; masterId: number }[]>()
  for (const l of links ?? []) {
    const label = labelByMaster.get(l.master_id as number)
    if (!label) continue
    const list = subjectsByJob.get(l.job_id as string) ?? []
    if (!list.includes(label)) list.push(label)
    subjectsByJob.set(l.job_id as string, list)

    const linked = linksByJob.get(l.job_id as string) ?? []
    if (!linked.some((x) => x.label === label)) {
      linked.push({ label, masterId: l.master_id as number })
    }
    linksByJob.set(l.job_id as string, linked)
  }

  const facts = await parentFacts(
    Array.from(new Set(rawJobs.map((j) => j.parent_id as string).filter(Boolean))),
  )

  return rawJobs.map((j) => {
    const f = facts.get(j.parent_id as string)
    return {
      id: j.id as string,
      job_tx_id: (j.job_tx_id as string) ?? null,
      public_slug: (j.public_slug as string) ?? null,
      status: (j.status as string) ?? 'open',
      title: (j.title as string) ?? 'Tuition required',
      // Fall back to the legacy text column for jobs posted before the join
      // table existed, so old posts still show what they are for.
      subjects: subjectsByJob.get(j.id as string) ?? (j.subjects as string[] | null) ?? null,
      subject_links: linksByJob.get(j.id as string) ?? [],
      class_level: (j.class_level as string) ?? null,
      city: (j.city as string) ?? null,
      area: (j.area as string) ?? null,
      teaching_mode: (j.teaching_mode as string) ?? null,
      budget_pkr: (j.budget_pkr as number) ?? null,
      budget_min_pkr: (j.budget_min_pkr as number) ?? null,
      budget_max_pkr: (j.budget_max_pkr as number) ?? null,
      description: (j.description as string) ?? null,
      created_at: (j.created_at as string) ?? new Date().toISOString(),
      is_featured: (j.is_featured as boolean) ?? false,
      parent_id: (j.parent_id as string) ?? null,
      parent_name: f?.name ?? null,
      parent_avatar_url: f?.avatarUrl ?? null,
      parent_badges: f?.badges ?? [],
      parent_can_hire: f?.canHire ?? false,
    }
  })
}

const JOB_COLUMNS =
  'id, job_tx_id, public_slug, title, subjects, class_level, city, area, teaching_mode, budget_pkr, budget_min_pkr, budget_max_pkr, description, created_at, is_featured, parent_id, status'

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

// openJobs() lived here: one un-paged query capped at 50 rows, feeding
// /tutor/dashboard/jobs. It made that page 18,672px tall on production, and
// the cap meant the 51st open tuition was simply invisible with nothing saying
// so. It is gone -- the board is browseJobs with no filters set, which already
// has the keyset cursor, the id tiebreaker and the exact count.

export type JobFilters = {
  masterId: number | null
  city: string | null
  mode: string | null
  budgetMin: number | null
  budgetMax: number | null
  q: string | null
}

/**
 * No filters at all — the whole open board.
 *
 * Named rather than written out at each call site so that adding a field to
 * JobFilters is a type error in one place instead of a filter silently
 * defaulting to undefined in three.
 */
export const NO_JOB_FILTERS: JobFilters = {
  masterId: null,
  city: null,
  mode: null,
  budgetMin: null,
  budgetMax: null,
  q: null,
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
/** The sort key browseJobs orders by, and therefore what a cursor must carry. */
type JobCursor = { f: boolean; c: string; i: string }

/**
 * One window of open tuitions.
 *
 * `offset` answers a cold ?page=N arrival with nothing to continue from — a
 * crawler, or a shared link. `cursor` answers "more, after the job I can see",
 * and is what load-more uses: jobs are posted and closed continuously, so with
 * OFFSET a reader scrolling a busy board sees the same tuition twice or misses
 * one entirely.
 */
export async function browseJobs(
  filters: JobFilters,
  limit = 12,
  offset = 0,
  cursor: string | null = null,
): Promise<{ jobs: JobCardData[]; total: number; nextCursor: string | null }> {
  const supabase = await createClient()

  let matchingIds: string[] | null = null
  if (filters.masterId) {
    const { data: links } = await supabase
      .from('job_subjects')
      .select('job_id')
      .eq('master_id', filters.masterId)
    matchingIds = Array.from(new Set((links ?? []).map((l) => l.job_id as string)))
    if (matchingIds.length === 0) return { jobs: [], total: 0, nextCursor: null }
  }

  const build = () => {
    let q = supabase.from('jobs').select(JOB_COLUMNS, { count: 'exact' }).eq('status', 'open')
    if (matchingIds) q = q.in('id', matchingIds)
    if (filters.city) q = q.ilike('city', filters.city)
    if (filters.mode) {
      // 'both' satisfies a search for either mode, the same way it does for
      // tutors -- a parent open to either should see both kinds of job.
      //
      // Equality, not ilike: migration 35 made this column one spelling with a
      // CHECK constraint behind it, so there is no longer a case difference to
      // paper over. The `ilike` was hiding the real defect -- fifty-one rows
      // held NULL and matched neither branch, so narrowing to a mode dropped
      // seven eighths of the board with nothing saying so.
      q = q.or(`teaching_mode.eq.${filters.mode},teaching_mode.eq.both`)
    }
    if (filters.budgetMin !== null) q = q.gte('budget_pkr', filters.budgetMin)
    if (filters.budgetMax !== null) q = q.lte('budget_pkr', filters.budgetMax)
    if (filters.q) q = q.ilike('title', `%${filters.q}%`)
    return q
  }

  // `id` is not decoration: (is_featured, created_at) is not unique -- two
  // jobs posted in the same second would compare equal, and a keyset cursor
  // cannot say which side of a tie it is on. With the id the key is total, so
  // no row can be straddled.
  let q = build()
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  const after = decodeCursor<JobCursor>(cursor)
  if (after) {
    // Strictly after the cursor row under that ordering. PostgREST needs the
    // values quoted: a timestamptz carries '+' and ':' and a bare one would be
    // parsed as more filter syntax.
    const f = after.f ? 'true' : 'false'
    q = q.or(
      [
        `is_featured.lt.${f}`,
        `and(is_featured.eq.${f},created_at.lt."${after.c}")`,
        `and(is_featured.eq.${f},created_at.eq."${after.c}",id.lt."${after.i}")`,
      ].join(','),
    )
  } else if (offset > 0) {
    q = q.range(offset, offset + limit - 1)
  }

  if (after || offset === 0) q = q.limit(limit)

  const { data, count } = await q
  const rows = (data ?? []) as Record<string, unknown>[]
  const last = rows[rows.length - 1]
  const total = count ?? 0
  const seen = (after ? 0 : offset) + rows.length

  return {
    jobs: await decorate(rows),
    total,
    nextCursor:
      rows.length === 0 || seen >= total || !last
        ? null
        : encodeCursor({
            f: !!last.is_featured,
            c: String(last.created_at),
            i: String(last.id),
          } satisfies JobCursor),
  }
}

/**
 * One tuition by its public address.
 *
 * Anon may read open jobs only (jobs_public_read_open), so a closed one comes
 * back null here -- which is correct: the page has nothing to show for it, and
 * answers 404. There was a second call after this one, job_page_status(), a
 * SECURITY DEFINER that told a closed address from an imaginary one so the
 * body could say "filled" rather than "closed". Both led to the same page, so
 * it bought a word for a query and is gone -- dropped in migration 43.
 */
export async function jobByPublicSlug(slug: string): Promise<JobCardData | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('jobs')
    .select(JOB_COLUMNS)
    .eq('public_slug', slug)
    .maybeSingle()
  if (!data) return null
  const [job] = await decorate([data as Record<string, unknown>])
  return job ?? null
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
