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
import {
  ACTION_KEYS_ALL,
  LOG_EVENT_ACTION,
  INSIGHTS_KEEP_DAYS,
  SEARCHES_PER_DAY,
  addSearches,
  countedRole,
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
  type MemberFacts,
  type SearchRow,
} from '@/lib/insightsCore'

type Admin = SupabaseClient
type R = Record<string, unknown>
// A PostgREST builder whose table name is a variable (the client is untyped here).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any
const DAY_MS = 86_400_000

const PROFILE_COLS = 'id, role, admin_role, is_seed, is_team_account, is_test_name, hidden_from_public, merged_into'

function windowOf(day: string) {
  const start = pkDayStartMs(day)
  return { start: new Date(start).toISOString(), end: new Date(start + DAY_MS).toISOString() }
}

async function loadHeld(admin: Admin): Promise<Set<string>> {
  const rows = await pageAll<R>((f, t) => admin.from('interest_holds').select('parent_id').eq('status', 'held').order('parent_id').range(f, t))
  return new Set(rows.map((r) => r.parent_id as string))
}

async function loadFacts(admin: Admin, ids: string[]): Promise<Map<string, MemberFacts>> {
  const rows = await pageAllIn<R, string>([...new Set(ids)], (chunk, f, t) => admin.from('profiles').select(PROFILE_COLS).in('id', chunk).order('id').range(f, t), 100, READ_CONCURRENCY)
  return new Map(rows.map((r) => [r.id as string, r as unknown as MemberFacts]))
}

