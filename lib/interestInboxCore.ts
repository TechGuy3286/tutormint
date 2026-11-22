// lib/interestInboxCore.ts — PURE (owner, 19 Nov 2026 — PR-10).
//
// The central "Parent interest" inbox: ONE row per tutor, built from every
// eligible parent's activity on that tutor in the last 30 days — demo requests,
// message attempts (also the blocked ones to unpaid tutors), shortlists and
// profile views. Staff send the tutor one WhatsApp message that sums it up.
// The same rows feed People → WhatsApp updates → Parent interest, the Parent
// interest panel on a parent's member page, the Overview to-do row and the
// sidebar badge. No I/O; lib/interestInbox.ts does the reads and writes.
//
// HONEST BY CONSTRUCTION. Only real parent accounts count (parentCounts — never
// staff, test, seed, team, hidden, merged or erased), never an account held by
// the burst check, never the tutor on themselves. A parent counts once per
// kind per tutor, however often they pressed. No activity → no row.
//
// PRIVACY. The message names a parent only as blurName() ("S**** K****") with
// their area/city. Never a phone, email or address.
//
// Unit-tested by scripts/test-interest-inbox.ts.

import { blurName, DAY_MS, pkDayStartMs, pkWeekStartMs, safePlace, WA_WEEKLY_CAP } from '@/lib/tutorTeasersCore'
import { cityOwnerFor } from '@/lib/cityOwnersCore'

export type InboxKind = 'demo' | 'message' | 'shortlist' | 'view'

/** Hottest first: a demo request > a message attempt > a shortlist > a view. */
export const KIND_RANK: Record<InboxKind, number> = { demo: 4, message: 3, shortlist: 2, view: 1 }
export const INBOX_KINDS: InboxKind[] = ['demo', 'message', 'shortlist', 'view']

/** The inbox reads this far back. */
export const INBOX_WINDOW_DAYS = 30
/** A tutor sent from the inbox is not offered again for this long — and after
 *  it, only for activity newer than the send ("New activity since sent"). */
export const NO_REPEAT_DAYS = 3
/** Unpaid tutors a day (shared with PR-08's cap — the inbox took those rows). */
export const INBOX_UNPAID_DAILY_CAP = 50

export type InboxActivity = {
  /** parent_interest_events.id or profile_views.id. */
  id: string
  tutorId: string
  parentId: string
  kind: InboxKind
  at: string
  /** The attempt could not reach the tutor (e.g. unpaid). */
  blocked?: boolean
}

export type InboxParentFacts = { counts: boolean; held: boolean }

/**
 * The activity that may feed the inbox: in the 30-day window (and not in the
 * future), from a parent who counts and is not held, not the tutor on
 * themselves.
 */
export function usableActivity(acts: InboxActivity[], p: { nowMs: number; parent: (id: string) => InboxParentFacts | undefined }): InboxActivity[] {
  const from = p.nowMs - INBOX_WINDOW_DAYS * DAY_MS
  return acts.filter((a) => {
    const t = Date.parse(a.at)
    if (!Number.isFinite(t) || t < from || t > p.nowMs) return false
    if (a.parentId === a.tutorId) return false
    const f = p.parent(a.parentId)
    return !!f && f.counts && !f.held
  })
}

/** Why a parent's activity is left out of the inbox — for the parent page. */
export function parentLeftOut(f: InboxParentFacts | undefined): 'held' | 'not_counted' | null {
  if (!f || !f.counts) return 'not_counted'
  if (f.held) return 'held'
  return null
}

// ---------------------------------------------------------------- summary ---

export type KindCounts = Record<InboxKind, number>
export type InboxSummary = {
  /** Distinct parents. */
  parents: number
  /** Distinct parents per kind (a parent who shortlisted twice counts once). */
  counts: KindCounts
  hottest: InboxKind
  lastAt: string
}

