// lib/adminSummaryCore.ts
//
// PURE (scripts/test-push2.ts). Push 2 of "Fast admin" (owner, 1 Nov 2026).
//
// Every admin page used to work out its sidebar badges on every load (226
// database calls, ~2 s in production), the Overview its figures (700 calls,
// ~4 s), and People / Follow-ups their whole lists (125 / 152 calls). One job
// (lib/adminSummary rebuildAdminSummary) now works them out — with the SAME
// loaders, so every rule stays where it was — and stores the result:
//
//   admin_summary    'badges', 'overview:7', 'overview:30', 'sections',
//                    'people', 'state'
//   admin_list_rows  People and Follow-ups rows, paged and counted in SQL
//                    (admin_list_page, migration 219)
//
// The job runs every minute when something changed (an admin action or a
// member action marks the summary "dirty"), and at least every 10 minutes.
// Pages read one row and say "Updated <time>".

import { pkDayStart } from '@/lib/staffOutreachCore'

export const SUMMARY_MAX_AGE_MS = 10 * 60_000
/** A rebuild that started this long ago and never finished is presumed dead. */
export const REBUILD_STALE_MS = 4 * 60_000

// ------------------------------------------------------------------ state ---

export type SummaryState = {
  builtAt: string | null
  startedAt: string | null
  dirtyAt: string | null
}

/** Should the job rebuild now? Never while another rebuild is running. */
export function needsRebuild(s: SummaryState, nowMs: number, force = false): boolean {
  const started = s.startedAt ? Date.parse(s.startedAt) : NaN
  const built = s.builtAt ? Date.parse(s.builtAt) : NaN
  const running = Number.isFinite(started) && (!Number.isFinite(built) || started > built) && nowMs - started < REBUILD_STALE_MS
  if (running) return false
  if (force) return true
  if (!Number.isFinite(built)) return true
  if (nowMs - built >= SUMMARY_MAX_AGE_MS) return true
  const dirty = s.dirtyAt ? Date.parse(s.dirtyAt) : NaN
  return Number.isFinite(dirty) && dirty > built
}

/** "Updated just now" · "Updated 4 min ago" · "Updated 2 h ago". */
export function updatedLabel(iso: string | null | undefined, nowMs: number): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return 'Not worked out yet'
  const min = Math.max(0, Math.floor((nowMs - t) / 60_000))
  if (min < 1) return 'Updated just now'
  if (min < 60) return `Updated ${min} min ago`
  return `Updated ${Math.floor(min / 60)} h ago`
}

/**
 * Member actions that never change a badge, an Overview figure or a list row:
 * they do not mark the summary dirty (a sign-in would otherwise rebuild every
 * minute all day). Everything else does.
 */
export const DIRTY_IGNORED_EVENTS = new Set([
  'login',
  'logout',
  'search_performed',
  'profile_viewed',
  'viewed_profile',
  'message_sent',
  'message_read',
  'notification_read',
  'shortlist_added',
  'shortlist_removed',
  'cv_downloaded',
  'cv_accent_changed',
])

// ----------------------------------------------------------------- badges ---

/** A count the Owner sees whole and every other staff member for their own items. */
export type Tally = { total: number; byOwner: Record<string, number> }

export function tally(items: { ownerId: string | null }[]): Tally {
  const byOwner: Record<string, number> = {}
  for (const i of items) if (i.ownerId) byOwner[i.ownerId] = (byOwner[i.ownerId] ?? 0) + 1
  return { total: items.length, byOwner }
}

export function viewerCount(t: Tally | null | undefined, actor: { id: string; adminRole: string | null | undefined }): number {
  if (!t) return 0
  return actor.adminRole === 'owner' ? t.total : (t.byOwner[actor.id] ?? 0)
}

export type BadgesPayload = {
  reports: number
  receipts: number
  peopleWaiting: number
  followUpsOverdue: number
  parentOverdue: number
  appsOverdue: Tally
  paidRed: Tally
}

/** The sidebar badges for one viewer, from the stored payload (the layout's
 *  old navBadges, same keys and the same role checks). */
