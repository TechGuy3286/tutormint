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
import { ONLINE_JOB_TITLE } from '@/lib/jobTitlesCore'
import { orderCitiesByDistance } from '@/lib/cityDistance'
import { jobType } from '@/lib/display'
import { matchVisibility } from '@/lib/matchChip'
import { genderPrefWord, genderApplyBlocked } from '@/lib/genderPref'
import { jobDisplayTitle } from '@/lib/jobDisplayTitle'
import { maskTuitionText } from '@/lib/maskTuition'
import { collapseLevels } from '@/lib/levelDisplay'
import { badgesForPlan, type BadgeName } from '@/lib/entitlements'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { getLandingLinker } from '@/lib/landing'
import { resolveSubjectQuery } from '@/lib/searchResolve'
import { TEAM_DISPLAY_NAME } from '@/lib/teamAccount'
import type { JobCardData } from '@/components/JobCard'

type ParentFacts = {
  name: string | null
  avatarUrl: string | null
  badges: BadgeName[]
  canHire: boolean
  /** This job's parent is the team-operated TutorMint account (migration 63). */
  team: boolean
  /** This job's parent is a seed/fixture account (profiles.is_seed, migration 71). */
  isSeed: boolean
}

async function parentFacts(ids: string[]): Promise<Map<string, ParentFacts>> {
  const out = new Map<string, ParentFacts>()
  if (ids.length === 0) return out

  const admin = createAdminClient()
  if (!admin) return out

  const [{ data: profiles }, { data: subs }, { data: plans }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, avatar_url, profile_completion, cnic_verified_at, address_verified_at, is_team_account, is_seed')
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
    const team = !!(p.is_team_account as boolean | null)
    // A verified parent pays nothing, so they have no subscription row; their
    // free plan is implied by CNIC + address approval.
    let code = bestPlan.get(id) ?? null
    if (!code && p.cnic_verified_at && p.address_verified_at) code = 'parent_verified'

    out.set(id, {
      // The team account shows the TutorMint identity, never a person's name
      // (the account is provisioned with full_name 'TutorMint' anyway, but this
      // makes the surface independent of the row). Its badges are suppressed
      // because a team post carries the platform's OWN vetting, not a
      // CNIC-verified parent's — the "Posted by TutorMint" marker says so.
      name: team ? TEAM_DISPLAY_NAME : ((p.full_name as string | null)?.split(' ')[0] ?? null),
      avatarUrl: (p.avatar_url as string | null) ?? null,
      badges: team ? [] : badgesForPlan(code, (p.profile_completion ?? 0) >= 100),
      canHire: !!(code && planByCode.get(code)?.can_hire),
      team,
      isSeed: !!(p.is_seed as boolean | null),
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

  // A job's subject chips link to the tutors who teach it: the landing page for
  // that subject in the job's city when one exists, the browse filter otherwise.
  const linker = await getLandingLinker()

  return rawJobs.map((j) => {
    const f = facts.get(j.parent_id as string)
    const city = (j.city as string) ?? null
    // The display title, one composed phrase (owner, 13 Sep 2026):
    //   [Gender] [Job Title] for [Level] in [Area], [City]
    // Missing optional segments (and their prepositions) are dropped. Subjects
    // and budget are DELIBERATELY not in the title — both are already on the card
    // (chips, own row) and were what made the old pipe row unreadable. This one
    // string is the card title and the page/JobPosting fallback (built once
    // here). The stored jobs.title is the page headline (search matches it too).
    const subjects = subjectsByJob.get(j.id as string) ?? (j.subjects as string[] | null) ?? null
    // Level is multi-select now (migration 79): collapse the array to a readable
    // run ("Grade 1–5"), falling back to the legacy single string for pre-79 rows.
    const levelArr = (j.class_levels as string[] | null) ?? null
    // Body line: comma-joined. Title: natural "and" list, so the phrase reads as
    // prose ("Grade 2 and Grade 5") — same source, so the two never disagree on
    // WHICH levels, only on the connective.
    const levelDisplay = levelArr && levelArr.length > 0
      ? collapseLevels(levelArr)
      : (j.class_level as string) ?? null
    const levelPhrase = levelArr && levelArr.length > 0
      ? collapseLevels(levelArr, { conjunction: true })
      : (j.class_level as string) ?? null
    const composedTitle = jobDisplayTitle({
      jobType: jobType(j.teaching_mode as string | null),
      gender: genderPrefWord(j.gender_preference as string | null),
      level: levelPhrase,
      area: (j.area as string) ?? null,
      city,
    })
    // PR91 Part A: mask any phone/email a parent typed into the free text. This
    // is the data-layer choke point every non-staff surface reads (browse cards,
    // the tuition page, More strips, dashboard lists, My applications, the page
    // <title>/meta, OG and the JobPosting JSON-LD description). Admin reads jobs
    // directly, not through here, so staff screens keep the full text.
    const maskedHeadline = maskTuitionText((j.title as string | null)?.trim() || null)
    const maskedDescription = maskTuitionText((j.description as string) ?? null)
    return {
      id: j.id as string,
      job_tx_id: (j.job_tx_id as string) ?? null,
      ref_id: (j.ref_id as string) ?? null,
      public_slug: (j.public_slug as string) ?? null,
      status: (j.status as string) ?? 'open',
      // CARD title: the composed field list (masked defensively — the stored
      // fallback below is free text).
      title: maskTuitionText(composedTitle || (j.title as string) || 'Tuition required').text,
      // PAGE title: the stored human headline (or null → page falls back to the
      // composed string via preferHumanTitle).
      headline: maskedHeadline.masked ? maskedHeadline.text : ((j.title as string | null)?.trim() || null),
      /** True when the tuition's free text hides a phone/email behind the mask —
       *  drives the inline "View number" affordance on the card and page. */
      textHasContact: maskedHeadline.masked || maskedDescription.masked,
      // Fall back to the legacy text column for jobs posted before the join
      // table existed, so old posts still show what they are for.
      subjects,
      subject_links: (linksByJob.get(j.id as string) ?? []).map((l) => ({
        ...l,
        href: linker.tutorSubjectHref(l.masterId, city),
      })),
      // The collapsed level run, shown on the card body line and used above in
      // the composed title. Same source (class_levels) so the two never differ.
      class_level: levelDisplay,
      city: (j.city as string) ?? null,
      area: (j.area as string) ?? null,
      teaching_mode: (j.teaching_mode as string) ?? null,
      budget_pkr: (j.budget_pkr as number) ?? null,
      budget_min_pkr: (j.budget_min_pkr as number) ?? null,
      budget_max_pkr: (j.budget_max_pkr as number) ?? null,
      description: maskedDescription.masked ? maskedDescription.text : ((j.description as string) ?? null),
      created_at: (j.created_at as string) ?? new Date().toISOString(),
      // The auto-pause clock base for JobPosting validThrough (PR89 Part C):
      // coalesce(resumed_at, created_at) + 15 days is when the tuition auto-pauses.
      resumed_at: (j.resumed_at as string | null) ?? null,
      is_featured: (j.is_featured as boolean) ?? false,
      under_review: (j.under_review as boolean) ?? false,
      parent_id: (j.parent_id as string) ?? null,
      parent_name: f?.name ?? null,
      parent_avatar_url: f?.avatarUrl ?? null,
      parent_badges: f?.badges ?? [],
      parent_can_hire: f?.canHire ?? false,
      posted_by_team: f?.team ?? false,
      poster_is_seed: f?.isSeed ?? false,
      gender_preference: (j.gender_preference as string | null) ?? null,
      // PR73 §A: the schedule as the short slot line (timings holds it after sync).
      schedule: (j.timings as string | null) ?? null,
    }
  })
}

const JOB_COLUMNS =
  'id, job_tx_id, ref_id, public_slug, title, subjects, class_level, class_levels, city, area, teaching_mode, budget_pkr, budget_min_pkr, budget_max_pkr, description, created_at, resumed_at, is_featured, under_review, parent_id, status, gender_preference, timings'

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
  jobTypes: readonly string[] | null = null,
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

  // Over-fetch so the visibility filter below cannot leave a short window.
  const { data } = await query
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit * 6)

  // Respect the tutor's city + Job Type the same way the strip does (owner PR3
  // §2): a tutor with NO city sees only online tuitions as matching; a cross-city
  // in-person job is not a match and is dropped. The full board (browseJobs /
  // /tutor/dashboard/jobs) is unaffected — it shows every job.
  const decorated = await decorate((data ?? []) as Record<string, unknown>[])
  return decorated
    .filter((j) => matchVisibility(j.teaching_mode, j.city, jobTypes, city) !== 'exclude')
    .slice(0, limit)
}

// openJobs() lived here: one un-paged query capped at 50 rows, feeding
// /tutor/dashboard/jobs. It made that page 18,672px tall on production, and
// the cap meant the 51st open tuition was simply invisible with nothing saying
// so. It is gone -- the board is browseJobs with no filters set, which already
// has the keyset cursor, the id tiebreaker and the exact count.

/**
 * A signed-in tutor's own city+areas scope (PR71). A tuition is in scope when it
 * is in the tutor's city AND its area is one of the tutor's areas (or has no area
 * set), OR — when the tutor teaches online — it is an online tuition in ANY city.
 * The default view of /browse/tuitions for a signed-in tutor, and the number the
 * dashboard "Tuitions for you" tile and action bar count agree with.
 */
/** One city with the tutor's chosen areas in it. `areas` empty = the whole city
 *  (the level-2/3 fallback), area-agnostic. */
export type CityScope = { city: string; areas: string[] }

export type TutorScope = {
  // PR85 (Part A/B): up to 2 cities, each with its own areas. One PostgREST
  // branch per city; unioned with online.
  cityScopes: CityScope[]
  includeOnline: boolean
  // The tutor's own subject master ids (PR76 §A.3). Within the scope, tuitions in
  // these subjects sort ahead of the rest — so the board leads with the work the
  // tutor actually teaches. Empty when the tutor has no subjects yet (then the
  // scope orders newest-first, exactly as before).
  subjectMasterIds: number[]
}

export type JobFilters = {
  masterId: number | null
  /** A set of subject masters to match ANY of — how a resolved query filters
   *  across every level of a subject (owner PR13 §3). When set it wins over
   *  masterId; when both are null, a free-text `q` is resolved here. */
  masterIds?: number[] | null
  city: string | null
  mode: string | null
  budgetMin: number | null
  budgetMax: number | null
  q: string | null
  /** The tutor's own city+areas default (PR71). Mutually exclusive with `city`:
   *  the page sets one or the other, never both. */
  tutorScope?: TutorScope | null
  /** PR85 (Part C): a signed-in tutor's own gender. When set, gender-mismatched
   *  tuitions (a female-pref job for a male tutor, etc.) are hidden — a job shows
   *  only when it has no preference or the preference equals this. Guests/parents
   *  pass null and see every tuition. */
  viewerGender?: string | null
}

/**
 * The tutor's city+areas scope, or null when they have no city or no areas yet
 * (in which case the whole board is shown — owner PR71 §1). Shared by
 * /browse/tuitions, its load-more route and the dashboard so all three agree.
 */
/** A signed-in tutor's resolved feed inputs: up to 2 cities each with its areas,
 *  their subjects, whether they teach online, and their gender (PR85). Null when
 *  the tutor has no main city yet (then the whole board is shown). */
export type ResolvedTutor = {
  cities: string[]
  areasByCity: Record<string, string[]>
  includeOnline: boolean
  jobTypes: string[]
  subjectMasterIds: number[]
  gender: string | null
}

export async function resolveTutorScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ResolvedTutor | null> {
  const [{ data: tp }, { data: areaRows }, { data: subRows }] = await Promise.all([
    supabase.from('tutor_profiles').select('city, job_types, gender').eq('id', userId).maybeSingle(),
    supabase.from('tutor_areas').select('city, area').eq('tutor_id', userId),
    supabase.from('tutor_subjects').select('master_id').eq('tutor_id', userId),
  ])
  const mainCity = ((tp?.city as string | null) ?? '').trim()
  if (!mainCity) return null

  const areasByCity: Record<string, string[]> = {}
  for (const r of areaRows ?? []) {
    const c = ((r.city as string | null) ?? '').trim() || mainCity
    const a = ((r.area as string | null) ?? '').trim()
    if (!a) continue
    ;(areasByCity[c] ??= []).push(a)
  }
  for (const k of Object.keys(areasByCity)) areasByCity[k] = [...new Set(areasByCity[k])]

  // Cities: main first, then any others from tutor_areas, deduped (case-insensitive).
  const cities = [mainCity]
  for (const c of Object.keys(areasByCity)) {
    if (!cities.some((x) => x.toLowerCase() === c.toLowerCase())) cities.push(c)
  }

  const jobTypes = (tp?.job_types as string[] | null) ?? []
  return {
    cities,
    areasByCity,
    includeOnline: jobTypes.includes(ONLINE_JOB_TITLE),
    jobTypes,
    subjectMasterIds: [...new Set(((subRows ?? []).map((r) => r.master_id as number)))],
    gender: (tp?.gender as string | null) ?? null,
  }
}

// ---- PR85 (Part B): the tutor tuition feed with a 3-level fallback ----------
export type FeedLevel = 1 | 2 | 3
export type FeedMessage = { en: string; ur: string } | null

function level1Scope(r: ResolvedTutor): TutorScope {
  const cityScopes = r.cities
    .filter((c) => (r.areasByCity[c] ?? []).length > 0)
    .map((c) => ({ city: c, areas: r.areasByCity[c] }))
  return { cityScopes, includeOnline: r.includeOnline, subjectMasterIds: r.subjectMasterIds }
}
function cityScopeFor(r: ResolvedTutor, cities: string[]): TutorScope {
  return {
    cityScopes: cities.map((c) => ({ city: c, areas: [] })),
    includeOnline: r.includeOnline,
    subjectMasterIds: r.subjectMasterIds,
  }
}
function areaFallbackMsg(cityWord: string): FeedMessage {
  return {
    en: `No tuitions in your chosen areas right now. Here are tuitions in ${cityWord}.`,
    ur: `اس وقت آپ کے منتخب علاقوں میں کوئی ٹیوشن نہیں۔ یہ ${cityWord} میں ٹیوشنز ہیں۔`,
  }
}
function cityFallbackMsg(cityWord: string): FeedMessage {
  return {
    en: `No tuitions in ${cityWord} right now. Here are tuitions in nearby cities.`,
    ur: `اس وقت ${cityWord} میں کوئی ٹیوشن نہیں۔ یہ قریبی شہروں کی ٹیوشنز ہیں۔`,
  }
}

/** Up to 3 nearest OTHER cities that currently have open tuitions the tutor may
 *  see (gender-respecting), ordered by distance from the tutor's cities. */
export async function nearbyCitiesWithTuitions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  r: ResolvedTutor,
  viewerGender: string | null,
): Promise<string[]> {
  let q = supabase.from('jobs').select('city').eq('status', 'open')
  if (viewerGender) q = q.or(`gender_preference.is.null,gender_preference.eq.${viewerGender}`)
  const { data } = await q
  const cities = [...new Set(((data ?? []).map((j) => ((j.city as string | null) ?? '').trim()).filter(Boolean)))]
  return orderCitiesByDistance(r.cities, cities).slice(0, 3)
}

