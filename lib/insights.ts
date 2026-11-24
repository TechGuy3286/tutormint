import 'server-only'

// lib/insights.ts — Admin → Insights, the server half (PR-12). Builds one
// Pakistan-time day into admin_summary ('insights:day:YYYY-MM-DD'), keeps the
// last month built from the 5-minute cron, merges a period for the page, and
// lists the members behind one count. Rules and shapes: lib/insightsCore.ts.
//
// Reads only: user_activity_log (server-written key actions), activity_events /
// activity_sessions (the signed-in tracker), application_stage_events,
// contact_reveals, anon_search_events, insight_visitor_days /
// insight_hour_counts (signed-out visitors, PR-12), profiles, tutor_profiles,
// jobs, applications, interest_holds. Writes only its own admin_summary rows.
// Never a phone, email, CNIC, IP, amount or user-agent string in what it keeps.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn, READ_CONCURRENCY } from '@/lib/pageAll'
import { cnicApprovedMarker } from '@/lib/docUploadStatusCore'
import { withRunMemo, inRunMemo } from '@/lib/runMemo'
import { loadDirectory, type DirectoryPerson } from '@/lib/peopleDirectory'
import { loadCountFacts, rowsFor } from '@/lib/counts'
import { countAll, daySpan, memberCounts } from '@/lib/countsCore'
import { cohortFunnel } from '@/lib/signupFunnelCore'
import {
  ACTION_KEYS_ALL,
  INSIGHTS_DAY_VERSION,
  DEVICE_KINDS,
  OS_KINDS,
  LOG_EVENT_ACTION,
  SHARED_ACTION_COUNT,
  INSIGHTS_KEEP_DAYS,
  SEARCHES_PER_DAY,
  addSearches,
  daysBetween,
  daysToBuild,
  deviceOf,
  emptyDay,
  insightsKey,
  mergePeriod,
  pkDayOf,
  pkDayStartMs,
  pkHourOf,
  topSearches,
  trackerAction,
  type ActionKey,
  type InsightsDay,
  type InsightsPeriod,
  type SearchRow,
} from '@/lib/insightsCore'

type Admin = SupabaseClient
type R = Record<string, unknown>
// A PostgREST builder whose table name is a variable (the client is untyped here).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any
const DAY_MS = 86_400_000

function windowOf(day: string) {
  const start = pkDayStartMs(day)
  return { start: new Date(start).toISOString(), end: new Date(start + DAY_MS).toISOString() }
}

async function loadHeld(admin: Admin): Promise<Set<string>> {
  const rows = await pageAll<R>((f, t) => admin.from('interest_holds').select('parent_id').eq('status', 'held').order('parent_id').range(f, t))
  return new Set(rows.map((r) => r.parent_id as string))
}

/** Inside one run memo, so the directory and the count facts load once per run. */
function memoed<T>(fn: () => Promise<T>): Promise<T> {
  return inRunMemo() ? fn() : withRunMemo(fn)
}

/** The members who count, by id (the People rule — PR-14). */
function peopleIndex(people: DirectoryPerson[]): Map<string, DirectoryPerson> {
  return new Map(people.filter((p) => memberCounts(p.excluded)).map((p) => [p.id, p]))
}

/** Build one day. Reads only. */
export function buildInsightsDay(admin: Admin, day: string, nowMs = Date.now()): Promise<InsightsDay> {
  return memoed(() => buildDay(admin, day, nowMs))
}