export function navBadgesFrom(
  b: BadgesPayload,
  actor: { id: string; adminRole: string | null | undefined },
  may: { followUps: boolean; paidTutors: boolean; parentFollowUps: boolean },
): Record<string, number> {
  return {
    '/admin/reports': b.reports,
    '/admin/payments': b.receipts,
    '/admin/applications': viewerCount(b.appsOverdue, actor),
    '/admin/users': b.peopleWaiting,
    '/admin/follow-ups': (may.followUps ? b.followUpsOverdue : 0) + (may.parentFollowUps ? b.parentOverdue : 0),
    '/admin/paid-tutors': may.paidTutors ? viewerCount(b.paidRed, actor) : 0,
  }
}

// ------------------------------------------------------------------ lists ---

export type PeopleListRole = 'tutor' | 'parent'
export const peopleList = (r: PeopleListRole) => `people:${r}`
export const tutorFuList = (scope: string) => `fu_tutor:${scope}`
export const PARENT_FU_LIST = 'fu_parent'

/** Lower-case search haystack: every field on its own line, so a search never
 *  matches across two fields. */
export function searchHaystack(fields: (string | null | undefined)[]): string {
  return fields
    .map((f) => (f ?? '').toLowerCase().trim())
    .filter(Boolean)
    .join('\n')
}

/** The sign-up window chips as a time range (the rule of staffOutreachCore
 *  signedUpIn, which the list used before). */
export function windowRange(window: 'today' | 'yesterday' | 'week', nowMs: number): { since: string; until: string } {
  const today = pkDayStart(nowMs)
  const DAY = 86_400_000
  if (window === 'today') return { since: new Date(today).toISOString(), until: new Date(nowMs + 1).toISOString() }
  if (window === 'yesterday') return { since: new Date(today - DAY).toISOString(), until: new Date(today).toISOString() }
  return { since: new Date(nowMs - 7 * DAY).toISOString(), until: new Date(nowMs + 1).toISOString() }
}

/** Follow-ups → Tutors: the To do / Followed up / No reply split value. */
export function tutorTabSection(state: { tab: string; section: string }): 'todo' | 'sent' | 'no_reply' {
  if (state.tab === 'todo') return 'todo'
  return state.section === 'no_reply' ? 'no_reply' : 'sent'
}

/** The answer of admin_list_page (migration 219). */
export type ListPage<R> = {
  all: number
  searched: number
  rowCounts: Record<string, Record<string, number>>
  split: Record<string, number>
  total: number
  rows: { id: string; row: R }[]
}

export function emptyListPage<R>(): ListPage<R> {
  return { all: 0, searched: 0, rowCounts: {}, split: {}, total: 0, rows: [] }
}

// -------------------------------------------- from a list page to the grid ---

/** The first `shown` rows, as lib/adminPagingCore pageSlice would give them. */
export function sliceFromList<T>(rows: T[], total: number, shown: number, size = 25): { rows: T[]; shown: number; total: number; more: number; nextN: number | null } {
  const more = Math.max(0, total - rows.length)
  return { rows, shown: rows.length, total, more, nextN: more > 0 ? shown + size : null }
}

/** Each chip row's counts in the grid's shape: every option, 0 when absent. */
export function chipCountsFromList(
  rowCounts: Record<string, Record<string, number>>,
  rows: { param: string; options: { key: string }[] }[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    const got = rowCounts[r.param] ?? {}
    out[r.param] = Object.fromEntries(r.options.map((o) => [o.key, got[o.key] ?? 0]))
  }
  return out
}

/** How many rows the search and every chip row leave (before the final split). */
export function poolCount(
  res: { searched: number; rowCounts: Record<string, Record<string, number>> },
  rows: { param: string }[],
  sel: Record<string, string>,
): number {
  if (rows.length === 0) return res.searched
  const last = rows[rows.length - 1].param
  const v = sel[last] ?? 'all'
  return res.rowCounts[last]?.[v] ?? 0
}

/** The Documents chips' counts: "All" is the pool, each other its split count. */
export function splitCounts<K extends string>(split: Record<string, number>, keys: readonly K[], pool: number): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, k === 'all' ? pool : (split[k] ?? 0)])) as Record<K, number>
}
