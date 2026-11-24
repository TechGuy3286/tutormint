// lib/insightsCore.ts
//
// Admin → Insights (owner, 20 Nov 2026 — PR-12). PURE: the rules, the shapes
// and the arithmetic, shared by the builder (lib/insights.ts), the page and the
// tests. Nothing here reads a database.
//
// HOW IT WORKS. Each Pakistan-time day is built once into ONE admin_summary row
// ('insights:day:YYYY-MM-DD') by the 5-minute cron — today every 10 minutes,
// past days until they settle — and the page only merges the stored days of the
// chosen period, so it opens fast and never touches a public page.
//
// PRIVACY. Counts and member ids only (ids open the admin profile; names are
// read at render time). No phone, email, CNIC, IP, rupee amount or full
// user-agent is stored here: signed-out visitors are counted by a keyed hash
// that changes every day (they cannot be followed from one day to the next),
// and a device is reduced to its category (mobile / desktop / tablet; Android /
// iPhone / other). Staff, seed, team, test-named, hidden and merged accounts and
// parents whose activity is held by the burst check are never counted.

import { funnelSteps, type FunnelStep } from '@/lib/signupFunnelCore'
import { COUNT_DEFS, type CountKey } from '@/lib/countsCore'

export const INSIGHTS_KEY_PREFIX = 'insights:day:'
export const insightsKey = (day: string) => `${INSIGHTS_KEY_PREFIX}${day}`
/** The longest custom range the page accepts (days). */
export const INSIGHTS_MAX_DAYS = 92
/** How far back the cron keeps days built. */
export const INSIGHTS_KEEP_DAYS = 31
/** Today's row is rebuilt when older than this (PR-15: was 10 minutes). */
export const INSIGHTS_TODAY_MAX_AGE_MS = 15 * 60 * 1000
/** The Insights job runs every 15 minutes (PR-15: was every 5-minute run). */
export const INSIGHTS_RUN_EVERY_MIN = 15

/** Is this 5-minute cron run one of the every-15-minutes Insights runs? The
 *  first 5-minute slot of each quarter hour (UTC minute 0–4, 15–19, …). */
export function insightsRunDue(nowMs: number): boolean {
  const minute = Math.floor(nowMs / 60_000) % 60
  return minute % INSIGHTS_RUN_EVERY_MIN < 5
}
/** A past day is rebuilt (funnels move on) when its row is older than this. */
export const INSIGHTS_PAST_MAX_AGE_MS = 24 * 60 * 60 * 1000

const DAY_MS = 86_400_000
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000

// ------------------------------------------------------------------ days ---

