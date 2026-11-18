// lib/tutorTeasers.ts — the I/O half of the paid-tutor teasers (owner, 18 Nov
// 2026 — PR-06). Rules in lib/tutorTeasersCore. Service role.
//
//   runTutorTeasers()            the daily cron (08:00 PKT, app/api/cron/subscriptions):
//                                Monday weekly summary, Thursday profile-views
//                                teaser (or the 0-views tip), and the daily
//                                new-matching-tuitions teaser — under the
//                                3-a-week cap, and nothing when the numbers are 0.
//   recordParentApplicationViews()  the tuition's own parent opened their tuition
//                                page: the first view of each application is
//                                stored once, and its tutor gets the instant
//                                "A parent opened your application" alert.
//
// The notification IS the record: the weekly cap, "already sent today" and the
// 14-day tip rule are all answered by the tutor's own notifications. Nothing
// here logs or returns a name, phone or email; the cron result is counts only.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { notify } from '@/lib/notifications'
import { matchVisibilityCities } from '@/lib/matchChip'
import { genderApplyBlocked } from '@/lib/genderPref'
import { flowFactsByTutor } from '@/lib/onboardingStop'
import { tutorRequired, tutorItemHref } from '@/lib/profileRequired'
import { PARENT_VIEWER_ROLES } from '@/lib/profileViews'
import {
  APPLICATION_OPENED_KIND,
  DAY_MS,
  TEASER_KINDS,
  applicationOpenedText,
  jobMatches,
  pkWeekday,
  planForTutor,
  SUMMARY_WEEKDAY,
  teaserBlock,
  tuitionsListHref,
  VIEWS_TEASER_WEEKDAY,
  type MatchJob,
  type MatchTutor,
  type NotEligibleReason,
  type ParentViewer,
  type SentLog,
  type TeaserEligibilityFacts,
  type TeaserKind,
  type WeeklyNumbers,
} from '@/lib/tutorTeasersCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>
type R = Record<string, unknown>

export type TeaserTutor = {
  id: string
  facts: TeaserEligibilityFacts
  block: NotEligibleReason | null
  match: MatchTutor
  fullName: string | null
  /** WhatsApp, else mobile — never logged, never returned to a page. */
  rawNumber: string | null
  whatsappUpdates: boolean
}