export type TutorFeedResult = {
  jobs: JobCardData[]
  total: number
  nextCursor: string | null
  level: FeedLevel
  message: FeedMessage
  nearby: string[]
}

/**
 * The tutor tuition feed (PR85 Part B): level 1 = chosen areas across both
 * cities; if empty, level 2 = their city/cities; if empty, level 3 = the nearest
 * cities with tuitions. Gender-filtered throughout (Part C). `forceLevel` skips
 * the cascade — load-more passes the level the first window resolved so it keeps
 * paging the same level.
 */
export async function tutorFeed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  r: ResolvedTutor,
  viewerGender: string | null,
  opts: { limit?: number; offset?: number; cursor?: string | null; forceLevel?: FeedLevel },
): Promise<TutorFeedResult> {
  const limit = opts.limit ?? 12
  const offset = opts.offset ?? 0
  const cursor = opts.cursor ?? null
  const cityWord = r.cities.join(', ')
  const run = (scope: TutorScope, cur: string | null) =>
    browseJobs({ ...NO_JOB_FILTERS, tutorScope: scope, viewerGender }, limit, offset, cur)

  if (opts.forceLevel === 1) return { ...(await run(level1Scope(r), cursor)), level: 1, message: null, nearby: [] }
  if (opts.forceLevel === 2) {
    return { ...(await run(cityScopeFor(r, r.cities), cursor)), level: 2, message: areaFallbackMsg(cityWord), nearby: [] }
  }
  if (opts.forceLevel === 3) {
    const nearby = await nearbyCitiesWithTuitions(supabase, r, viewerGender)
    return { ...(await run(cityScopeFor(r, nearby), cursor)), level: 3, message: cityFallbackMsg(cityWord), nearby }
  }

  // Cascade (cold first window).
  const l1 = level1Scope(r)
  if (l1.cityScopes.length > 0) {
    const res1 = await run(l1, cursor)
    if (res1.total > 0) return { ...res1, level: 1, message: null, nearby: [] }
  }
  const res2 = await run(cityScopeFor(r, r.cities), cursor)
  if (res2.total > 0) return { ...res2, level: 2, message: areaFallbackMsg(cityWord), nearby: [] }
  const nearby = await nearbyCitiesWithTuitions(supabase, r, viewerGender)
  const res3 = await run(cityScopeFor(r, nearby), cursor)
  return { ...res3, level: 3, message: cityFallbackMsg(cityWord), nearby }
}