/** The Pakistan-time day (YYYY-MM-DD) of an instant (UTC+5, no DST). */
export function pkDayOf(ms: number): string {
  return new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10)
}
/** The instant a Pakistan-time day starts (ms). */
export function pkDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00+05:00`)
}
/** The Pakistan-time hour (0–23) of an instant. */
export function pkHourOf(ms: number): number {
  return new Date(ms + PKT_OFFSET_MS).getUTCHours()
}
/** Monday = 0 … Sunday = 6, for a YYYY-MM-DD day. */
export function weekdayOf(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
}
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Every day from `from` to `to` inclusive (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

export type PeriodKey = 'today' | 'yesterday' | '7d' | '30d' | 'custom'
export const PERIODS: { key: Exclude<PeriodKey, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
]

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The period the page shows, from its query string. Unknown → Today (PR-22). A
 * custom range is clamped to today, put in order and cut to INSIGHTS_MAX_DAYS.
 */
export function resolvePeriod(p: { period?: string | null; from?: string | null; to?: string | null }, nowMs: number): { key: PeriodKey; from: string; to: string; label: string } {
  const today = pkDayOf(nowMs)
  const back = (n: number) => pkDayOf(nowMs - n * DAY_MS)
  switch (p.period) {
    case 'yesterday':
      return { key: 'yesterday', from: back(1), to: back(1), label: 'Yesterday' }
    case '30d':
      return { key: '30d', from: back(29), to: today, label: 'Last 30 days' }
    case 'custom': {
      let from = ISO_DAY.test(p.from ?? '') ? (p.from as string) : back(6)
      let to = ISO_DAY.test(p.to ?? '') ? (p.to as string) : today
      if (from > to) [from, to] = [to, from]
      if (to > today) to = today
      if (from > to) from = to
      const days = daysBetween(from, to)
      if (days.length > INSIGHTS_MAX_DAYS) from = days[days.length - INSIGHTS_MAX_DAYS]
      return { key: 'custom', from, to, label: from === to ? from : `${from} to ${to}` }
    }
    case '7d':
      return { key: '7d', from: back(6), to: today, label: 'Last 7 days' }
    default:
      return { key: 'today', from: today, to: today, label: 'Today' }
  }
}

// --------------------------------------------------------------- device ---

export type DeviceKind = 'mobile' | 'tablet' | 'desktop'
/** PR-22: Windows and Mac are their own kinds (they were "other", so Other
 *  matched Desktop). "iphone" = iPhone and iPad. */
export type OsKind = 'android' | 'iphone' | 'windows' | 'mac' | 'other'
export const DEVICE_KINDS: DeviceKind[] = ['mobile', 'tablet', 'desktop']
export const OS_KINDS: OsKind[] = ['android', 'iphone', 'windows', 'mac', 'other']

/** A user agent reduced to its category. Only the category is ever stored. */
export function deviceOf(ua: string | null | undefined): { device: DeviceKind; os: OsKind } {
  const s = ua ?? ''
  const ipad = /iPad/i.test(s) || (/Macintosh/i.test(s) && /Mobile\//i.test(s))
  const iphone = /iPhone|iPod/i.test(s)
  const android = /Android/i.test(s)
  const os: OsKind = android ? 'android' : iphone || ipad ? 'iphone' : /Windows/i.test(s) ? 'windows' : /Macintosh|Mac OS X/i.test(s) ? 'mac' : 'other'
  if (ipad || (android && !/Mobile/i.test(s)) || /Tablet/i.test(s)) return { device: 'tablet', os }
  if (iphone || /Mobi|Android|Windows Phone|Opera Mini/i.test(s)) return { device: 'mobile', os }
  return { device: 'desktop', os }
}

export type DeviceCounts = Record<DeviceKind | OsKind, number>
export const zeroDevice = (): DeviceCounts => ({ mobile: 0, tablet: 0, desktop: 0, android: 0, iphone: 0, windows: 0, mac: 0, other: 0 })

// -------------------------------------------------------------- actions ---

export type ActionKey =
  | 'signed_up' | 'otp_verified' | 'document_uploaded' | 'profile_completed'
  | 'tuition_posted' | 'tuition_viewed' | 'applied' | 'shortlisted' | 'forwarded'
  | 'whatsapp_click' | 'call_click' | 'contact_viewed' | 'message_sent' | 'demo_requested'
  | 'pay_page' | 'pay_tried' | 'paid' | 'plan_bought'

export const ACTION_GROUPS: { key: string; label: string; items: { key: ActionKey; label: string }[] }[] = [
  {
    key: 'signup',
    label: 'Sign-up & profile',
    items: [
      { key: 'signed_up', label: COUNT_DEFS.signups.label },
      { key: 'otp_verified', label: COUNT_DEFS.mobile_verified.label },
      { key: 'document_uploaded', label: COUNT_DEFS.documents_uploaded.label },
      { key: 'profile_completed', label: COUNT_DEFS.tutor_onboarded.label },
    ],
  },
  {
    key: 'tuitions',
    label: 'Tuitions',
    items: [
      { key: 'tuition_posted', label: COUNT_DEFS.tuitions_posted.label },
      { key: 'tuition_viewed', label: 'Tuition page viewed (signed in)' },
      { key: 'applied', label: COUNT_DEFS.applications.label },
      { key: 'shortlisted', label: 'Tutor shortlisted' },
      { key: 'forwarded', label: COUNT_DEFS.forwarded.label },
    ],
  },
  {
    key: 'contact',
    label: 'Contact',
    items: [
      { key: 'whatsapp_click', label: 'WhatsApp tapped' },
      { key: 'call_click', label: 'Call tapped' },
      { key: 'contact_viewed', label: COUNT_DEFS.contact_viewed.label },
      { key: 'message_sent', label: 'Message sent' },
      { key: 'demo_requested', label: 'Demo requested' },
    ],
  },
  {
    key: 'payments',
    label: 'Payments (counts only)',
    items: [
      { key: 'pay_page', label: 'Payment page opened' },
      { key: 'pay_tried', label: 'Tried to pay' },
      { key: 'paid', label: 'Verification Fee paid' },
      { key: 'plan_bought', label: COUNT_DEFS.paid_plan.label },
    ],
  },
]
export const ACTION_KEYS_ALL: ActionKey[] = ACTION_GROUPS.flatMap((g) => g.items.map((i) => i.key))
export const isActionKey = (v: unknown): v is ActionKey => typeof v === 'string' && (ACTION_KEYS_ALL as string[]).includes(v)
export const actionLabel = (k: ActionKey) => ACTION_GROUPS.flatMap((g) => g.items).find((i) => i.key === k)?.label ?? k
export const zeroActions = (): Record<ActionKey, number> => Object.fromEntries(ACTION_KEYS_ALL.map((k) => [k, 0])) as Record<ActionKey, number>

/** The actions that ARE shared admin counts (PR-14): their numbers come from
 *  lib/counts, never from events. "Signed up" counted the sign-up event, which
 *  mobile sign-ups wrote twice, and "Tuition posted" left out the staff who post
 *  every tuition. The same count on every screen. */
export const SHARED_ACTION_COUNT: Partial<Record<ActionKey, CountKey>> = {
  signed_up: 'signups',
  otp_verified: 'mobile_verified',
  document_uploaded: 'documents_uploaded',
  profile_completed: 'tutor_onboarded',
  tuition_posted: 'tuitions_posted',
  applied: 'applications',
  forwarded: 'forwarded',
  contact_viewed: 'contact_viewed',
  paid: 'paid_fee',
  plan_bought: 'paid_plan',
}

/** user_activity_log events → the action they count as (server-written facts),
 *  for the actions that are not shared counts. */
export const LOG_EVENT_ACTION: Record<string, ActionKey> = {
  shortlist_added: 'shortlisted',
  message_sent: 'message_sent',
  demo_requested: 'demo_requested',
  payment_submitted: 'pay_tried',
}

/** activity_events (the signed-in tracker) → an action, or null. */
export function trackerAction(ev: { kind: string; path: string | null; label: string | null }): ActionKey | null {
  if (ev.kind === 'action') return ev.label === 'whatsapp_click' ? 'whatsapp_click' : ev.label === 'call_click' ? 'call_click' : null
  if (ev.kind !== 'page_view') return null
  const p = (ev.path ?? '').split('?')[0]
  if (p === '/pay/choose' || p.startsWith('/pay/choose/')) return 'pay_page'
  // A tuition's own page: /tuitions/<city>/<slug> or /tuition-jobs/<…>.
  if (/^\/tuitions\/[^/]+\/[^/]+\/?$/.test(p) || /^\/tuition-jobs\/[^/]+/.test(p)) return 'tuition_viewed'
  return null
}

// ------------------------------------------------------------- accounts ---

export type MemberFacts = {
  role: string | null
  admin_role: string | null
  is_seed: boolean | null
  is_team_account: boolean | null
  is_test_name: boolean | null
  hidden_from_public: boolean | null
  merged_into: string | null
}

/** 'tutor' | 'parent' when the account counts; null when it never does. */
export function countedRole(p: MemberFacts | undefined, held: boolean): 'tutor' | 'parent' | null {
  if (!p || held) return null
  if (p.admin_role || p.role === 'admin') return null
  if (p.is_seed || p.is_team_account || p.is_test_name || p.hidden_from_public || p.merged_into) return null
  return p.role === 'tutor' ? 'tutor' : p.role === 'parent' ? 'parent' : null
}

// ------------------------------------------------------------- searches ---

export type SearchRow = {
  surface: string
  city: string | null
  area: string | null
  masterId: number | null
  mode: string | null
  gender: string | null
  n: number
  zero: number
  /** PR-22: searches that FAILED (a timeout or error) — never counted as zero results. */
  failed?: number
}
export const searchKey = (s: Pick<SearchRow, 'surface' | 'city' | 'area' | 'masterId' | 'mode' | 'gender'>) =>
  [s.surface, s.city ?? '', s.area ?? '', s.masterId ?? '', s.mode ?? '', s.gender ?? ''].join('|').toLowerCase()

/** Add searches into a map keyed by searchKey. */
export function addSearches(into: Map<string, SearchRow>, rows: readonly SearchRow[]): Map<string, SearchRow> {
  for (const r of rows) {
    const k = searchKey(r)
    const cur = into.get(k)
    if (cur) {
      cur.n += r.n
      cur.zero += r.zero
      cur.failed = (cur.failed ?? 0) + (r.failed ?? 0)
    } else into.set(k, { ...r, failed: r.failed ?? 0 })
  }
  return into
}
/** Busiest first, then by name — the top `limit`. */
export function topSearches(rows: Iterable<SearchRow>, limit = 20, by: 'n' | 'zero' = 'n'): SearchRow[] {
  return [...rows].filter((r) => r[by] > 0).sort((a, b) => b[by] - a[by] || searchKey(a).localeCompare(searchKey(b))).slice(0, limit)
}
/** Searches kept per stored day (the long tail is cut). */
export const SEARCHES_PER_DAY = 300

// ----------------------------------------------------------- the day row ---

// The cohort funnels (PR-14): step 1 is the shared New tutors / New parents
// count for the period; every later step is "of them", so its label never
// matches a dated count that shows a different number. PR-22: the steps follow
// the onboarding flow and each one counts only people who reached EVERY step
// before it (signupFunnelCore cohortFunnel) — a step can never be higher than
// the one before.
export const TUTOR_FUNNEL = [
  { key: 'signed_up', label: 'Tutors signed up' },
  { key: 'mobile', label: 'Then: mobile verified' },
  { key: 'documents', label: 'Then: CNIC and photo uploaded' },
  { key: 'profile', label: 'Then: onboarding finished' },
  { key: 'approved', label: 'Then: documents approved' },
  { key: 'pay_page', label: 'Then: payment page opened' },
  { key: 'paid', label: 'Then: paid' },
] as const
export const PARENT_FUNNEL = [
  { key: 'signed_up', label: 'Parents signed up' },
  { key: 'posted', label: 'Then: posted a tuition' },
  { key: 'applications', label: 'Then: received applications' },
  { key: 'contacted', label: 'Then: contacted a tutor' },
] as const

/** The stored day's shape version. PR-14 changed what a day counts, and PR-22
 *  again (subset funnels, page visits, Windows/Mac, failed searches), so an
 *  older row is treated as missing and rebuilt. */
export const INSIGHTS_DAY_VERSION = 3

export type InsightsDay = {
  v: 3
  day: string
  builtAt: string
  /** Signed-out visitors (unique per day; a daily-changing hash). */
  visitors: number
  /** PR-22: signed-out page visits — the SAME counter as the Overview "Daily
   *  sign-up funnel" "Public page visits" (site_visit_counts public_page). */
  pageVisits: number
  tutorsActive: string[]
  parentsActive: string[]
  /** Accounts that signed up that day (counted only). */
  newTutors: string[]
  newParents: string[]
  actions: Record<ActionKey, number>
  searches: SearchRow[]
  /** Activity per Pakistan-time hour (visitor page views + member activity). */
  hours: number[]
  /** Distinct visitors and members per category. */
  device: DeviceCounts
  /** That day's sign-up cohort: how many reached each step (so far). */
  funnelTutor: number[]
  funnelParent: number[]
  /** Burst-held parents whose activity that day was left out (PR-14, labelled on the page). */
  heldParents: string[]
}

export function emptyDay(day: string, builtAt: string): InsightsDay {
  return {
    v: 3,
    day,
    builtAt,
    visitors: 0,
    pageVisits: 0,
    tutorsActive: [],
    parentsActive: [],
    newTutors: [],
    newParents: [],
    actions: zeroActions(),
    searches: [],
    hours: Array.from({ length: 24 }, () => 0),
    device: zeroDevice(),
    funnelTutor: TUTOR_FUNNEL.map(() => 0),
    funnelParent: PARENT_FUNNEL.map(() => 0),
    heldParents: [],
  }
}

// ------------------------------------------------------------- the period ---

export type InsightsPeriod = {
  from: string
  to: string
  /** Days in the period that have been built (others show as gaps). */
  builtDays: number
  totalDays: number
  daily: { day: string; tutors: number; parents: number; visitors: number; newSignups: number; returning: number }[]
  /** Distinct members across the whole period; visitors are the sum of daily uniques. */
  totals: { tutors: number; parents: number; visitorDays: number; pageVisits: number; failedSearches: number; newSignups: number; newTutors: number; newParents: number; returning: number; heldParents: number }
  actions: Record<ActionKey, number>
  searches: SearchRow[]
  zeroSearches: SearchRow[]
  /** [weekday 0=Mon][hour] → activity. */
  grid: number[][]
  gridMax: number
  device: DeviceCounts
  funnelTutor: FunnelStep[]
  funnelParent: FunnelStep[]
}

/** Merge the stored days of a period into what the page shows. Pure. */
export function mergePeriod(from: string, to: string, stored: readonly InsightsDay[]): InsightsPeriod {
  const days = daysBetween(from, to)
  const byDay = new Map(stored.map((d) => [d.day, d]))
  const tutors = new Set<string>()
  const parents = new Set<string>()
  const newIds = new Set<string>()
  const newT = new Set<string>()
  const newP = new Set<string>()
  const heldIds = new Set<string>()
  const actions = zeroActions()
  const searches = new Map<string, SearchRow>()
  const grid = WEEKDAYS.map(() => Array.from({ length: 24 }, () => 0))
  const device = zeroDevice()
  const ft = TUTOR_FUNNEL.map(() => 0)
  const fp = PARENT_FUNNEL.map(() => 0)
  let visitorDays = 0
  let pageVisits = 0
  const daily: InsightsPeriod['daily'] = []
  for (const day of days) {
    const d = byDay.get(day)
    if (!d) {
      daily.push({ day, tutors: 0, parents: 0, visitors: 0, newSignups: 0, returning: 0 })
      continue
    }
    for (const id of d.tutorsActive) tutors.add(id)
    for (const id of d.parentsActive) parents.add(id)
    for (const id of [...d.newTutors, ...d.newParents]) newIds.add(id)
    for (const id of d.newTutors) newT.add(id)
    for (const id of d.newParents) newP.add(id)
    for (const id of d.heldParents ?? []) heldIds.add(id)
    const dayNew = new Set([...d.newTutors, ...d.newParents])
    const active = [...d.tutorsActive, ...d.parentsActive]
    daily.push({
      day,
      tutors: d.tutorsActive.length,
      parents: d.parentsActive.length,
      visitors: d.visitors,
      newSignups: dayNew.size,
      returning: active.filter((id) => !dayNew.has(id)).length,
    })
    visitorDays += d.visitors
    pageVisits += d.pageVisits ?? 0
    for (const k of ACTION_KEYS_ALL) actions[k] += d.actions[k] ?? 0
    addSearches(searches, d.searches)
    const w = weekdayOf(day)
    d.hours.forEach((n, h) => (grid[w][h] += n))
    for (const k of Object.keys(device) as (keyof DeviceCounts)[]) device[k] += d.device[k] ?? 0
    d.funnelTutor.forEach((n, i) => (ft[i] += n))
    d.funnelParent.forEach((n, i) => (fp[i] += n))
  }
  const activeAll = [...tutors, ...parents]
  return {
    from,
    to,
    builtDays: days.filter((d) => byDay.has(d)).length,
    totalDays: days.length,
    daily,
    totals: {
      tutors: tutors.size,
      parents: parents.size,
      visitorDays,
      pageVisits,
      failedSearches: [...searches.values()].reduce((n, r) => n + (r.failed ?? 0), 0),
      newSignups: newIds.size,
      newTutors: newT.size,
      newParents: newP.size,
      returning: activeAll.filter((id) => !newIds.has(id)).length,
      heldParents: heldIds.size,
    },
    actions,
    searches: topSearches(searches.values(), 20, 'n'),
    zeroSearches: topSearches(searches.values(), 20, 'zero'),
    grid,
    gridMax: Math.max(0, ...grid.flat()),
    device,
    funnelTutor: funnelSteps(TUTOR_FUNNEL.map((s, i) => ({ key: s.key, label: s.label, count: ft[i] }))),
    funnelParent: funnelSteps(PARENT_FUNNEL.map((s, i) => ({ key: s.key, label: s.label, count: fp[i] }))),
  }
}

/**
 * Which days the cron should (re)build now, oldest need first, at most `max`.
 * Today when missing or older than 15 minutes; yesterday until it was built
 * after the day ended; missing days in the kept window; then past days whose
 * row is a day old (their funnels keep moving).
 */
export function daysToBuild(nowMs: number, builtAt: ReadonlyMap<string, string>, max = 3): string[] {
  const today = pkDayOf(nowMs)
  const out: string[] = []
  const add = (d: string) => {
    if (!out.includes(d) && out.length < max) out.push(d)
  }
  const age = (d: string) => {
    const b = builtAt.get(d)
    return b ? nowMs - Date.parse(b) : Infinity
  }
  if (age(today) > INSIGHTS_TODAY_MAX_AGE_MS) add(today)
  const yesterday = pkDayOf(nowMs - DAY_MS)
  const yb = builtAt.get(yesterday)
  if (!yb || Date.parse(yb) < pkDayStartMs(today) + 5 * 60 * 1000) add(yesterday)
  for (let i = 2; i < INSIGHTS_KEEP_DAYS; i++) {
    const d = pkDayOf(nowMs - i * DAY_MS)
    if (!builtAt.has(d)) add(d)
  }
  const stale = [...builtAt.entries()]
    .filter(([d]) => d < yesterday && d >= pkDayOf(nowMs - (INSIGHTS_KEEP_DAYS - 1) * DAY_MS))
    .filter(([, b]) => nowMs - Date.parse(b) > INSIGHTS_PAST_MAX_AGE_MS)
    .sort((a, b) => a[1].localeCompare(b[1]))
  for (const [d] of stale) add(d)
  return out
}

/** "12%" or "—". */
export const pct = (n: number | null) => (n == null ? '—' : `${n}%`)

/** The request's "now" — one place, so pages read the clock outside render code. */
export function requestNowMs(): number {
  return Date.now()
}