/** Every paid tutor (or just `ids`) with the facts the teasers need. */
export async function loadTeaserTutors(admin: Admin, nowMs: number, ids?: string[]): Promise<TeaserTutor[]> {
  const tps: R[] = ids
    ? await pageAllIn(ids, (part, f, t) =>
        admin.from('tutor_profiles').select('id, verified_fee_paid_at, city, job_types, gender, whatsapp_updates').in('id', part).order('id').range(f, t),
      )
    : await pageAll<R>((f, t) =>
        admin
          .from('tutor_profiles')
          .select('id, verified_fee_paid_at, city, job_types, gender, whatsapp_updates')
          .not('verified_fee_paid_at', 'is', null)
          .order('id')
          .range(f, t) as never,
      )
  const tutorIds = tps.filter((t) => !!t.verified_fee_paid_at).map((t) => t.id as string)
  if (tutorIds.length === 0) return []

  const [ps, erasures, dismissals, areas, subjects] = await Promise.all([
    pageAllIn(tutorIds, (part, f, t) =>
      admin
        .from('profiles')
        .select('id, role, admin_role, full_name, whatsapp, phone_number, is_seed, is_team_account, is_test_name, hidden_from_public, merged_into, is_suspended, is_banned, paused_by_user_at')
        .in('id', part)
        .order('id')
        .range(f, t),
    ),
    pageAllIn(tutorIds, (part, f, t) => admin.from('account_erasures').select('id, member_id, status').in('member_id', part).in('status', ['scheduled', 'done']).order('id').range(f, t)),
    pageAllIn(tutorIds, (part, f, t) => admin.from('follow_up_dismissals').select('id, member_id').in('member_id', part).is('undone_at', null).order('id').range(f, t)),
    pageAllIn(tutorIds, (part, f, t) => admin.from('tutor_areas').select('id, tutor_id, city').in('tutor_id', part).order('id').range(f, t)),
    pageAllIn(tutorIds, (part, f, t) => admin.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', part).order('tutor_id').order('master_id').range(f, t)),
  ])

  const pBy = new Map(ps.map((p) => [p.id as string, p]))
  const erased = new Map<string, string>()
  for (const e of erasures) erased.set(e.member_id as string, e.status as string)
  const ni = new Set(dismissals.map((d) => d.member_id as string))
  const areaCities = new Map<string, string[]>()
  for (const a of areas) {
    const c = ((a.city as string | null) ?? '').trim()
    if (c) areaCities.set(a.tutor_id as string, [...(areaCities.get(a.tutor_id as string) ?? []), c])
  }
  const subs = new Map<string, number[]>()
  for (const s of subjects) subs.set(s.tutor_id as string, [...(subs.get(s.tutor_id as string) ?? []), Number(s.master_id)])

  return tps
    .filter((t) => !!t.verified_fee_paid_at)
    .map((t) => {
      const id = t.id as string
      const p = pBy.get(id)
      const facts: TeaserEligibilityFacts = {
        role: (p?.role as string | null) ?? null,
        feePaidAt: t.verified_fee_paid_at as string,
        isSeed: p?.is_seed as boolean | null,
        isTeam: p?.is_team_account as boolean | null,
        isTestName: p?.is_test_name as boolean | null,
        hidden: p?.hidden_from_public as boolean | null,
        staff: !!p?.admin_role,
        mergedInto: (p?.merged_into as string | null) ?? null,
        suspended: p?.is_suspended as boolean | null,
        banned: p?.is_banned as boolean | null,
        selfPaused: !!p?.paused_by_user_at,
        eraseRequested: erased.get(id) === 'scheduled',
        erased: erased.get(id) === 'done',
        notInterested: ni.has(id),
      }
      const main = ((t.city as string | null) ?? '').trim()
      const cities: string[] = main ? [main] : []
      for (const c of areaCities.get(id) ?? []) if (!cities.some((x) => x.toLowerCase() === c.toLowerCase())) cities.push(c)
      return {
        id,
        facts,
        block: p ? teaserBlock(facts, nowMs) : 'not_tutor',
        match: {
          masterIds: [...new Set(subs.get(id) ?? [])],
          cities,
          jobTypes: (t.job_types as string[] | null) ?? [],
          gender: (t.gender as string | null) ?? null,
        },
        fullName: (p?.full_name as string | null) ?? null,
        rawNumber: ((p?.whatsapp as string | null) || (p?.phone_number as string | null)) ?? null,
        whatsappUpdates: t.whatsapp_updates !== false,
      } satisfies TeaserTutor
    })
}

/** Open tuitions posted since `sinceIso`, with their subjects. */
export async function loadRecentJobs(admin: Admin, sinceIso: string): Promise<MatchJob[]> {
  const jobs = await pageAll<R>((f, t) =>
    admin
      .from('jobs')
      .select('id, city, teaching_mode, gender_preference, created_at, under_review, merged_into')
      .eq('status', 'open')
      .gte('created_at', sinceIso)
      .order('id')
      .range(f, t) as never,
  )
  const live = jobs.filter((j) => !j.under_review && !j.merged_into)
  const ids = live.map((j) => j.id as string)
  const links = await pageAllIn(ids, (part, f, t) => admin.from('job_subjects').select('job_id, master_id').in('job_id', part).order('job_id').order('master_id').range(f, t))
  const by = new Map<string, number[]>()
  for (const l of links) by.set(l.job_id as string, [...(by.get(l.job_id as string) ?? []), Number(l.master_id)])
  return live.map((j) => ({
    id: j.id as string,
    masterIds: by.get(j.id as string) ?? [],
    city: (j.city as string | null) ?? null,
    jobType: (j.teaching_mode as string | null) ?? null,
    genderPreference: (j.gender_preference as string | null) ?? null,
    createdAt: j.created_at as string,
  }))
}

const MATCH_RULES = {
  visibility: (jobType: string | null, jobCity: string | null, tutorTypes: readonly string[], tutorCities: readonly string[]) =>
    matchVisibilityCities(jobType, jobCity, tutorTypes, tutorCities),
  genderBlocked: (pref: string | null, g: string | null) => genderApplyBlocked(pref, g),
}

export function matchingJobs(jobs: MatchJob[], tutor: MatchTutor): MatchJob[] {
  return jobs.filter((j) => jobMatches(j, tutor, MATCH_RULES))
}

/** The one subject every match shares, or null. */
function singleSharedSubject(matches: MatchJob[], tutor: MatchTutor): number | null {
  const mine = new Set(tutor.masterIds)
  let only: number | null = null
  for (const j of matches) {
    const shared = j.masterIds.filter((m) => mine.has(m))
    if (shared.length !== 1) return null
    if (only !== null && only !== shared[0]) return null
    only = shared[0]
  }
  return only
}

export type ViewsByTutor = Map<string, { parents: ParentViewer[]; parentRows: number; otherVisitors: number }>

/**
 * This week's views per tutor. Parents: distinct signed-in parent/academy
 * viewers who are not test/seed/team/hidden/staff accounts. Other visitors:
 * rows by someone not signed in or by another tutor — never staff, never the
 * tutor themselves. `parentRows` is the dashboard tile's number
 * (weeklyParentViewCount: parent rows, not distinct people).
 */
export async function loadWeekViews(admin: Admin, tutorIds: Set<string>, sinceIso: string): Promise<ViewsByTutor> {
  const rows = await pageAll<R>((f, t) =>
    admin.from('profile_views').select('id, tutor_id, viewer_id, viewer_role, created_at').gte('created_at', sinceIso).order('id').range(f, t) as never,
  )
  const mine = rows.filter((r) => tutorIds.has(r.tutor_id as string) && r.viewer_id !== r.tutor_id)
  const parentIds = [...new Set(mine.filter((r) => (PARENT_VIEWER_ROLES as readonly string[]).includes(r.viewer_role as string) && r.viewer_id).map((r) => r.viewer_id as string))]
  const viewers = await pageAllIn(parentIds, (part, f, t) =>
    admin
      .from('profiles')
      .select('id, role, admin_role, full_name, city, area, is_seed, is_team_account, is_test_name, hidden_from_public')
      .in('id', part)
      .order('id')
      .range(f, t),
  )
  const real = new Map<string, ParentViewer>()
  for (const v of viewers) {
    if (v.admin_role || v.role === 'admin' || v.is_seed || v.is_team_account || v.is_test_name || v.hidden_from_public) continue
    real.set(v.id as string, { name: (v.full_name as string | null) ?? null, area: (v.area as string | null) ?? null, city: (v.city as string | null) ?? null })
  }
  const out: ViewsByTutor = new Map()
  const seen = new Set<string>() // `${tutor}|${parent}`
  // Newest first, so the names shown are the most recent parents.
  for (const r of [...mine].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    const tid = r.tutor_id as string
    const cur = out.get(tid) ?? { parents: [], parentRows: 0, otherVisitors: 0 }
    const role = (r.viewer_role as string | null) ?? null
    if (role && (PARENT_VIEWER_ROLES as readonly string[]).includes(role)) {
      const v = r.viewer_id ? real.get(r.viewer_id as string) : undefined
      if (v) {
        cur.parentRows++
        const key = `${tid}|${r.viewer_id as string}`
        if (!seen.has(key)) {
          seen.add(key)
          cur.parents.push(v)
        }
      }
    } else if (!role || role === 'tutor') {
      cur.otherVisitors++
    }
    out.set(tid, cur)
  }
  return out
}

/** Applications each tutor sent since `sinceIso` (withdrawn ones left out). */
export async function loadWeekApplications(admin: Admin, tutorIds: string[], sinceIso: string): Promise<Map<string, number>> {
  const rows = await pageAllIn(tutorIds, (part, f, t) =>
    admin.from('applications').select('id, tutor_id, withdrawn_at').in('tutor_id', part).gte('created_at', sinceIso).order('id').range(f, t),
  )
  const out = new Map<string, number>()
  for (const r of rows) if (!r.withdrawn_at) out.set(r.tutor_id as string, (out.get(r.tutor_id as string) ?? 0) + 1)
  return out
}

/** The weekly summary numbers for each tutor (the last 7 days). */
export async function weeklyNumbersFor(admin: Admin, tutors: TeaserTutor[], nowMs: number): Promise<Map<string, WeeklyNumbers>> {
  const since = new Date(nowMs - 7 * DAY_MS).toISOString()
  const ids = tutors.map((t) => t.id)
  const [views, apps, jobs] = await Promise.all([loadWeekViews(admin, new Set(ids), since), loadWeekApplications(admin, ids, since), loadRecentJobs(admin, since)])
  const out = new Map<string, WeeklyNumbers>()
  for (const t of tutors) {
    out.set(t.id, { views: views.get(t.id)?.parentRows ?? 0, applications: apps.get(t.id) ?? 0, tuitions: matchingJobs(jobs, t.match).length })
  }
  return out
}

export type TeaserRunResult = {
  eligible: number
  sent: Record<TeaserKind, number>
  skippedCap: number
  errors: string[]
}

/**
 * The daily sweep. `dryRun` counts what would go out without writing a
 * notification (the post-deploy report).
 */
export async function runTutorTeasers(opts: { nowMs?: number; dryRun?: boolean } = {}): Promise<TeaserRunResult> {
  const nowMs = opts.nowMs ?? Date.now()
  const result: TeaserRunResult = { eligible: 0, sent: { teaser_profile_views: 0, teaser_views_tip: 0, teaser_new_tuitions: 0, teaser_weekly_summary: 0 }, skippedCap: 0, errors: [] }
  const admin = createAdminClient()
  if (!admin) return { ...result, errors: ['service-role client unavailable'] }

  let tutors: TeaserTutor[]
  try {
    tutors = (await loadTeaserTutors(admin, nowMs)).filter((t) => t.block === null)
  } catch (e) {
    return { ...result, errors: [`tutors: ${(e as Error).message}`] }
  }
  result.eligible = tutors.length
  if (tutors.length === 0) return result
  const ids = tutors.map((t) => t.id)
  const day = pkWeekday(nowMs)

  try {
    const since14 = new Date(nowMs - 15 * DAY_MS).toISOString()
    const [log, dayJobs, views, weekly, flow] = await Promise.all([
      pageAllIn(ids, (part, f, t) =>
        admin.from('notifications').select('id, user_id, kind, created_at').in('user_id', part).in('kind', [...TEASER_KINDS]).gte('created_at', since14).order('id').range(f, t),
      ),
      loadRecentJobs(admin, new Date(nowMs - DAY_MS).toISOString()),
      day === VIEWS_TEASER_WEEKDAY ? loadWeekViews(admin, new Set(ids), new Date(nowMs - 7 * DAY_MS).toISOString()) : Promise.resolve(null),
      day === SUMMARY_WEEKDAY ? weeklyNumbersFor(admin, tutors, nowMs) : Promise.resolve(null),
      day === VIEWS_TEASER_WEEKDAY ? flowFactsByTutor(admin, ids) : Promise.resolve(null),
    ])
    const logBy = new Map<string, SentLog[]>()
    for (const l of log) logBy.set(l.user_id as string, [...(logBy.get(l.user_id as string) ?? []), { kind: l.kind as string, created_at: l.created_at as string }])

    for (const t of tutors) {
      try {
        const matches = matchingJobs(dayJobs, t.match)
        const facts = flow?.get(t.id)
        const missingItem = facts ? (tutorRequired(facts).missing.find((m) => m.key !== 'verify') ?? null) : null
        const plan = planForTutor({
          nowMs,
          log: logBy.get(t.id) ?? [],
          views: views?.get(t.id),
          newTuitions: { count: matches.length, href: tuitionsListHref(t.match.cities[0] ?? null, singleSharedSubject(matches, t.match)) },
          weekly: weekly?.get(t.id),
          missing: missingItem ? { label: missingItem.label, href: tutorItemHref(missingItem) } : null,
        })
        if (matches.length > 0 && !plan.some((x) => x.kind === 'teaser_new_tuitions')) result.skippedCap++
        for (const x of plan) {
          if (!opts.dryRun) await notify({ userId: t.id, kind: x.kind, title: x.text.title, body: x.text.body, href: x.text.href, meta: x.meta ?? null })
          result.sent[x.kind]++
        }
      } catch (e) {
        result.errors.push(`teaser: ${String(e).slice(0, 120)}`)
      }
    }
  } catch (e) {
    result.errors.push(`teasers: ${(e as Error).message}`)
  }
  return result
}

/**
 * The tuition's own parent opened their tuition page showing these
 * applications. Stores the first view of each (later views change nothing) and
 * sends each newly-seen application's tutor the instant alert — eligible paid
 * tutors only. Never throws; never blocks the page.
 */
export async function recordParentApplicationViews(job: { title: string | null; area: string | null; city: string | null }, apps: { id: string; tutorId: string; withdrawn: boolean }[]): Promise<number> {
  const admin = createAdminClient()
  const live = apps.filter((a) => !a.withdrawn)
  if (!admin || live.length === 0) return 0
  try {
    const { data } = await admin
      .from('application_parent_views')
      .upsert(live.map((a) => ({ application_id: a.id })), { onConflict: 'application_id', ignoreDuplicates: true })
      .select('application_id')
    const fresh = new Set((data ?? []).map((r) => r.application_id as string))
    if (fresh.size === 0) return 0
    const firstSeen = live.filter((a) => fresh.has(a.id))
    const nowMs = Date.now()
    const tutors = await loadTeaserTutors(admin, nowMs, [...new Set(firstSeen.map((a) => a.tutorId))])
    const ok = new Set(tutors.filter((t) => t.block === null).map((t) => t.id))
    const text = applicationOpenedText(job)
    let sent = 0
    for (const a of firstSeen) {
      if (!ok.has(a.tutorId)) continue
      await notify({ userId: a.tutorId, kind: APPLICATION_OPENED_KIND, title: text.title, body: text.body, href: text.href, meta: { application_id: a.id } })
      sent++
    }
    return sent
  } catch {
    return 0
  }
}
