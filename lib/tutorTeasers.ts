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
//   alertApplicationsForwarded()  staff forwarded applications to the parent
//                                (PR-07): the first forward of each is stored
//                                once and its tutor gets "Your application for …
//                                was sent to the parent".
//
// The notification IS the record: the weekly cap, "already sent today" and the
// 14-day tip rule are all answered by the tutor's own notifications. Nothing
// here logs or returns a name, phone or email; the cron result is counts only.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn, READ_CONCURRENCY } from '@/lib/pageAll'
import { notify } from '@/lib/notifications'
import { matchVisibilityCities } from '@/lib/matchChip'
import { genderApplyBlocked } from '@/lib/genderPref'
import { flowFactsByTutor } from '@/lib/onboardingStop'
import { tutorRequired, tutorItemHref } from '@/lib/profileRequired'
import { PARENT_VIEWER_ROLES } from '@/lib/profileViews'
import { getViewAsContext } from '@/lib/viewAsContext'
import { loadInterestForTutors, markAlerted } from '@/lib/parentInterest'
import { backfillPicks, groupByParent, interestTeaser, unpaidApplyLine } from '@/lib/parentInterestCore'
import {
  APPLICATION_FORWARDED_KIND,
  APPLICATION_OPENED_KIND,
  applicationForwardedText,
  forwardAlertGoes,
  DAY_MS,
  isPaid,
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

/** Every paid tutor (or just `ids`) with the facts the teasers need. PR-08:
 *  `includeUnpaid` adds the unpaid tutors too (their block is then worked out
 *  with allowUnpaid — parent interest, views and new tuitions). */
export async function loadTeaserTutors(admin: Admin, nowMs: number, ids?: string[], opts: { includeUnpaid?: boolean } = {}): Promise<TeaserTutor[]> {
  const cols = 'id, verified_fee_paid_at, city, job_types, gender, whatsapp_updates, imported, claimed_at'
  const unpaidToo = !!opts.includeUnpaid
  const tps: R[] = (
    ids
      ? await pageAllIn(ids, (part, f, t) => admin.from('tutor_profiles').select(cols).in('id', part).order('id').range(f, t), 100, READ_CONCURRENCY)
      : await pageAll<R>((f, t) => {
          const q = admin.from('tutor_profiles').select(cols)
          return (unpaidToo ? q : q.not('verified_fee_paid_at', 'is', null)).order('id').range(f, t) as never
        })
  ).filter((t) => unpaidToo || !!t.verified_fee_paid_at)
  const tutorIds = tps.map((t) => t.id as string)
  if (tutorIds.length === 0) return []

  const [ps, erasures, dismissals, areas, subjects] = await Promise.all([
    pageAllIn(tutorIds, (part, f, t) =>
      admin
        .from('profiles')
        .select('id, role, admin_role, full_name, whatsapp, phone_number, is_seed, is_team_account, is_test_name, hidden_from_public, merged_into, is_suspended, is_banned, paused_by_user_at')
        .in('id', part)
        .order('id')
        .range(f, t),
    100, READ_CONCURRENCY),
    pageAllIn(tutorIds, (part, f, t) => admin.from('account_erasures').select('id, member_id, status').in('member_id', part).in('status', ['scheduled', 'done']).order('id').range(f, t), 100, READ_CONCURRENCY),
    pageAllIn(tutorIds, (part, f, t) => admin.from('follow_up_dismissals').select('id, member_id').in('member_id', part).is('undone_at', null).order('id').range(f, t), 100, READ_CONCURRENCY),
    pageAllIn(tutorIds, (part, f, t) => admin.from('tutor_areas').select('id, tutor_id, city').in('tutor_id', part).order('id').range(f, t), 100, READ_CONCURRENCY),
    pageAllIn(tutorIds, (part, f, t) => admin.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', part).order('tutor_id').order('master_id').range(f, t), 100, READ_CONCURRENCY),
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
    .map((t) => {
      const id = t.id as string
      const p = pBy.get(id)
      const facts: TeaserEligibilityFacts = {
        role: (p?.role as string | null) ?? null,
        feePaidAt: (t.verified_fee_paid_at as string | null) ?? null,
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
        unclaimedImport: !!t.imported && !t.claimed_at,
      }
      const main = ((t.city as string | null) ?? '').trim()
      const cities: string[] = main ? [main] : []
      for (const c of areaCities.get(id) ?? []) if (!cities.some((x) => x.toLowerCase() === c.toLowerCase())) cities.push(c)
      return {
        id,
        facts,
        block: p ? teaserBlock(facts, nowMs, { allowUnpaid: unpaidToo }) : 'not_tutor',
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
export async function loadWeekViews(admin: Admin, tutorIds: Set<string> | null, sinceIso: string): Promise<ViewsByTutor> {
  const rows = await pageAll<R>((f, t) =>
    admin.from('profile_views').select('id, tutor_id, viewer_id, viewer_role, created_at').gte('created_at', sinceIso).order('id').range(f, t) as never,
  )
  const mine = rows.filter((r) => (!tutorIds || tutorIds.has(r.tutor_id as string)) && r.viewer_id !== r.tutor_id)
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
  /** PR-08: of them, unpaid tutors. */
  unpaidEligible: number
  /** PR-08: parent-interest alerts made only of backfilled events. */
  interestFromBackfill: number
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
  const result: TeaserRunResult = {
    eligible: 0,
    unpaidEligible: 0,
    interestFromBackfill: 0,
    sent: { teaser_profile_views: 0, teaser_views_tip: 0, teaser_new_tuitions: 0, teaser_weekly_summary: 0, teaser_parent_interest: 0 },
    skippedCap: 0,
    errors: [],
  }
  const admin = createAdminClient()
  if (!admin) return { ...result, errors: ['service-role client unavailable'] }

  let tutors: TeaserTutor[]
  try {
    tutors = (await loadTeaserTutors(admin, nowMs, undefined, { includeUnpaid: true })).filter((t) => t.block === null)
  } catch (e) {
    return { ...result, errors: [`tutors: ${(e as Error).message}`] }
  }
  result.eligible = tutors.length
  result.unpaidEligible = tutors.filter((t) => !isPaid(t.facts)).length
  if (tutors.length === 0) return result
  const ids = tutors.map((t) => t.id)
  const day = pkWeekday(nowMs)

  try {
    const since14 = new Date(nowMs - 15 * DAY_MS).toISOString()
    const paidTutors = tutors.filter((t) => isPaid(t.facts))
    const [log, dayJobs, views, weekly, interest] = await Promise.all([
      pageAllIn(ids, (part, f, t) =>
        admin.from('notifications').select('id, user_id, kind, created_at').in('user_id', part).in('kind', [...TEASER_KINDS]).gte('created_at', since14).order('id').range(f, t),
      ),
      loadRecentJobs(admin, new Date(nowMs - DAY_MS).toISOString()),
      day === VIEWS_TEASER_WEEKDAY ? loadWeekViews(admin, new Set(ids), new Date(nowMs - 7 * DAY_MS).toISOString()) : Promise.resolve(null),
      day === SUMMARY_WEEKDAY ? weeklyNumbersFor(admin, paidTutors, nowMs) : Promise.resolve(null),
      loadInterestForTutors(admin, nowMs),
    ])
    const eligibleIds = new Set(ids)
    const byTutor = new Map([...interest.byTutor].filter(([id]) => eligibleIds.has(id)))
    // The backfill is spread over several days: a tutor whose only events are
    // backfilled waits for one of today's places.
    const picks = backfillPicks(byTutor)
    const matchesBy = new Map(tutors.map((t) => [t.id, matchingJobs(dayJobs, t.match)]))
    // Profile facts: everyone on Thursday (the 0-views tip), and unpaid tutors
    // with new tuitions (what stands before Apply).
    const flowIds = day === VIEWS_TEASER_WEEKDAY ? ids : tutors.filter((t) => !isPaid(t.facts) && (matchesBy.get(t.id)?.length ?? 0) > 0).map((t) => t.id)
    const flow = flowIds.length ? await flowFactsByTutor(admin, flowIds) : null
    const logBy = new Map<string, SentLog[]>()
    for (const l of log) logBy.set(l.user_id as string, [...(logBy.get(l.user_id as string) ?? []), { kind: l.kind as string, created_at: l.created_at as string }])

    for (const t of tutors) {
      try {
        const matches = matchesBy.get(t.id) ?? []
        const facts = flow?.get(t.id)
        const missingItem = facts ? (tutorRequired(facts).missing.find((m) => m.key !== 'verify') ?? null) : null
        const paid = isPaid(t.facts)
        const evs = byTutor.get(t.id) ?? []
        const onlyBackfill = evs.length > 0 && evs.every((e) => e.source === 'backfill')
        const interestText = evs.length > 0 && (!onlyBackfill || picks.has(t.id)) ? interestTeaser(groupByParent(evs, interest.parents), paid) : null
        const plan = planForTutor({
          paid,
          unpaidApply: paid ? null : unpaidApplyLine(!!facts && !missingItem),
          interest: interestText ? { text: interestText, meta: { parents: new Set(evs.map((e) => e.parentId)).size, events: evs.length } } : null,
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
          if (x.kind === 'teaser_parent_interest') {
            if (onlyBackfill) result.interestFromBackfill++
            if (!opts.dryRun) await markAlerted(admin, evs.map((e) => e.id), new Date().toISOString())
          }
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

/**
 * Staff forwarded these applications to the tuition's parent (PR-07: Forward to
 * parents, or the Applied message). The FIRST forward of each application is
 * stored once (application_forward_alerts) and its tutor gets the instant
 * "Your application for … was sent to the parent" alert — eligible paid tutors
 * only, never under View as, never for a tuition posted by a test, seed or
 * hidden account. Later forwards change nothing. Never throws; never blocks the
 * forward. Returns how many alerts went.
 */
export async function alertApplicationsForwarded(applicationIds: string[]): Promise<number> {
  const ids = [...new Set(applicationIds)]
  if (ids.length === 0) return 0
  try {
    // View as reads as the member and refuses every write; a forward made
    // there is not a real event.
    const viewAs = !!(await getViewAsContext().catch(() => null))
    if (viewAs) return 0
    const admin = createAdminClient()
    if (!admin) return 0
    const apps = await pageAllIn(ids, (part, f, t) => admin.from('applications').select('id, tutor_id, job_id, withdrawn_at').in('id', part).order('id').range(f, t))
    if (apps.length === 0) return 0
    const { data } = await admin
      .from('application_forward_alerts')
      .upsert(
        apps.map((a) => ({ application_id: a.id as string, tutor_id: a.tutor_id as string, job_id: a.job_id as string })),
        { onConflict: 'application_id', ignoreDuplicates: true },
      )
      .select('application_id')
    const fresh = new Set((data ?? []).map((r) => r.application_id as string))
    if (fresh.size === 0) return 0
    const firstTime = apps.filter((a) => fresh.has(a.id as string))
    const jobIds = [...new Set(firstTime.map((a) => a.job_id as string))]
    const jobs = await pageAllIn(jobIds, (part, f, t) => admin.from('jobs').select('id, title, area, city, parent_id').in('id', part).order('id').range(f, t))
    const jobBy = new Map(jobs.map((j) => [j.id as string, j]))
    const posterIds = [...new Set(jobs.map((j) => j.parent_id as string).filter(Boolean))]
    const posters = await pageAllIn(posterIds, (part, f, t) =>
      admin.from('profiles').select('id, is_seed, is_test_name, hidden_from_public').in('id', part).order('id').range(f, t),
    )
    const testPoster = new Set(posters.filter((p) => p.is_seed || p.is_test_name || p.hidden_from_public).map((p) => p.id as string))
    const nowMs = Date.now()
    const tutors = await loadTeaserTutors(admin, nowMs, [...new Set(firstTime.map((a) => a.tutor_id as string))])
    const eligible = new Set(tutors.filter((t) => t.block === null).map((t) => t.id))
    let sent = 0
    for (const a of firstTime) {
      const j = jobBy.get(a.job_id as string)
      if (!j) continue
      const goes = forwardAlertGoes({
        viewAs,
        withdrawn: !!a.withdrawn_at,
        tutorEligible: eligible.has(a.tutor_id as string),
        posterTest: testPoster.has(j.parent_id as string),
      })
      if (!goes) continue
      const text = applicationForwardedText({ title: (j.title as string | null) ?? null, area: (j.area as string | null) ?? null, city: (j.city as string | null) ?? null })
      await notify({ userId: a.tutor_id as string, kind: APPLICATION_FORWARDED_KIND, title: text.title, body: text.body, href: text.href, meta: { application_id: a.id } })
      await admin.from('application_forward_alerts').update({ notified: true }).eq('application_id', a.id as string)
      sent++
    }
    return sent
  } catch {
    return 0
  }
}

/** The Applied message's Undo put the application back to Applied (PR-07): the
 *  forward leaves the WhatsApp updates queue. The bell alert already shown
 *  stays (nothing is deleted). Never throws. */
export async function undoForwardAlert(applicationId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    await admin.from('application_forward_alerts').update({ undone_at: new Date().toISOString() }).eq('application_id', applicationId).is('undone_at', null)
  } catch {
    /* the undo itself stands */
  }
}