/** The exact number of open tuitions the tutor's feed would show (its first
 *  non-empty fallback level), for the dashboard "Tuitions for you" count. */
export async function tutorFeedCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  r: ResolvedTutor,
  viewerGender: string | null,
): Promise<number> {
  return (await tutorFeed(supabase, r, viewerGender, { limit: 1 })).total
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
  tutorScope: null,
  viewerGender: null,
}

/** PR85 (Part C): the gender word to filter a feed by, or null (no filter).
 *  A tutor gender of 'male'/'female' filters; anything else (null/'other') does
 *  not — an unset gender is never a mismatch, matching the apply rule. */
export function feedGenderFilter(tutorGender: string | null | undefined): string | null {
  const g = (tutorGender ?? '').trim().toLowerCase()
  return g === 'male' || g === 'female' ? g : null
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

  // The subject master(s) to filter by. An explicit ?subject= is one master; a
  // resolved query is every level of the subject (owner PR13 §3). When neither
  // is given but there is free text, resolve it HERE — so the page's first
  // window and MoreJobs' later windows filter on the same set, and a
  // misspelling ("hisab") lands on Mathematics rather than a literal title match.
  let masterIds = filters.masterIds ?? (filters.masterId != null ? [filters.masterId] : null)
  let literalQ = filters.q
  if ((!masterIds || masterIds.length === 0) && filters.q) {
    const resolved = await resolveSubjectQuery(filters.q, filters.city)
    if (resolved) {
      masterIds = resolved.masterIds
      literalQ = null
    }
  }

  let matchingIds: string[] | null = null
  if (masterIds && masterIds.length > 0) {
    const { data: links } = await supabase
      .from('job_subjects')
      .select('job_id')
      .in('master_id', masterIds)
    matchingIds = Array.from(new Set((links ?? []).map((l) => l.job_id as string)))
    if (matchingIds.length === 0) return { jobs: [], total: 0, nextCursor: null }
  }

  const build = () => {
    let q = supabase.from('jobs').select(JOB_COLUMNS, { count: 'exact' }).eq('status', 'open')
    if (matchingIds) q = q.in('id', matchingIds)
    // The tutor's own city+areas default (PR71). One PostgREST OR group:
    //   (city = tutor's city AND (area ∈ areas OR area is null))
    //   OR teaching_mode = 'Online Tutor'   (only when the tutor teaches online)
    // ANDed with everything else (subject/budget) and, later, the keyset cursor.
    if (filters.tutorScope) {
      const s = filters.tutorScope
      const qv = (v: string) => `"${v.replace(/"/g, '\\"')}"`
      // One branch per city: (city = C AND (area ∈ that city's areas OR area is
      // null)) when the city has chosen areas, else the whole city (fallback).
      const parts = s.cityScopes.map((cs) =>
        cs.areas.length > 0
          ? `and(city.ilike.${qv(cs.city)},or(area.in.(${cs.areas.map(qv).join(',')}),area.is.null))`
          : `city.ilike.${qv(cs.city)}`,
      )
      if (s.includeOnline) parts.push(`teaching_mode.eq.${qv(ONLINE_JOB_TITLE)}`)
      if (parts.length > 0) q = q.or(parts.join(','))
    }
    // PR85 (Part C): hide gender-mismatched tuitions from a signed-in tutor. A
    // second .or() is ANDed with the scope group, so this narrows every path.
    if (filters.viewerGender) {
      q = q.or(`gender_preference.is.null,gender_preference.eq.${filters.viewerGender}`)
    }
    if (filters.city) q = q.ilike('city', filters.city)
    if (filters.mode) {
      // A job carries exactly one Job Type title (migration 77), stored
      // verbatim, so this is a plain equality on the title the filter passed.
      // ('both' is retired — there is no longer a value that means "either".)
      q = q.eq('teaching_mode', filters.mode)
    }
    if (filters.budgetMin !== null) q = q.gte('budget_pkr', filters.budgetMin)
    if (filters.budgetMax !== null) q = q.lte('budget_pkr', filters.budgetMax)
    if (literalQ) q = q.ilike('title', `%${literalQ}%`)
    return q
  }

  // PR76 §A.3 — the tutor's own scoped default view. Within the scope, tuitions
  // in the tutor's subjects lead, then the rest, each newest-first. The scope is
  // one tutor's city+areas (a small, low-churn set) and this is a signed-in
  // surface, NOT the crawler board — so we rank the whole in-scope set in memory
  // and page over it, which is obviously correct. The public keyset path below is
  // left exactly as it was. Only taken when there is no explicit subject filter
  // (an explicit filter is already subject-specific, so "matched first" is moot).
  if (filters.tutorScope && !matchingIds && filters.tutorScope.subjectMasterIds.length > 0) {
    const { data: links } = await supabase
      .from('job_subjects')
      .select('job_id')
      .in('master_id', filters.tutorScope.subjectMasterIds)
    const matchedSet = new Set((links ?? []).map((l) => l.job_id as string))

    // The whole in-scope open board (small — one tutor's city+areas), full rows.
    const { data: allRows } = await build()
    const all = (allRows ?? []) as Record<string, unknown>[]

    // Rank: subject match first, then featured, then newest, id as the total
    // tiebreaker so the order is stable across pages.
    const sorted = [...all].sort((a, b) => {
      const am = matchedSet.has(a.id as string) ? 1 : 0
      const bm = matchedSet.has(b.id as string) ? 1 : 0
      if (am !== bm) return bm - am
      const af = a.is_featured ? 1 : 0
      const bf = b.is_featured ? 1 : 0
      if (af !== bf) return bf - af
      const ac = String(a.created_at)
      const bc = String(b.created_at)
      if (ac !== bc) return ac < bc ? 1 : -1
      return String(a.id) < String(b.id) ? 1 : -1
    })
    const total = sorted.length

    // Page over the ranked list. The cursor carries the last id AND the next
    // index: normally we resume just after the last id, but if that job has since
    // closed we fall back to the recorded index rather than restarting at the top.
    const after = decodeCursor<{ i: string; n: number }>(cursor)
    let start = offset
    if (after) {
      const idx = sorted.findIndex((r) => String(r.id) === after.i)
      start = idx >= 0 ? idx + 1 : Math.min(Math.max(after.n, 0), total)
    }
    const pageRows = sorted.slice(start, start + limit)
    const end = start + pageRows.length
    const lastId = pageRows.length ? String(pageRows[pageRows.length - 1].id) : null
    return {
      jobs: await decorate(pageRows),
      total,
      nextCursor: end >= total || !lastId ? null : encodeCursor({ i: lastId, n: end }),
    }
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

/**
 * A few OPEN tuitions like this one — same city first, then same subject (PR28).
 * Used to keep a paused/closed/hired tuition page from being a dead end: the
 * reader always has live tuitions to go to. Open only, and the current job is
 * excluded. Reuses JOB_COLUMNS + decorate, so the cards match browse exactly.
 */
export async function similarOpenTuitions(
  jobId: string,
  city: string | null,
  masterIds: number[],
  limit = 3,
  /** PR85 Part C: a signed-in tutor's gender — gender-mismatched tuitions are
   *  dropped from the "similar" list. Null for guests/parents (show all). */
  viewerGender: string | null = null,
): Promise<JobCardData[]> {
  const supabase = await createClient()
  const collected = new Map<string, Record<string, unknown>>()

  const add = (rows: Record<string, unknown>[] | null | undefined) => {
    for (const r of rows ?? []) {
      const id = r.id as string
      if (id === jobId || collected.has(id) || collected.size >= limit) continue
      if (viewerGender && genderApplyBlocked((r.gender_preference as string | null) ?? null, viewerGender)) continue
      collected.set(id, r)
    }
  }

  // Same city first — the most useful "instead of this one".
  if (city) {
    const { data } = await supabase
      .from('jobs')
      .select(JOB_COLUMNS)
      .eq('status', 'open')
      .neq('id', jobId)
      .ilike('city', city)
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit + 1)
    add(data as Record<string, unknown>[])
  }

  // Then the same subject, wherever it is, to fill any remaining slots.
  if (collected.size < limit && masterIds.length > 0) {
    const { data: links } = await supabase
      .from('job_subjects')
      .select('job_id')
      .in('master_id', masterIds)
      .limit(80)
    const ids = Array.from(new Set((links ?? []).map((l) => l.job_id as string))).filter(
      (id) => id !== jobId && !collected.has(id),
    )
    if (ids.length > 0) {
      const { data } = await supabase
        .from('jobs')
        .select(JOB_COLUMNS)
        .eq('status', 'open')
        .in('id', ids)
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit + 1)
      add(data as Record<string, unknown>[])
    }
  }

  return decorate([...collected.values()])
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

/**
 * The tuitions a tutor has saved (hearted), newest-saved first. Open jobs only —
 * a saved job that has since closed drops out, the same way a shortlisted tutor
 * who has unlisted drops out of the parent's shortlist.
 */
export async function savedJobsForTutor(userId: string): Promise<JobCardData[]> {
  const supabase = await createClient()

  const { data: saved } = await supabase
    .from('saved_jobs')
    .select('job_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  const ids = (saved ?? []).map((s) => s.job_id as string)
  if (ids.length === 0) return []

  const { data: rawJobs } = await supabase
    .from('jobs')
    .select(JOB_COLUMNS)
    .in('id', ids)
    .eq('status', 'open')

  // Preserve the saved order (newest saved first); the SQL `in` does not.
  const rank = new Map(ids.map((id, i) => [id, i]))
  const ordered = (rawJobs ?? [])
    .slice()
    .sort((a, b) => (rank.get(a.id as string) ?? 0) - (rank.get(b.id as string) ?? 0))

  return decorate(ordered as Record<string, unknown>[])
}
