import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'
import { encodeCursor, decodeCursor } from '@/lib/cursor'
import { getLandingLinker } from '@/lib/landing'
import type { TutorCardData } from '@/components/TutorCard'

// The one place /browse/tutors is queried, shared by the page and the
// load-more route.
//
// Two callers, one query, on purpose: the page server-renders the first window
// and the route appends the rest, and if those drifted apart a reader would
// scroll from one ordering into another without anything saying so.

export type TutorFilters = {
  masterId: number | null
  city: string
  area: string
  mode: string
  gender: string
  feeMin: string
  feeMax: string
  q: string
}

/** The sort key rank_tutors() orders by. Everything needed to say "after this row". */
type TutorCursor = { t: number; l: number; s: number; h: string }

export type RankedTutor = TutorCardData & {
  tier: number
  location_score: number
  score: number
  sort_hash: string
  total_count: number
}

function intOrNull(v: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/** Reads the filter set out of a URLSearchParams or a Next searchParams object. */
export function tutorFiltersFrom(get: (k: string) => string): TutorFilters {
  return {
    masterId: intOrNull(get('subject')),
    city: get('city'),
    area: get('area'),
    mode: get('mode'),
    gender: get('gender'),
    feeMin: get('feeMin'),
    feeMax: get('feeMax'),
    q: get('q'),
  }
}

export function tutorFiltersToParams(f: TutorFilters): Record<string, string> {
  const out: Record<string, string> = {}
  if (f.masterId) out.subject = String(f.masterId)
  for (const k of ['city', 'area', 'mode', 'gender', 'feeMin', 'feeMax', 'q'] as const) {
    if (f[k]) out[k] = f[k]
  }
  return out
}

/**
 * One window of ranked tutors.
 *
 * `offset` answers a cold `?page=N` arrival — a crawler or a shared link, with
 * no row to continue from. `cursor` answers "more, after the row I am looking
 * at", and is what load-more uses: between two requests a plan can lapse or a
 * rating can move, and with OFFSET every row above the window shifts, so the
 * reader sees a tutor twice or never sees one at all.
 */
export type RankArgs = {
  filters: TutorFilters
  limit: number
  offset?: number
  cursor?: string | null
}

export type RankResult = {
  tutors: RankedTutor[]
  total: number
  nextCursor: string | null
  error: boolean
}

/**
 * Keyed on a serialised argument list rather than on the object, because
 * React's cache() compares arguments with Object.is and a fresh object literal
 * is never equal to the last one. Without this, generateMetadata and the page
 * body ask the database the same question twice on every single request —
 * generateMetadata needs the total to decide whether rel=next exists, and the
 * page needs the rows, and it is one query.
 */
export const rankedTutors = (args: RankArgs): Promise<RankResult> => rankedTutorsCached(JSON.stringify(args))

const rankedTutorsCached = cache(async (key: string): Promise<RankResult> => {
  const { filters, limit, offset = 0, cursor = null } = JSON.parse(key) as RankArgs
  const supabase = await createClient()
  const after = decodeCursor<TutorCursor>(cursor)

  const { data, error } = await supabase.rpc('rank_tutors', {
    p_master_id: filters.masterId,
    p_city: filters.city || null,
    p_area: filters.area || null,
    p_teaching_mode: filters.mode || null,
    p_gender: filters.gender || null,
    p_fee_min: intOrNull(filters.feeMin),
    p_fee_max: intOrNull(filters.feeMax),
    p_query: filters.q || null,
    p_limit: limit,
    // A cursor and an offset are two answers to the same question, so a
    // request carrying a cursor never also skips rows.
    p_offset: after ? 0 : offset,
    p_after_tier: after?.t ?? null,
    p_after_loc: after?.l ?? null,
    p_after_score: after?.s ?? null,
    p_after_hash: after?.h ?? null,
  })

  const tutors = await withSubjectLinks(supabase, (data ?? []) as RankedTutor[])
  const total = tutors[0]?.total_count ?? 0
  const seen = (after ? 0 : offset) + tutors.length

  return {
    tutors,
    total,
    // Null means "that was the end", which is what the footer renders as a
    // sentence rather than as silence. Derived from the total rather than from
    // a short page, so a window that happens to land exactly on the boundary
    // does not offer a Load more button that returns nothing.
    nextCursor: tutors.length === 0 || seen >= total ? null : cursorFor(tutors[tutors.length - 1]),
    error: !!error,
  }
})

/**
 * Attach the taxonomy id behind each subject label.
 *
 * rank_tutors() returns `subject_labels text[]` -- words, with no way to get
 * from one back to the thing it names. Every mention of a subject on a card is
 * supposed to link to the tutors who teach that exact level-and-subject, and
 * matching everywhere on this platform is on master_id, so a link built from
 * the label alone would be a text search dressed up as a filter.
 *
 * One extra query per window, on a table that is public-read. Silent on
 * failure: an unlinked chip is a worse card, a broken directory is a worse
 * site.
 */
async function withSubjectLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tutors: RankedTutor[],
): Promise<RankedTutor[]> {
  if (tutors.length === 0) return tutors

  const { data: links } = await supabase
    .from('tutor_subjects')
    .select('tutor_id, master_id')
    .in('tutor_id', tutors.map((t) => t.id))

  const masterIds = Array.from(new Set((links ?? []).map((l) => l.master_id as number)))
  if (masterIds.length === 0) return tutors

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
  const subjectName = new Map((subjects ?? []).map((x) => [x.slug as string, x.name as string]))

  const labelByMaster = new Map<number, string>()
  for (const m of master ?? []) {
    const subject = m.subject_slug ? subjectName.get(m.subject_slug as string) : null
    labelByMaster.set(m.id as number, subject ?? levelName.get(m.level_slug as string) ?? '')
  }

  const byTutor = new Map<string, { label: string; masterId: number }[]>()
  for (const l of links ?? []) {
    const label = labelByMaster.get(l.master_id as number)
    if (!label) continue
    const list = byTutor.get(l.tutor_id as string) ?? []
    if (!list.some((x) => x.label === label)) list.push({ label, masterId: l.master_id as number })
    byTutor.set(l.tutor_id as string, list)
  }

  // Each subject chip links to the landing page for this tutor's subject in
  // their city when one exists, and to the browse filter when it does not --
  // decided once, here, so a card never links to a page that is not there.
  const linker = await getLandingLinker()
  return tutors.map((t) => ({
    ...t,
    subject_links: (byTutor.get(t.id) ?? []).map((l) => ({
      ...l,
      href: linker.tutorSubjectHref(l.masterId, t.city),
    })),
  }))
}