async function buildDay(admin: Admin, day: string, nowMs: number): Promise<InsightsDay> {
  const { start, end } = windowOf(day)
  const out = emptyDay(day, new Date(nowMs).toISOString())
  const inWindow = <T>(table: string, cols: string, col = 'created_at', extra?: (q: Q) => Q) =>
    pageAll<T>((f, t) => {
      let q: Q = admin.from(table).select(cols).gte(col, start).lt(col, end)
      if (extra) q = extra(q)
      return q.order(col).order('id').range(f, t)
    })

  const span = daySpan(day)
  const [logs, tracker, sessions, anon, visitors, hourRows, held, dir, countFacts, visitCount] = await Promise.all([
    inWindow<R>('user_activity_log', 'id, user_id, event, meta, created_at'),
    inWindow<R>('activity_events', 'id, user_id, kind, path, label, created_at'),
    pageAll<R>((f, t) => admin.from('activity_sessions').select('id, user_id, device, os, user_agent, started_at').lt('started_at', end).gte('last_seen_at', start).order('id').range(f, t)),
    inWindow<R>('anon_search_events', 'id, surface, master_id, city, area, mode, gender, results, failed, created_at', 'created_at', (q) => q.is('excluded', null)),
    pageAll<R>((f, t) => admin.from('insight_visitor_days').select('visitor, device, os').eq('day', day).order('visitor').range(f, t)),
    pageAll<R>((f, t) => admin.from('insight_hour_counts').select('hour, count').eq('day', day).eq('kind', 'visitor').order('hour').range(f, t)),
    loadHeld(admin),
    loadDirectory(),
    loadCountFacts(span.start),
    // PR-22: the Overview "Daily sign-up funnel" counter itself — the same number.
    admin.from('site_visit_counts').select('count').eq('day', day).eq('kind', 'public_page').maybeSingle(),
  ])
  out.pageVisits = Number((visitCount.data as R | null)?.count ?? 0) || 0
  // Who counts (PR-14): the People rule (lib/peopleDirectoryCore: staff, seed,
  // team, test, hidden, merged, erased and erase-requested accounts out), the
  // same as the Overview cards. Held parents' ACTIVITY is left out (and listed
  // in heldParents); their sign-up still counts.
  const people = peopleIndex(dir.people)
  const heldSeen = new Set<string>()
  const roleOf = (id: string | null | undefined): 'tutor' | 'parent' | null => {
    const p = id ? people.get(id) : undefined
    if (!p) return null
    if (held.has(p.id)) {
      heldSeen.add(p.id)
      return null
    }
    return p.role
  }

  const tutors = new Set<string>()
  const parents = new Set<string>()
  const markActive = (id: string) => {
    const r = roleOf(id)
    if (r === 'tutor') tutors.add(id)
    else if (r === 'parent') parents.add(id)
    return r
  }
  const hit = (k: ActionKey) => (out.actions[k] += 1)
  const hourAdd = (iso: unknown) => {
    const ms = Date.parse(String(iso))
    if (Number.isFinite(ms)) out.hours[pkHourOf(ms)] += 1
  }

  const searches = new Map<string, SearchRow>()
  for (const r of logs) {
    const id = r.user_id as string
    if (!markActive(id)) continue
    hourAdd(r.created_at)
    const ev = r.event as string
    const a = LOG_EVENT_ACTION[ev]
    if (a) hit(a)
    if (ev === 'search_performed') {
      const m = (r.meta ?? {}) as R
      const results = Number(m.results)
      // PR-22: a failed search (timeout / error) is "failed", never "zero results".
      const failed = m.failed === true
      addSearches(searches, [{ surface: String(m.surface ?? 'search'), city: (m.city as string) ?? null, area: (m.area as string) ?? null, masterId: Number.isFinite(Number(m.master_id)) && m.master_id != null ? Number(m.master_id) : null, mode: (m.mode as string) ?? null, gender: (m.gender as string) ?? null, n: 1, zero: !failed && results === 0 ? 1 : 0, failed: failed ? 1 : 0 }])
    }
  }
  for (const r of tracker) {
    const id = r.user_id as string
    if (!markActive(id)) continue
    if (r.kind === 'page_view' && !String(r.path ?? '').startsWith('/admin')) hourAdd(r.created_at)
    const a = trackerAction({ kind: r.kind as string, path: (r.path as string) ?? null, label: (r.label as string) ?? null })
    if (a) hit(a)
  }
  // The shared counts (lib/counts): the same numbers as every other screen.
  const shared = countAll(countFacts, span)
  for (const [action, key] of Object.entries(SHARED_ACTION_COUNT)) out.actions[action as ActionKey] = shared[key as keyof typeof shared]
  for (const r of anon) {
    const results = Number(r.results)
    const failed = r.failed === true
    addSearches(searches, [{ surface: String(r.surface ?? 'search'), city: (r.city as string) ?? null, area: (r.area as string) ?? null, masterId: r.master_id == null ? null : Number(r.master_id), mode: (r.mode as string) ?? null, gender: (r.gender as string) ?? null, n: 1, zero: !failed && results === 0 ? 1 : 0, failed: failed ? 1 : 0 }])
  }
  for (const s of sessions) markActive(s.user_id as string)

  // Devices: each counted member once (their first session of the day), each visitor once.
  const seen = new Set<string>()
  for (const s of sessions) {
    const id = s.user_id as string
    if (seen.has(id) || !roleOf(id)) continue
    seen.add(id)
    // The session's stored category; a Windows / Mac session recorded before
    // PR-22 said "other", so the user agent (when kept) is read again.
    const fromUa = s.user_agent ? deviceOf(s.user_agent as string) : null
    const device = DEVICE_KINDS.find((k) => k === s.device) ?? fromUa?.device ?? 'desktop'
    const storedOs = OS_KINDS.find((k) => k === s.os)
    const os = storedOs && storedOs !== 'other' ? storedOs : (fromUa?.os ?? storedOs ?? 'other')
    out.device[device] += 1
    out.device[os] += 1
  }
  for (const v of visitors) {
    const dev = DEVICE_KINDS.find((k) => k === v.device) ?? 'desktop'
    const os = OS_KINDS.find((k) => k === v.os) ?? 'other'
    out.device[dev] += 1
    out.device[os] += 1
  }
  out.visitors = visitors.length
  for (const h of hourRows) {
    const hr = Number(h.hour)
    if (hr >= 0 && hr < 24) out.hours[hr] += Number(h.count) || 0
  }

  out.tutorsActive = [...tutors].sort()
  out.parentsActive = [...parents].sort()
  out.searches = topSearches(searches.values(), SEARCHES_PER_DAY, 'n')

  out.heldParents = [...heldSeen].sort()

  // ---- the day's sign-up cohort: the shared New tutors / New parents ----
  const joined = [...people.values()].filter((p) => Date.parse(p.createdAt) >= span.start && Date.parse(p.createdAt) < span.end)
  const cohort = await pageAllIn<R, string>(
    joined.map((p) => p.id),
    (chunk, f, t) => admin.from('profiles').select('id, role, created_at, phone_verified_at, cnic_verified_at, verification_state, cnic_image_path, avatar_url, profile_pic_status').in('id', chunk).order('id').range(f, t),
    100,
    READ_CONCURRENCY,
  )
  const roleById = new Map(joined.map((p) => [p.id, p.role]))
  const cTutors = cohort.filter((c) => roleById.get(c.id as string) === 'tutor')
  const cParents = cohort.filter((c) => roleById.get(c.id as string) === 'parent')
  out.newTutors = cTutors.map((c) => c.id as string).sort()
  out.newParents = cParents.map((c) => c.id as string).sort()
  out.funnelTutor = await tutorFunnel(admin, cTutors)
  out.funnelParent = await parentFunnel(admin, cParents)
  return out
}