/** Build one day. Reads only. */
export async function buildInsightsDay(admin: Admin, day: string, nowMs = Date.now()): Promise<InsightsDay> {
  const { start, end } = windowOf(day)
  const out = emptyDay(day, new Date(nowMs).toISOString())
  const inWindow = <T>(table: string, cols: string, col = 'created_at', extra?: (q: Q) => Q) =>
    pageAll<T>((f, t) => {
      let q: Q = admin.from(table).select(cols).gte(col, start).lt(col, end)
      if (extra) q = extra(q)
      return q.order(col).order('id').range(f, t)
    })

  const [logs, tracker, sessions, forwards, reveals, anon, visitors, hourRows, held] = await Promise.all([
    inWindow<R>('user_activity_log', 'id, user_id, event, meta, created_at'),
    inWindow<R>('activity_events', 'id, user_id, kind, path, label, created_at'),
    pageAll<R>((f, t) => admin.from('activity_sessions').select('id, user_id, device, os, user_agent, started_at').lt('started_at', end).gte('last_seen_at', start).order('id').range(f, t)),
    inWindow<R>('application_stage_events', 'id, tutor_id, created_at', 'created_at', (q) => q.eq('to_stage', 'forwarded')),
    pageAll<R>((f, t) => admin.from('contact_reveals').select('tutor_id, created_at').gte('created_at', start).lt('created_at', end).order('created_at').order('tutor_id').range(f, t)),
    inWindow<R>('anon_search_events', 'id, surface, master_id, city, area, mode, gender, results, created_at', 'created_at', (q) => q.is('excluded', null)),
    pageAll<R>((f, t) => admin.from('insight_visitor_days').select('visitor, device, os').eq('day', day).order('visitor').range(f, t)),
    pageAll<R>((f, t) => admin.from('insight_hour_counts').select('hour, count').eq('day', day).eq('kind', 'visitor').order('hour').range(f, t)),
    loadHeld(admin),
  ])
  const cohort = await pageAll<R>((f, t) =>
    admin.from('profiles').select(`${PROFILE_COLS}, created_at, phone_verified_at, cnic_verified_at, verification_state, cnic_image_path, avatar_url, profile_pic_status`).gte('created_at', start).lt('created_at', end).order('id').range(f, t),
  )

  const ids = [
    ...logs.map((r) => r.user_id as string),
    ...tracker.map((r) => r.user_id as string),
    ...sessions.map((r) => r.user_id as string),
    ...forwards.map((r) => r.tutor_id as string),
    ...reveals.map((r) => r.tutor_id as string),
  ].filter(Boolean)
  const facts = await loadFacts(admin, ids)
  for (const c of cohort) facts.set(c.id as string, c as unknown as MemberFacts)
  const roleOf = (id: string | null | undefined) => (id ? countedRole(facts.get(id), held.has(id)) : null)

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
      addSearches(searches, [{ surface: String(m.surface ?? 'search'), city: (m.city as string) ?? null, area: (m.area as string) ?? null, masterId: Number.isFinite(Number(m.master_id)) && m.master_id != null ? Number(m.master_id) : null, mode: (m.mode as string) ?? null, gender: (m.gender as string) ?? null, n: 1, zero: results === 0 ? 1 : 0 }])
    }
  }
  for (const r of tracker) {
    const id = r.user_id as string
    if (!markActive(id)) continue
    if (r.kind === 'page_view' && !String(r.path ?? '').startsWith('/admin')) hourAdd(r.created_at)
    const a = trackerAction({ kind: r.kind as string, path: (r.path as string) ?? null, label: (r.label as string) ?? null })
    if (a) hit(a)
  }
  for (const r of forwards) if (roleOf(r.tutor_id as string)) hit('forwarded')
  for (const r of reveals) if (roleOf(r.tutor_id as string)) hit('contact_viewed')
  for (const r of anon) {
    const results = Number(r.results)
    addSearches(searches, [{ surface: String(r.surface ?? 'search'), city: (r.city as string) ?? null, area: (r.area as string) ?? null, masterId: r.master_id == null ? null : Number(r.master_id), mode: (r.mode as string) ?? null, gender: (r.gender as string) ?? null, n: 1, zero: results === 0 ? 1 : 0 }])
  }
  for (const s of sessions) markActive(s.user_id as string)

  // Devices: each counted member once (their first session of the day), each visitor once.
  const seen = new Set<string>()
  for (const s of sessions) {
    const id = s.user_id as string
    if (seen.has(id) || !roleOf(id)) continue
    seen.add(id)
    const d = s.device && s.os ? { device: s.device as 'mobile', os: s.os as 'android' } : deviceOf(s.user_agent as string | null)
    out.device[d.device] += 1
    out.device[d.os] += 1
  }
  for (const v of visitors) {
    const dev = (['mobile', 'tablet', 'desktop'] as const).find((k) => k === v.device) ?? 'desktop'
    const os = (['android', 'iphone', 'other'] as const).find((k) => k === v.os) ?? 'other'
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

  // ---- the day's sign-up cohort ----
  const cTutors = cohort.filter((c) => countedRole(c as unknown as MemberFacts, held.has(c.id as string)) === 'tutor')
  const cParents = cohort.filter((c) => countedRole(c as unknown as MemberFacts, held.has(c.id as string)) === 'parent')
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
  const n = [ids.length, 0, 0, 0, 0, 0, 0]
  for (const c of cohort) {
    const t = tp.get(c.id as string) ?? {}
    if (c.phone_verified_at) n[1]++
    if (t.onboarded_at) n[2]++
    if ((t.cnic_front_url || c.cnic_image_path) && (t.avatar_url || c.avatar_url)) n[3]++
    if (cnicApprovedMarker({ cnic_verified_at: c.cnic_verified_at as string | null, verification_state: c.verification_state as string | null }) && c.profile_pic_status === 'approved') n[4]++
    if (opened.has(c.id as string)) n[5]++
    if (t.verified_fee_paid_at) n[6]++
  }
  return n
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
  return [ids.length, ids.filter((i) => posted.has(i)).length, ids.filter((i) => received.has(i)).length, ids.filter((i) => contacted.has(i)).length]
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
  const { data } = await admin.from('admin_summary').select('key, computed_at').in('key', keys)
  const builtAt = new Map((data ?? []).map((r) => [String(r.key).slice(insightsKey('').length), String(r.computed_at)]))
  const built: string[] = []
  for (const day of daysToBuild(nowMs, builtAt, 3)) {
    if (Date.now() > deadlineMs) break
    try {
      await storeInsightsDay(day)
      built.push(day)
    } catch (e) {
      console.error('[insights] build failed', day, e instanceof Error ? e.message : 'error')
    }
  }
  return { built }
}

/** The page: the stored days of a period, building up to `buildMissing` missing ones now. */
export async function loadInsightsPeriod(from: string, to: string, opts: { nowMs?: number; buildMissing?: number } = {}): Promise<InsightsPeriod> {
  const admin = createAdminClient()
  if (!admin) return mergePeriod(from, to, [])
  const days = daysBetween(from, to)
  const rows = await pageAllIn<R, string>(days.map(insightsKey), (chunk, f, t) => admin.from('admin_summary').select('key, payload').in('key', chunk).order('key').range(f, t), 100, READ_CONCURRENCY)
  const stored = new Map(rows.map((r) => [(r.payload as InsightsDay).day, r.payload as InsightsDay]))
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
  if (logEvents.length) {
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
  const [facts, held] = await Promise.all([loadFacts(admin, userIds), loadHeld(admin)])
  const counts = new Map<string, InsightMember>()
  for (const id of userIds) {
    const role = countedRole(facts.get(id), held.has(id))
    if (!role) continue
    const cur = counts.get(id) ?? { id, role, count: 0 }
    cur.count += 1
    counts.set(id, cur)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}