export function cursorFor(row: RankedTutor): string {
  // round(score, 2) is what the ORDER BY compares, and it is what the function
  // compares the cursor against. Sending the unrounded score back would make
  // the boundary row compare unequal to itself and be served twice.
  return encodeCursor({
    t: row.tier,
    l: row.location_score,
    s: Math.round(Number(row.score) * 100) / 100,
    h: row.sort_hash,
  } satisfies TutorCursor)
}

/**
 * One listed tutor's card by slug, for a blog embed.
 *
 * Reads tutor_directory (the listing view — so an unlisted or suspended tutor
 * simply is not found and the embed renders nothing), enriches the subject
 * chips with their landing links exactly as the browse list does, and resolves
 * the plan code so the badges match what the same tutor shows everywhere else.
 * The plan is read through the service role because subscriptions is not
 * public; a missing service key just means no badge, never a broken card.
 */
export async function tutorCardBySlug(slug: string): Promise<TutorCardData | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tutor_directory')
    .select(
      'id, slug, full_name, headline, avatar_url, city, area, teaching_mode, hourly_rate_pkr, experience_years, rating_avg, rating_count',
    )
    .eq('slug', slug)
    .maybeSingle()
  if (!data) return null

  const base: RankedTutor = {
    ...(data as Record<string, unknown>),
    subject_labels: null,
    plan_code: null,
    tier: 0,
    location_score: 0,
    score: 0,
    sort_hash: '',
    total_count: 0,
  } as RankedTutor

  const [withLinks] = await withSubjectLinks(supabase, [base])
  const links = withLinks.subject_links ?? []

  // The active plan, for badges. Service role, because subscriptions is owner-
  // or-admin only under RLS.
  let planCode: string | null = null
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()
  if (admin) {
    const { data: sub } = await admin
      .from('subscriptions')
      .select('plan_code, expires_at')
      .eq('user_id', base.id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    planCode = (sub?.plan_code as string) ?? null
  }

  return {
    ...withLinks,
    subject_labels: links.map((l) => l.label),
    subject_links: links,
    plan_code: planCode,
  }
}