async function tutorFunnel(admin: Admin, cohort: R[]): Promise<number[]> {
  const ids = cohort.map((c) => c.id as string)
  if (ids.length === 0) return [0, 0, 0, 0, 0, 0, 0]
  const [tps, payViews] = await Promise.all([
    pageAllIn<R, string>(ids, (chunk, f, t) => admin.from('tutor_profiles').select('id, onboarded_at, verified_fee_paid_at, cnic_front_url, avatar_url').in('id', chunk).order('id').range(f, t), 100, READ_CONCURRENCY),
    pageAllIn<R, string>(ids, (chunk, f, t) => admin.from('activity_events').select('id, user_id').in('user_id', chunk).eq('kind', 'page_view').like('path', '/pay/choose%').order('id').range(f, t), 100, READ_CONCURRENCY),
  ])
  const tp = new Map(tps.map((r) => [r.id as string, r]))
  const opened = new Set(payViews.map((r) => r.user_id as string))
  // PR-22: in the order of the flow (TUTOR_FUNNEL); each step counts only
  // tutors who reached every step before it.
  return cohortFunnel(
    cohort.map((c) => {
      const t = tp.get(c.id as string) ?? {}
      return [
        true,
        !!c.phone_verified_at,
        !!((t.cnic_front_url || c.cnic_image_path) && (t.avatar_url || c.avatar_url)),
        !!t.onboarded_at,
        cnicApprovedMarker({ cnic_verified_at: c.cnic_verified_at as string | null, verification_state: c.verification_state as string | null }) && c.profile_pic_status === 'approved',
        opened.has(c.id as string),
        !!t.verified_fee_paid_at,
      ]
    }),
    7,
  )
}