export const zeroCounts = (): KindCounts => ({ demo: 0, message: 0, shortlist: 0, view: 0 })

/** One tutor's activity summed up. Null when there is none. */
export function summarise(acts: InboxActivity[]): InboxSummary | null {
  if (acts.length === 0) return null
  const byKind = new Map<InboxKind, Set<string>>()
  const parents = new Set<string>()
  let lastAt = ''
  let hottest: InboxKind = 'view'
  for (const a of acts) {
    parents.add(a.parentId)
    byKind.set(a.kind, (byKind.get(a.kind) ?? new Set()).add(a.parentId))
    if (a.at > lastAt) lastAt = a.at
    if (KIND_RANK[a.kind] > KIND_RANK[hottest]) hottest = a.kind
  }
  const counts = zeroCounts()
  for (const k of INBOX_KINDS) counts[k] = byKind.get(k)?.size ?? 0
  return { parents: parents.size, counts, hottest, lastAt }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const KIND_NOUN: Record<InboxKind, [string, string]> = {
  demo: ['demo request', 'demo requests'],
  message: ['message attempt', 'message attempts'],
  shortlist: ['shortlist', 'shortlists'],
  view: ['view', 'views'],
}

/** "3 parents · 1 demo request · 1 shortlist · 2 views · Lahore" (the page adds
 *  "last activity 2 h ago" with <TimeAgo>). */
export function summaryLine(s: InboxSummary, city: string | null): string {
  const parts = [plural(s.parents, 'parent', 'parents')]
  for (const k of INBOX_KINDS) if (s.counts[k] > 0) parts.push(plural(s.counts[k], ...KIND_NOUN[k]))
  if (city) parts.push(city)
  return parts.join(' · ')
}

/** Hottest first (the hottest kind a tutor has), then the most recent activity. */
export function hotOrder(a: { tutorId: string; summary: InboxSummary }, b: { tutorId: string; summary: InboxSummary }): number {
  return (
    KIND_RANK[b.summary.hottest] - KIND_RANK[a.summary.hottest] ||
    b.summary.lastAt.localeCompare(a.summary.lastAt) ||
    a.tutorId.localeCompare(b.tutorId)
  )
}

// ------------------------------------------------------------------ sends ---

/** A whatsapp_update_sends row as the inbox reads it (every channel). */
export type InboxSend = {
  id: string
  createdAt: string
  undoneAt: string | null
  channel: 'daily' | 'interest'
  /** Newest activity the message covered (interest sends). */
  activityAt: string | null
  unpaid: boolean
  staffId: string | null
  staffName: string | null
  sentFrom: 'inbox' | 'parent_page' | null
}

const live = (s: InboxSend[]) => s.filter((x) => !x.undoneAt)

/** The newest live interest send, if any. */
export function lastInterestSend(sends: InboxSend[]): InboxSend | null {
  return live(sends).filter((s) => s.channel === 'interest').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

export type InboxTab = 'to_send' | 'sent' | 'new_since_sent'
export const INBOX_TABS: { key: InboxTab; label: string }[] = [
  { key: 'to_send', label: 'To send' },
  { key: 'sent', label: 'Sent' },
  { key: 'new_since_sent', label: 'New activity since sent' },
]

/**
 * Which tab a tutor is in:
 *   to_send         never sent from the inbox (or every send was undone);
 *   new_since_sent  sent before, and a parent did something AFTER the activity
 *                   that send covered;
 *   sent            sent, nothing new since. It is not offered again — not in
 *                   the next 3 days, and not after them either until a parent
 *                   does something new (the old activity was already told).
 */
export function inboxTab(acts: InboxActivity[], sends: InboxSend[]): { tab: InboxTab; last: InboxSend | null } {
  const last = lastInterestSend(sends)
  if (!last) return { tab: 'to_send', last: null }
  const cover = last.activityAt ?? last.createdAt
  return { tab: acts.some((a) => a.at > cover) ? 'new_since_sent' : 'sent', last }
}

/** The activity today's message carries: everything (To send), or only what
 *  came after the last send (New activity since sent). */
export function pendingActivity(acts: InboxActivity[], last: InboxSend | null): InboxActivity[] {
  if (!last) return acts
  const cover = last.activityAt ?? last.createdAt
  return acts.filter((a) => a.at > cover)
}

/** True when the last interest send is less than 3 days old (shown on the row:
 *  "Sent 2 days ago — new activity only"). */
export function withinNoRepeat(last: InboxSend | null, nowMs: number): boolean {
  return !!last && nowMs - Date.parse(last.createdAt) < NO_REPEAT_DAYS * DAY_MS
}

// ------------------------------------------------------------------- caps ---

export type WaitReason = 'sent_today' | 'week_cap' | 'daily_cap'
export const WAIT_LABEL: Record<WaitReason, string> = {
  sent_today: 'Already sent a WhatsApp today — tomorrow',
  week_cap: `Had ${WA_WEEKLY_CAP} WhatsApp updates this week — next week`,
  daily_cap: `Over today's ${INBOX_UNPAID_DAILY_CAP} unpaid tutors — tomorrow`,
}

/** Live sends today / this Pakistan week, every channel (the caps are shared
 *  with the daily WhatsApp updates). */
export function sendCounts(sends: InboxSend[], nowMs: number): { today: number; week: number } {
  const day = pkDayStartMs(nowMs)
  const week = pkWeekStartMs(nowMs)
  const l = live(sends)
  return { today: l.filter((s) => Date.parse(s.createdAt) >= day).length, week: l.filter((s) => Date.parse(s.createdAt) >= week).length }
}

/**
 * The caps over the sendable rows (To send + New activity since sent), taken
 * hottest first: one WhatsApp a tutor a day and two a Pakistan week (any
 * channel), and at most 50 unpaid tutors a day (counting the unpaid sends
 * already made today). Returns each row's wait reason, null = ready today.
 * Parent-interest rows rank first in these caps: the daily queue no longer
 * carries unpaid rows at all.
 */
export function applyCaps<T extends { tutorId: string; unpaid: boolean; today: number; week: number }>(
  sortedRows: T[],
  p: { unpaidSentToday: number; unpaidCap?: number; weeklyCap?: number },
): Map<string, WaitReason | null> {
  const cap = p.unpaidCap ?? INBOX_UNPAID_DAILY_CAP
  const weekly = p.weeklyCap ?? WA_WEEKLY_CAP
  let unpaidLeft = Math.max(0, cap - p.unpaidSentToday)
  const out = new Map<string, WaitReason | null>()
  for (const r of sortedRows) {
    if (r.today > 0) out.set(r.tutorId, 'sent_today')
    else if (r.week >= weekly) out.set(r.tutorId, 'week_cap')
    else if (r.unpaid && unpaidLeft <= 0) out.set(r.tutorId, 'daily_cap')
    else {
      if (r.unpaid) unpaidLeft--
      out.set(r.tutorId, null)
    }
  }
  return out
}

// ------------------------------------------------------------- assignment ---

/** Who works a tutor's row: their city's owner (City owners page), else the
 *  site Owner. */
export function assigneeFor(city: string | null | undefined, cityOwners: Map<string, string>, siteOwnerId: string): string {
  return cityOwnerFor(city, cityOwners, siteOwnerId)
}

/** The staff filter: a role that sees every row may pick "all", "mine" or one
 *  staff member; any other role sees only its own rows, whatever it asks. */
export function staffFilter(seesAll: boolean, actorId: string, asked: string | null | undefined): { mode: 'all' } | { mode: 'one'; staffId: string } {
  if (!seesAll) return { mode: 'one', staffId: actorId }
  if (asked === 'all') return { mode: 'all' }
  if (!asked || asked === 'mine') return { mode: 'one', staffId: actorId }
  return { mode: 'one', staffId: asked }
}

// ---------------------------------------------------------------- message ---

export type MessageParent = { name: string | null; city: string | null; area: string | null; kinds: InboxKind[]; lastAt: string }

/** One entry per parent, hottest kind first, then newest. */
export function messageParents(acts: InboxActivity[], info: (id: string) => { name: string | null; city: string | null; area: string | null } | undefined): MessageParent[] {
  const by = new Map<string, { kinds: Set<InboxKind>; lastAt: string }>()
  for (const a of acts) {
    const cur = by.get(a.parentId) ?? { kinds: new Set<InboxKind>(), lastAt: a.at }
    cur.kinds.add(a.kind)
    if (a.at > cur.lastAt) cur.lastAt = a.at
    by.set(a.parentId, cur)
  }
  const top = (k: Set<InboxKind>) => Math.max(...[...k].map((x) => KIND_RANK[x]))
  return [...by.entries()]
    .sort((a, b) => top(b[1].kinds) - top(a[1].kinds) || b[1].lastAt.localeCompare(a[1].lastAt))
    .map(([id, v]) => {
      const p = info(id)
      return {
        name: p?.name ?? null,
        city: p?.city ?? null,
        area: p?.area ?? null,
        kinds: [...v.kinds].sort((x, y) => KIND_RANK[y] - KIND_RANK[x]),
        lastAt: v.lastAt,
      }
    })
}

/** "DHA, Lahore" / "Lahore" / null — only places fit to show (safePlace). */
export function placeOf(p: { city: string | null; area: string | null }): string | null {
  const city = safePlace(p.city)
  const area = safePlace(p.area)
  if (area && city && area.toLowerCase() !== city.toLowerCase()) return `${area}, ${city}`
  return area ?? city
}

function verb(kind: InboxKind, paid: boolean): string {
  if (kind === 'demo') return 'requested a demo'
  if (kind === 'message') return paid ? 'messaged you' : 'tried to message you'
  if (kind === 'shortlist') return 'shortlisted you'
  return 'viewed your profile'
}

function andList(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** "a parent from Lahore requested a demo and shortlisted you (S**** K****)". */
export function parentPhrase(p: MessageParent, paid: boolean, onTutorMint = false): string {
  const place = placeOf(p)
  const blurred = blurName(p.name)
  const who = place ? `a parent from ${place}` : 'a parent'
  const tail = blurred === 'A parent' ? '' : ` (${blurred})`
  return `${who} ${andList(p.kinds.map((k) => verb(k, paid)))}${onTutorMint ? ' on TutorMint' : ''}${tail}`
}

export const INBOX_NAMES_SHOWN = 3
export const UNPAID_CLOSING = 'Get verified so parents can contact you:'
export const PAID_CLOSING = 'Open TutorMint to reply:'

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The ready WhatsApp message, every parent and activity in one:
 *   Assalam o Alaikum Ayesha, a parent from Lahore requested a demo on TutorMint (S**** K****).
 *   Get verified so parents can contact you:            ← paid: "Open TutorMint to reply:"
 *   https://www.tutormint.org/…
 *   Need help? WhatsApp 0321 5872222
 * Several parents: "3 parents showed interest in you on TutorMint." then one
 * line naming up to three of them and "and N more". At most three lines before
 * the one link; no emoji, no price, no superlative; blurred names only.
 */
export function inboxMessage(p: { firstName: string; parents: MessageParent[]; paid: boolean; link: string; supportWhatsapp: string }): string {
  const name = p.firstName.trim()
  const hi = `Assalam o Alaikum${name ? ` ${name}` : ''}, `
  const lines: string[] = []
  const n = p.parents.length
  if (n <= 1) {
    lines.push(`${hi}${p.parents[0] ? parentPhrase(p.parents[0], p.paid, true) : 'parents showed interest in you on TutorMint'}.`)
  } else {
    lines.push(`${hi}${n} parents showed interest in you on TutorMint.`)
    const named = p.parents.slice(0, INBOX_NAMES_SHOWN).map((x) => `${cap1(parentPhrase(x, p.paid))}.`)
    const more = n - INBOX_NAMES_SHOWN
    if (more > 0) named.push(`And ${plural(more, 'more parent', 'more parents')}.`)
    lines.push(named.join(' '))
  }
  lines.push(p.paid ? PAID_CLOSING : UNPAID_CLOSING, p.link, `Need help? WhatsApp ${p.supportWhatsapp}`)
  return lines.join('\n')
}

/** Where the message's link goes: unpaid → the verification step; paid → the
 *  inbox when a parent messaged or asked for a demo, else the dashboard. */
export function inboxLinkPath(paid: boolean, kinds: InboxKind[], verifyHref: string): string {
  if (!paid) return verifyHref
  return kinds.includes('message') || kinds.includes('demo') ? '/messages' : '/tutor/dashboard'
}

// ------------------------------------------------------------------ labels ---

export const KIND_LABEL: Record<InboxKind, string> = {
  demo: 'Demo request',
  message: 'Message attempt',
  shortlist: 'Shortlist',
  view: 'Profile view',
}

/** The Overview to-do row (hidden at 0; opens the inbox). */
export const INTEREST_TODO_KEY = 'todo-interest' as const
export const INBOX_HREF = '/admin/whatsapp-updates?tab=interest'

/** The Overview to-do row's extra line. */
export function demoDetail(demoRows: number): string | null {
  return demoRows > 0 ? `${plural(demoRows, 'demo request', 'demo requests')}` : null
}

// ------------------------------------------------------------ page view ---
// One row as the page renders it (lib/interestInboxView builds it).

export type InboxActionView = { label: string; at: string; when: string; blocked: boolean }
export type InboxRowView = {
  tutorId: string
  name: string
  city: string | null
  paid: boolean
  assigneeName: string
  tab: 'to_send' | 'sent' | 'new_since_sent'
  waitLabel: string | null
  summaryText: string
  lastActivityAt: string
  message: string
  weekCount: number
  last: { id: string; by: string | null; when: string; today: boolean; mayUndo: boolean; from: string | null } | null
  parents: { parentId: string; name: string; maskedPhone: string | null; place: string | null; actions: InboxActionView[] }[]
  /** Parent page: this parent's own actions on the tutor. */
  mine?: InboxActionView[]
  /** Parent page: false when the inbox leaves this tutor out (never messaged). */
  inInbox?: boolean
}


// PR-11 — the stored inbox (admin_summary 'interest-inbox').
/** A stored inbox older than this is rebuilt on open (the cron keeps it younger). */
export const INBOX_SNAPSHOT_MAX_AGE_MS = 90_000

/** The 1-minute admin cron rebuilds the stored inbox only this often (PR-15:
 *  was every run). Sends, Undo, holds and page opens rebuild it themselves. */
export const INBOX_CRON_INTERVAL_MS = 10 * 60 * 1000

/** Should the cron rebuild the stored inbox now? Yes when there is none, it is
 *  from another Pakistan day, or it is (about) 10 minutes old — the cron fires
 *  each minute, so 30 s of slack keeps it on the 10th minute. Pure. */
export function inboxCronDue(stored: { builtAt?: string | null; pkDay?: string | null } | null, nowMs: number): boolean {
  if (!stored?.builtAt) return true
  const built = Date.parse(stored.builtAt)
  if (!Number.isFinite(built) || nowMs < built) return true
  if (stored.pkDay !== pkDayKeyOf(nowMs)) return true
  return nowMs - built >= INBOX_CRON_INTERVAL_MS - 30_000
}

/** Is a stored inbox still the inbox? Same Pakistan day, young, nothing newer. */
export function storedInboxUsable(stored: { builtAt: string; pkDay: string } | null, nowMs: number, newestChange: string | null): boolean {
  if (!stored) return false
  const built = Date.parse(stored.builtAt)
  if (!Number.isFinite(built) || nowMs - built > INBOX_SNAPSHOT_MAX_AGE_MS || nowMs < built) return false
  if (stored.pkDay !== pkDayKeyOf(nowMs)) return false
  return !newestChange || Date.parse(newestChange) <= built
}


/** The Pakistan date (YYYY-MM-DD) of a moment — UTC+5, no daylight saving. */
export function pkDayKeyOf(nowMs: number): string {
  return new Date(nowMs + 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// ------------------------------------------------- stored-copy check (PR-12) ---
// "Does the stored inbox say what a fresh build says?" Compared at the SAME
// moment: the fresh build is made for the stored copy's own builtAt, so only a
// real difference (a change the staleness check missed, or something lost in
// storage) shows up — never ordinary drift between two times. Pure.

type SnapshotRowLike = { tutorId: string; tab: string; wait: string | null; assigneeId: string; pendingKinds?: readonly string[] }
type SnapshotLike = {
  rows: readonly SnapshotRowLike[]
  counts: { byTab: Record<string, number>; ready: number; readyDemo: number; waitingBeyondCap: number; readyByAssignee: Record<string, number>; unpaidSentToday: number }
}

/** Plain lines naming every difference between two inbox snapshots (none = []). */
export function inboxSnapshotDiff(fresh: SnapshotLike, stored: SnapshotLike): string[] {
  const out: string[] = []
  const num = (label: string, a: number, b: number) => {
    if (a !== b) out.push(`${label}: fresh ${a}, stored ${b}`)
  }
  for (const t of new Set([...Object.keys(fresh.counts.byTab), ...Object.keys(stored.counts.byTab)])) num(`tab ${t}`, fresh.counts.byTab[t] ?? 0, stored.counts.byTab[t] ?? 0)
  num('ready', fresh.counts.ready, stored.counts.ready)
  num('ready demo', fresh.counts.readyDemo, stored.counts.readyDemo)
  num('waiting beyond cap', fresh.counts.waitingBeyondCap, stored.counts.waitingBeyondCap)
  num('unpaid sent today', fresh.counts.unpaidSentToday, stored.counts.unpaidSentToday)
  for (const id of new Set([...Object.keys(fresh.counts.readyByAssignee), ...Object.keys(stored.counts.readyByAssignee)])) {
    num(`ready for assignee ${id.slice(0, 8)}`, fresh.counts.readyByAssignee[id] ?? 0, stored.counts.readyByAssignee[id] ?? 0)
  }
  num('rows', fresh.rows.length, stored.rows.length)
  const s = new Map(stored.rows.map((r) => [r.tutorId, r]))
  const f = new Map(fresh.rows.map((r) => [r.tutorId, r]))
  for (const r of fresh.rows) {
    const o = s.get(r.tutorId)
    if (!o) out.push(`tutor ${r.tutorId.slice(0, 8)}: only in the fresh build (${r.tab})`)
    else if (o.tab !== r.tab || o.wait !== r.wait || o.assigneeId !== r.assigneeId || (o.pendingKinds ?? []).join() !== (r.pendingKinds ?? []).join()) {
      out.push(`tutor ${r.tutorId.slice(0, 8)}: fresh ${r.tab}/${r.wait ?? 'ready'}, stored ${o.tab}/${o.wait ?? 'ready'}`)
    }
  }
  for (const r of stored.rows) if (!f.has(r.tutorId)) out.push(`tutor ${r.tutorId.slice(0, 8)}: only in the stored copy (${r.tab})`)
  // Row ORDER is what the page shows; report the first place it differs.
  const fo = fresh.rows.map((r) => r.tutorId).join()
  const so = stored.rows.map((r) => r.tutorId).join()
  if (out.length === 0 && fo !== so) out.push('same rows, different order')
  return out
}