async function parentFunnel(admin: Admin, cohort: R[]): Promise<number[]> {
  const ids = cohort.map((c) => c.id as string)
  if (ids.length === 0) return [0, 0, 0, 0]
  const [jobs, contacts] = await Promise.all([
    pageAllIn<R, string>(ids, (chunk, f, t) => admin.from('jobs').select('id, parent_id').in('parent_id', chunk).order('id').range(f, t), 100, READ_CONCURRENCY),
    pageAllIn<R, string>(ids, (chunk, f, t) => admin.from('user_activity_log').select('id, user_id').in('user_id', chunk).in('event', ['message_sent', 'demo_requested']).order('id').range(f, t), 100, READ_CONCURRENCY),
  ])
  const jobOwner = new Map(jobs.map((j) => [j.id as string, j.parent_id as string]))
  const apps = await pageAllIn<R, string>([...jobOwner.keys()], (chunk, f, t) => admin.from('applications').select('id, job_id').in('job_id', chunk).order('id').range(f, t), 100, READ_CONCURRENCY)
  const posted = new Set(jobs.map((j) => j.parent_id as string))
  const received = new Set(apps.map((a) => jobOwner.get(a.job_id as string)).filter(Boolean) as string[])
  const contacted = new Set(contacts.map((c) => c.user_id as string))
  // PR-22: each step only of those who reached the one before.
  return cohortFunnel(ids.map((i) => [true, posted.has(i), received.has(i), contacted.has(i)]), 4)
}

/** Build one day and store it. */
export async function storeInsightsDay(day: string, nowMs = Date.now()): Promise<InsightsDay | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const built = await buildInsightsDay(admin, day, nowMs)
  await admin.from('admin_summary').upsert({ key: insightsKey(day), payload: built, computed_at: built.builtAt })
  return built
}

/** The 5-minute cron: keep the last month built (a few days per run, within the deadline). */
export async function refreshInsights(nowMs = Date.now(), deadlineMs = nowMs + 40_000): Promise<{ built: string[] }> {
  const admin = createAdminClient()
  if (!admin) return { built: [] }
  const keys = Array.from({ length: INSIGHTS_KEEP_DAYS }, (_, i) => insightsKey(pkDayOf(nowMs - i * DAY_MS)))
  const { data } = await admin.from('admin_summary').select('key, computed_at, v:payload->v').in('key', keys)
  // A row of an older shape (PR-14 changed what a day counts) is rebuilt.
  const builtAt = new Map(
    (data ?? []).filter((r) => Number((r as R).v) === INSIGHTS_DAY_VERSION).map((r) => [String(r.key).slice(insightsKey('').length), String(r.computed_at)]),
  )
  const built: string[] = []
  const missing = keys.length - builtAt.size
  // One run memo for the whole loop: the People directory loads once, not per day.
  await withRunMemo(async () => {
    for (const day of daysToBuild(nowMs, builtAt, missing > 3 ? 6 : 3)) {
      if (Date.now() > deadlineMs) break
      try {
        await storeInsightsDay(day)
        built.push(day)
      } catch (e) {
        console.error('[insights] build failed', day, e instanceof Error ? e.message : 'error')
      }
    }
  })
  return { built }
}

/** The page: the stored days of a period, building up to `buildMissing` missing ones now. */
export async function loadInsightsPeriod(from: string, to: string, opts: { nowMs?: number; buildMissing?: number } = {}): Promise<InsightsPeriod> {
  const admin = createAdminClient()
  if (!admin) return mergePeriod(from, to, [])
  const days = daysBetween(from, to)
  const rows = await pageAllIn<R, string>(days.map(insightsKey), (chunk, f, t) => admin.from('admin_summary').select('key, payload').in('key', chunk).order('key').range(f, t), 100, READ_CONCURRENCY)
  const stored = new Map(rows.filter((r) => (r.payload as InsightsDay).v === INSIGHTS_DAY_VERSION).map((r) => [(r.payload as InsightsDay).day, r.payload as InsightsDay]))
  const missing = days.filter((d) => !stored.has(d)).reverse() // newest first
  for (const d of missing.slice(0, opts.buildMissing ?? 2)) {
    const b = await storeInsightsDay(d, opts.nowMs).catch(() => null)
    if (b) stored.set(d, b)
  }
  return mergePeriod(from, to, [...stored.values()])
}

// ------------------------------------------------------------ drill-down ---

export type InsightMember = { id: string; role: 'tutor' | 'parent'; count: number }

/** The members behind one action count in a period, most actions first. Reads only. */
export async function insightMembers(action: ActionKey, from: string, to: string): Promise<InsightMember[]> {
  const admin = createAdminClient()
  if (!admin || !ACTION_KEYS_ALL.includes(action)) return []
  const start = new Date(pkDayStartMs(from)).toISOString()
  const end = new Date(pkDayStartMs(to) + DAY_MS).toISOString()
  const range = <T>(table: string, cols: string, extra: (q: Q) => Q) =>
    pageAll<T>((f, t) => extra(admin.from(table).select(cols).gte('created_at', start).lt('created_at', end)).order('created_at').order('id').range(f, t))
  let userIds: string[] = []
  const logEvents = Object.entries(LOG_EVENT_ACTION).filter(([, a]) => a === action).map(([e]) => e)
  const shared = SHARED_ACTION_COUNT[action]
  if (shared) {
    // The rows behind the shared count itself (lib/counts), so the list
    // length equals the number on every screen.
    const rows = await rowsFor(shared, { start: pkDayStartMs(from), end: pkDayStartMs(to) + DAY_MS })
    userIds = rows.map((r) => r.memberId).filter((x): x is string => !!x)
  } else if (logEvents.length) {
    userIds = (await range<R>('user_activity_log', 'id, user_id', (q) => q.in('event', logEvents))).map((r) => r.user_id as string)
  } else if (action === 'forwarded') {
    userIds = (await range<R>('application_stage_events', 'id, tutor_id', (q) => q.eq('to_stage', 'forwarded'))).map((r) => r.tutor_id as string)
  } else if (action === 'contact_viewed') {
    userIds = (await pageAll<R>((f, t) => admin.from('contact_reveals').select('tutor_id, created_at').gte('created_at', start).lt('created_at', end).order('created_at').order('tutor_id').range(f, t))).map((r) => r.tutor_id as string)
  } else if (action === 'whatsapp_click' || action === 'call_click') {
    userIds = (await range<R>('activity_events', 'id, user_id', (q) => q.eq('kind', 'action').eq('label', action))).map((r) => r.user_id as string)
  } else if (action === 'pay_page' || action === 'tuition_viewed') {
    const rows = await range<R>('activity_events', 'id, user_id, kind, path, label', (q) => q.eq('kind', 'page_view').or(action === 'pay_page' ? 'path.like./pay/choose%' : 'path.like./tuitions/%,path.like./tuition-jobs/%'))
    userIds = rows.filter((r) => trackerAction({ kind: 'page_view', path: r.path as string, label: null }) === action).map((r) => r.user_id as string)
  }
  const [dir, held] = await Promise.all([loadDirectory(), loadHeld(admin)])
  const all = new Map(dir.people.map((p) => [p.id, p]))
  const people = peopleIndex(dir.people)
  const counts = new Map<string, InsightMember>()
  for (const id of userIds) {
    // A shared count's rows are already filtered by their own rule (a staff
    // post through the team account counts); other actions use the People rule
    // and leave held parents out.
    const p = shared ? all.get(id) : people.get(id)
    if (!p || (!shared && held.has(id))) continue
    const role = p.role
    const cur = counts.get(id) ?? { id, role, count: 0 }
    cur.count += 1
    counts.set(id, cur)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}
