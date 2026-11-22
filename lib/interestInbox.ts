// lib/interestInbox.ts — the I/O half of the central Parent interest inbox
// (owner, 19 Nov 2026 — PR-10). Rules in lib/interestInboxCore. Service role;
// every page and route checks SCREEN_ACCESS.interestInbox first, and a role
// outside SCREEN_ACCESS.interestInboxAll only ever gets its own rows.
//
//   loadInterestInbox()      every tutor row (one per tutor), with tab, caps,
//                            assignee, the ready message and the drill-down.
//   loadParentInterestPanel() the parent member page's panel: the same rows,
//                            for the tutors this parent acted on.
//   recordInterestSend()     Send — logged in whatsapp_update_sends (channel
//                            'interest') + audit; hands back the WhatsApp
//                            address (lib/waLinkCore). Undo is undoWaSend().
//
// The tutor's number never reaches a page — only the WhatsApp address at Send.
// Parent phones reach the page masked only (Show is the member page's logged
// reveal). Nothing is deleted. Reports and logs carry counts only.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn, READ_CONCURRENCY } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { normalisePkMobile } from '@/lib/phone'
import { maskPhoneDisplay } from '@/lib/contactMaskCore'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { siteLink, waSendHref } from '@/lib/waLinkCore'
import { firstNameOf } from '@/lib/staffOutreachCore'
import { logAdminAction } from '@/lib/auditLog'
import { invalidateMemoTag, memoize } from '@/lib/memoCache'
import type { AdminActor } from '@/lib/adminAuth'
import { cityMap, siteOwnerId } from '@/lib/cityOwners'
import { loadTeaserTutors } from '@/lib/tutorTeasers'
import { loadHolds, loadParentInfo } from '@/lib/parentInterest'
import { isHeld, VERIFY_HREF } from '@/lib/parentInterestCore'
import { PARENT_VIEWER_ROLES } from '@/lib/profileViews'
import { DAY_MS, isPaid, pkDateKey, pkDayStartMs, pkWeekStartMs } from '@/lib/tutorTeasersCore'
import {
  applyCaps,
  assigneeFor,
  hotOrder,
  inboxLinkPath,
  inboxMessage,
  inboxTab,
  INBOX_UNPAID_DAILY_CAP,
  INBOX_WINDOW_DAYS,
  pkDayKeyOf,
  storedInboxUsable,
  inboxCronDue,
  inboxSnapshotDiff,
  messageParents,
  parentLeftOut,
  pendingActivity,
  placeOf,
  sendCounts,
  summarise,
  summaryLine,
  usableActivity,
  withinNoRepeat,
  type InboxActivity,
  type InboxKind,
  type InboxSend,
  type InboxSummary,
  type InboxTab,
  type WaitReason,
} from '@/lib/interestInboxCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>
type R = Record<string, unknown>

export type InboxAction = { kind: InboxKind; at: string; blocked: boolean }
export type InboxParent = { parentId: string; name: string; maskedPhone: string | null; place: string | null; actions: InboxAction[] }

export type InboxRow = {
  tutorId: string
  name: string
  city: string | null
  paid: boolean
  assigneeId: string
  assigneeName: string
  tab: InboxTab
  /** Why a To send / New activity row waits (caps); null = ready today. */
  wait: WaitReason | null
  summary: InboxSummary
  summaryText: string
  /** Today's ready message ('' on a Sent row). */
  message: string
  /** The kinds the pending message carries. */
  pendingKinds: InboxKind[]
  weekCount: number
  /** The newest live interest send (the Sent tab, "Sent by … at …", Undo). */
  last: { id: string; at: string; by: string | null; staffId: string | null; from: 'inbox' | 'parent_page' | null; recent: boolean } | null
  /** Every parent's actions on this tutor in the window — the drill-down. */
  parents: InboxParent[]
}

type BuiltRow = InboxRow & {
  msisdn: string
  pending: { eventIds: string[]; viewIds: string[]; parentIds: string[]; activityAt: string }
}

export type InboxCounts = {
  byTab: Record<InboxTab, number>
  /** Rows (per tab) that carry each kind. */
  byTabKind: Record<InboxTab, Record<InboxKind, number>>
  /** Sendable today (To send + New activity, within the caps). */
  ready: number
  readyDemo: number
  /** Sendable rows held back by a cap. */
  waitingBeyondCap: number
  waitingByReason: Record<WaitReason, number>
  /** Ready rows per assignee (the sidebar badge of a city owner). */
  readyByAssignee: Record<string, number>
  unpaidSentToday: number
}

export type Inbox = {
  rows: InboxRow[]
  counts: InboxCounts
  excluded: { notEligible: number; optedOut: number; noNumber: number }
  staff: { id: string; name: string }[]
  cities: string[]
  unpaidCap: number
}

const SEND_COLS = 'id, tutor_id, created_at, undone_at, kinds, channel, activity_at, unpaid, staff_id, staff_name, sent_from'

function toSend(s: R): InboxSend & { tutorId: string } {
  const kinds = (s.kinds as string[] | null) ?? []
  const channel = s.channel === 'interest' ? 'interest' : 'daily'
  return {
    tutorId: s.tutor_id as string,
    id: s.id as string,
    createdAt: s.created_at as string,
    undoneAt: (s.undone_at as string | null) ?? null,
    channel,
    activityAt: (s.activity_at as string | null) ?? null,
    // PR-08 unpaid rows were sent on the daily channel before this column.
    unpaid: !!s.unpaid || (channel === 'daily' && kinds.some((k) => k === 'parent_interest' || k === 'profile_views')),
    staffId: (s.staff_id as string | null) ?? null,
    staffName: (s.staff_name as string | null) ?? null,
    sentFrom: s.sent_from === 'inbox' || s.sent_from === 'parent_page' ? s.sent_from : null,
  }
}

/** Real parent activity in the window, per tutor, with the parents' facts. */
async function loadActivity(admin: Admin, nowMs: number) {
  const since = new Date(nowMs - INBOX_WINDOW_DAYS * DAY_MS).toISOString()
  const [events, views] = await Promise.all([
    pageAll<R>((f, t) => admin.from('parent_interest_events').select('id, tutor_id, parent_id, kind, created_at, blocked').gte('created_at', since).order('id').range(f, t) as never),
    pageAll<R>((f, t) =>
      admin
        .from('profile_views')
        .select('id, tutor_id, viewer_id, viewer_role, created_at')
        .gte('created_at', since)
        .in('viewer_role', [...PARENT_VIEWER_ROLES])
        .not('viewer_id', 'is', null)
        .order('id')
        .range(f, t) as never,
    ),
  ])
  const all: InboxActivity[] = [
    ...events.map((e) => ({
      id: e.id as string,
      tutorId: e.tutor_id as string,
      parentId: e.parent_id as string,
      kind: e.kind as InboxKind,
      at: e.created_at as string,
      blocked: !!e.blocked,
    })),
    ...views.map((v) => ({ id: v.id as string, tutorId: v.tutor_id as string, parentId: v.viewer_id as string, kind: 'view' as const, at: v.created_at as string })),
  ]
  const parentIds = [...new Set(all.map((a) => a.parentId))]
  const [info, holds, phones] = await Promise.all([
    loadParentInfo(admin, parentIds),
    loadHolds(admin, parentIds),
    pageAllIn(parentIds, (part, f, t) => admin.from('profiles').select('id, phone_number').in('id', part).order('id').range(f, t), 100, READ_CONCURRENCY),
  ])
  const phoneBy = new Map(phones.map((p) => [p.id as string, maskPhoneDisplay((p.phone_number as string | null) ?? null)]))
  const facts = (id: string) => {
    const i = info.get(id)
    return i ? { counts: i.counts, held: isHeld(holds.get(id)) } : undefined
  }
  return { all, usable: usableActivity(all, { nowMs, parent: facts }), info, phoneBy, facts }
}

type Loaded = Awaited<ReturnType<typeof buildInbox>>

async function buildInbox(admin: Admin, nowMs: number) {
  const act = await loadActivity(admin, nowMs)
  const byTutor = new Map<string, InboxActivity[]>()
  for (const a of act.usable) byTutor.set(a.tutorId, [...(byTutor.get(a.tutorId) ?? []), a])

  const tutors = await loadTeaserTutors(admin, nowMs, [...byTutor.keys()], { includeUnpaid: true })
  // Every never-list tutor is out (erase-requested, Not interested, suspended,
  // banned, paused, staff, test, unclaimed). A tutor who paid in the last two
  // days is not held back here: a parent is waiting on them.
  const eligible = tutors.filter((t) => t.block === null || t.block === 'too_soon')
  const optedIn = eligible.filter((t) => t.whatsappUpdates)
  const withNumber = optedIn.map((t) => ({ t, msisdn: normalisePkMobile(t.rawNumber) })).filter((x): x is { t: (typeof optedIn)[number]; msisdn: string } => !!x.msisdn)
  const ids = withNumber.map((x) => x.t.id)

  const sendsSince = new Date(Math.min(nowMs - INBOX_WINDOW_DAYS * DAY_MS, pkWeekStartMs(nowMs) - DAY_MS)).toISOString()
  const [sendRows, todayRows, owners, ownerId, support] = await Promise.all([
    pageAllIn(ids, (part, f, t) => admin.from('whatsapp_update_sends').select(SEND_COLS).in('tutor_id', part).gte('created_at', sendsSince).order('id').range(f, t), 100, READ_CONCURRENCY),
    pageAll<R>((f, t) =>
      admin.from('whatsapp_update_sends').select(SEND_COLS).gte('created_at', new Date(pkDayStartMs(nowMs)).toISOString()).is('undone_at', null).order('id').range(f, t) as never,
    ),
    cityMap(admin),
    siteOwnerId(admin),
    loadSupportWhatsApp(admin),
  ])
  const sends = new Map<string, InboxSend[]>()
  for (const r of sendRows) {
    const s = toSend(r)
    sends.set(s.tutorId, [...(sends.get(s.tutorId) ?? []), s])
  }
  const unpaidSentToday = todayRows.map(toSend).filter((s) => s.unpaid).length

  const assigneeIds = new Set<string>([...owners.values(), ...(ownerId ? [ownerId] : [])])
  const staffRows = await pageAllIn([...assigneeIds], (part, f, t) => admin.from('profiles').select('id, full_name').in('id', part).order('id').range(f, t), 100, READ_CONCURRENCY)
  const staffName = new Map(staffRows.map((p) => [p.id as string, formatName((p.full_name as string | null) ?? null) || 'Staff']))

  // Sendable stats for the caps, hottest first.
  type Pre = { t: (typeof withNumber)[number]; acts: InboxActivity[]; summary: InboxSummary; tab: InboxTab; last: InboxSend | null; today: number; week: number; unpaid: boolean }
  const pre: Pre[] = withNumber.map((x) => {
    const acts = byTutor.get(x.t.id) ?? []
    const s = sends.get(x.t.id) ?? []
    const { tab, last } = inboxTab(acts, s)
    const c = sendCounts(s, nowMs)
    return { t: x, acts, summary: summarise(acts)!, tab, last, today: c.today, week: c.week, unpaid: !isPaid(x.t.facts) }
  })
  const keyed = pre.map((p) => ({ tutorId: p.t.t.id, summary: p.summary, p }))
  keyed.sort(hotOrder)
  const sendable = keyed.filter((k) => k.p.tab !== 'sent').map((k) => ({ tutorId: k.tutorId, unpaid: k.p.unpaid, today: k.p.today, week: k.p.week }))
  const waits = applyCaps(sendable, { unpaidSentToday, unpaidCap: INBOX_UNPAID_DAILY_CAP })

  const rows: BuiltRow[] = keyed.map(({ p }) => {
    const t = p.t.t
    const city = t.match.cities[0] ?? null
    const assigneeId = ownerId ? assigneeFor(city, owners, ownerId) : (owners.get((city ?? '').toLowerCase()) ?? '')
    const pend = p.tab === 'sent' ? [] : pendingActivity(p.acts, p.last)
    const mp = messageParents(pend, (id) => act.info.get(id))
    const paid = !p.unpaid
    const pendingKinds = [...new Set(pend.map((a) => a.kind))]
    const byParent = new Map<string, InboxAction[]>()
    for (const a of [...p.acts].sort((x, y) => y.at.localeCompare(x.at))) byParent.set(a.parentId, [...(byParent.get(a.parentId) ?? []), { kind: a.kind, at: a.at, blocked: !!a.blocked }])
    return {
      tutorId: t.id,
      name: formatName(t.fullName) || 'Tutor',
      city,
      paid,
      assigneeId,
      assigneeName: staffName.get(assigneeId) ?? 'Owner',
      tab: p.tab,
      wait: p.tab === 'sent' ? null : (waits.get(t.id) ?? null),
      summary: p.summary,
      summaryText: summaryLine(p.summary, city),
      message:
        pend.length > 0
          ? inboxMessage({ firstName: firstNameOf(t.fullName), parents: mp, paid, link: siteLink(inboxLinkPath(paid, pendingKinds, VERIFY_HREF)), supportWhatsapp: support })
          : '',
      pendingKinds,
      weekCount: p.week,
      last: p.last
        ? { id: p.last.id, at: p.last.createdAt, by: p.last.staffName, staffId: p.last.staffId, from: p.last.sentFrom, recent: withinNoRepeat(p.last, nowMs) }
        : null,
      parents: [...byParent.entries()].map(([pid, actions]) => {
        const i = act.info.get(pid)
        return { parentId: pid, name: formatName(i?.name ?? null) || 'Parent', maskedPhone: act.phoneBy.get(pid) ?? null, place: i ? placeOf(i) : null, actions }
      }),
      msisdn: p.t.msisdn,
      pending: {
        eventIds: pend.filter((a) => a.kind !== 'view').map((a) => a.id),
        viewIds: pend.filter((a) => a.kind === 'view').map((a) => a.id),
        parentIds: [...new Set(pend.map((a) => a.parentId))],
        activityAt: pend.map((a) => a.at).sort().pop() ?? '',
      },
    }
  })

  const zero = () => ({ demo: 0, message: 0, shortlist: 0, view: 0 })
  const counts: InboxCounts = {
    byTab: { to_send: 0, sent: 0, new_since_sent: 0 },
    byTabKind: { to_send: zero(), sent: zero(), new_since_sent: zero() },
    ready: 0,
    readyDemo: 0,
    waitingBeyondCap: 0,
    waitingByReason: { sent_today: 0, week_cap: 0, daily_cap: 0 },
    readyByAssignee: {},
    unpaidSentToday,
  }
  for (const r of rows) {
    counts.byTab[r.tab]++
    for (const k of Object.keys(r.summary.counts) as InboxKind[]) if (r.summary.counts[k] > 0) counts.byTabKind[r.tab][k]++
    if (r.tab === 'sent') continue
    if (r.wait) {
      counts.waitingBeyondCap++
      counts.waitingByReason[r.wait]++
    } else {
      counts.ready++
      if (r.pendingKinds.includes('demo')) counts.readyDemo++
      counts.readyByAssignee[r.assigneeId] = (counts.readyByAssignee[r.assigneeId] ?? 0) + 1
    }
  }
  const staff = [...assigneeIds].map((id) => ({ id, name: staffName.get(id) ?? 'Staff' })).sort((a, b) => a.name.localeCompare(b.name))
  const cities = [...new Set(rows.map((r) => r.city).filter((c): c is string => !!c))].sort()
  return {
    rows,
    counts,
    excluded: { notEligible: tutors.length - eligible.length, optedOut: eligible.length - optedIn.length, noNumber: optedIn.length - withNumber.length },
    staff,
    cities,
    unpaidCap: INBOX_UNPAID_DAILY_CAP,
    act,
  }
}

const strip = ({ msisdn: _m, pending: _p, ...r }: BuiltRow): InboxRow => r

export const INBOX_MEMO_TAG = 'interest-inbox'

/** The whole inbox for the pages (every row; the page filters by tab, city,
 *  paid and staff). Held in memory for 20 s so changing a filter is quick;
 *  Send and Undo clear it (and always re-check against fresh data). */
export const loadInterestInbox = memoize(() => loadInterestInboxStored(), ['interest-inbox'], { revalidate: 20, tags: [INBOX_MEMO_TAG] })

// ------------------------------------------------------- stored snapshot ---
// PR-11 (owner, 20 Nov 2026): the inbox took ~10 s to open — it was rebuilt from
// thousands of ids on every visit. The built inbox is now kept as ONE row of
// admin_summary ('interest-inbox'), rebuilt by the 1-minute cron and whenever
// something it shows has changed since (a parent's interest event or view, a
// send or Undo, a hold decision, a Not interested). The rules, counts and order
// are exactly buildInbox's — the stored row IS its output. Send and Undo still
// re-check against fresh data (recordInterestSend builds anew).

export const INBOX_SNAPSHOT_KEY = 'interest-inbox'

type StoredInbox = { builtAt: string; pkDay: string; inbox: Inbox }

/** The newest moment anything the inbox shows changed (null = nothing found). */
async function newestInboxChange(admin: Admin): Promise<string | null> {
  const newest = (table: string, col: string, viewersOnly = false) => {
    // A plain select of one column (the table name is a variable, so the
    // generated row types are not needed here).
    type Q = { not: (c: string, op: string, v: null) => Q; in: (c: string, v: string[]) => Q; order: (c: string, o: { ascending: boolean }) => Q; limit: (n: number) => Q; maybeSingle: () => PromiseLike<{ data: unknown }> }
    let q = (admin.from(table as 'profiles').select(col) as unknown as Q).not(col, 'is', null)
    if (viewersOnly) q = q.not('viewer_id', 'is', null).in('viewer_role', [...PARENT_VIEWER_ROLES])
    return q
      .order(col, { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => ((r.data as Record<string, unknown> | null)?.[col] as string | null) ?? null)
  }
  const all = await Promise.all([
    newest('parent_interest_events', 'created_at'),
    newest('profile_views', 'created_at', true),
    newest('whatsapp_update_sends', 'created_at'),
    newest('whatsapp_update_sends', 'undone_at'),
    newest('interest_holds', 'decided_at'),
    newest('interest_holds', 'detected_at'),
    newest('follow_up_dismissals', 'created_at'),
    newest('follow_up_dismissals', 'undone_at'),
  ])
  return all.filter((v): v is string => !!v).sort().pop() ?? null
}

/** Build the inbox now and store it (the cron, and an open that found it stale). */
export async function refreshInterestInboxSnapshot(nowMs = Date.now()): Promise<Inbox> {
  const inbox = await loadInterestInboxFresh(nowMs)
  const admin = createAdminClient()
  if (admin) {
    const row: StoredInbox = { builtAt: new Date(nowMs).toISOString(), pkDay: pkDayKeyOf(nowMs), inbox }
    await admin.from('admin_summary').upsert({ key: INBOX_SNAPSHOT_KEY, payload: row, computed_at: row.builtAt })
  }
  return inbox
}

/** The cron's call (PR-15): rebuild the stored inbox only when it is due
 *  (lib/interestInboxCore inboxCronDue — every 10 minutes or a new PKT day).
 *  Reads two small fields of the stored row, never the whole payload. */
export async function refreshInterestInboxIfDue(nowMs = Date.now()): Promise<{ rebuilt: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { rebuilt: false }
  const { data } = await admin
    .from('admin_summary')
    .select('builtAt:payload->>builtAt, pkDay:payload->>pkDay')
    .eq('key', INBOX_SNAPSHOT_KEY)
    .maybeSingle()
  if (!inboxCronDue((data as { builtAt?: string | null; pkDay?: string | null } | null) ?? null, nowMs)) return { rebuilt: false }
  await refreshInterestInboxSnapshot(nowMs)
  return { rebuilt: true }
}

/** The summary job's read (PR-15): the stored inbox when the cron built it in
 *  the last minute (the same run), else a fresh build — never two builds in
 *  one cron run. */
export async function loadInterestInboxRecent(nowMs = Date.now(), maxAgeMs = 60_000): Promise<Inbox> {
  const admin = createAdminClient()
  if (!admin) return loadInterestInboxFresh(nowMs)
  const { data } = await admin.from('admin_summary').select('payload').eq('key', INBOX_SNAPSHOT_KEY).maybeSingle()
  const stored = (data?.payload as StoredInbox | null) ?? null
  const built = stored ? Date.parse(stored.builtAt) : NaN
  if (stored && stored.pkDay === pkDayKeyOf(nowMs) && Number.isFinite(built) && nowMs >= built && nowMs - built < maxAgeMs) return stored.inbox
  return loadInterestInboxFresh(nowMs)
}

/** The inbox for the page: the stored one when it is still current, else rebuilt. */
export async function loadInterestInboxStored(nowMs = Date.now()): Promise<Inbox> {
  const admin = createAdminClient()
  if (!admin) return loadInterestInboxFresh(nowMs)
  // The change check starts first; the build begins only if it has to.
  const [stored, changed] = await Promise.all([
    admin.from('admin_summary').select('payload').eq('key', INBOX_SNAPSHOT_KEY).maybeSingle().then((r) => (r.data?.payload as StoredInbox | null) ?? null),
    newestInboxChange(admin).catch(() => new Date(nowMs).toISOString()),
  ])
  if (stored && storedInboxUsable(stored, nowMs, changed)) return stored.inbox
  return refreshInterestInboxSnapshot(nowMs)
}

/** The whole inbox, read now (the summary job, the badge, reports). */
export async function loadInterestInboxFresh(nowMs = Date.now()): Promise<Inbox> {
  const admin = createAdminClient()
  const empty: Inbox = {
    rows: [],
    counts: {
      byTab: { to_send: 0, sent: 0, new_since_sent: 0 },
      byTabKind: { to_send: { demo: 0, message: 0, shortlist: 0, view: 0 }, sent: { demo: 0, message: 0, shortlist: 0, view: 0 }, new_since_sent: { demo: 0, message: 0, shortlist: 0, view: 0 } },
      ready: 0,
      readyDemo: 0,
      waitingBeyondCap: 0,
      waitingByReason: { sent_today: 0, week_cap: 0, daily_cap: 0 },
      readyByAssignee: {},
      unpaidSentToday: 0,
    },
    excluded: { notEligible: 0, optedOut: 0, noNumber: 0 },
    staff: [],
    cities: [],
    unpaidCap: INBOX_UNPAID_DAILY_CAP,
  }
  if (!admin) return empty
  const { act: _a, rows, ...rest } = await buildInbox(admin, nowMs)
  return { ...rest, rows: rows.map(strip) }
}

/** The badge / Overview numbers. Tolerant — null on failure. */
export async function interestInboxCounts(nowMs = Date.now()): Promise<InboxCounts | null> {
  try {
    return (await loadInterestInboxFresh(nowMs)).counts
  } catch {
    return null
  }
}

// ------------------------------------------------------- parent page panel ---

export const PANEL_HELD_LABEL = 'Activity held — not used for tutor messages'

export type ParentPanel =
  | { state: 'held'; label: string }
  | { state: 'ok'; rows: (InboxRow & { mine: InboxAction[]; inInbox: boolean })[] }

/** The parent member page's "Parent interest" panel: every tutor this parent
 *  acted on in the window, with this parent's actions and the tutor's shared
 *  inbox row (the same Send / Sent / Undo). */
export async function loadParentInterestPanel(parentId: string, nowMs = Date.now()): Promise<ParentPanel> {
  const admin = createAdminClient()
  if (!admin) return { state: 'ok', rows: [] }
  // Held, staff and test parents: never used, never listed.
  const [info, holds] = await Promise.all([loadParentInfo(admin, [parentId]), loadHolds(admin, [parentId])])
  const me = info.get(parentId)
  if (parentLeftOut(me ? { counts: me.counts, held: isHeld(holds.get(parentId)) } : undefined)) {
    return { state: 'held', label: PANEL_HELD_LABEL }
  }
  const b: Loaded = await buildInbox(admin, nowMs)
  const mineByTutor = new Map<string, InboxAction[]>()
  for (const a of b.act.usable.filter((x) => x.parentId === parentId).sort((x, y) => y.at.localeCompare(x.at))) {
    mineByTutor.set(a.tutorId, [...(mineByTutor.get(a.tutorId) ?? []), { kind: a.kind, at: a.at, blocked: !!a.blocked }])
  }
  const rowBy = new Map(b.rows.map((r) => [r.tutorId, r]))
  const outside = [...mineByTutor.keys()].filter((id) => !rowBy.has(id))
  const names = await pageAllIn(outside, (part, f, t) => admin.from('profiles').select('id, full_name, city').in('id', part).order('id').range(f, t), 100, READ_CONCURRENCY)
  const nameBy = new Map(names.map((p) => [p.id as string, p]))
  const rows = [...mineByTutor.entries()].map(([tid, mine]) => {
    const r = rowBy.get(tid)
    if (r) return { ...strip(r), mine, inInbox: true }
    const p = nameBy.get(tid)
    // A tutor the inbox leaves out (opted out, no number, paused, Not
    // interested…): listed, never messaged.
    return {
      tutorId: tid,
      name: formatName((p?.full_name as string | null) ?? null) || 'Tutor',
      city: (p?.city as string | null) ?? null,
      paid: false,
      assigneeId: '',
      assigneeName: '',
      tab: 'sent' as InboxTab,
      wait: null,
      summary: summarise(mine.map((m, i) => ({ id: String(i), tutorId: tid, parentId, kind: m.kind, at: m.at })))!,
      summaryText: '',
      message: '',
      pendingKinds: [],
      weekCount: 0,
      last: null,
      parents: [],
      mine,
      inInbox: false,
    }
  })
  rows.sort((x, y) => (y.mine[0]?.at ?? '').localeCompare(x.mine[0]?.at ?? ''))
  return { state: 'ok', rows }
}

// -------------------------------------------------------------------- send ---

export type InboxSendResult = { ok: true; id: string; waHref: string } | { ok: false; status: number; error: string }

async function actorName(admin: Admin, actor: AdminActor): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  return formatName((data?.full_name as string | null) ?? null) || null
}

/**
 * Send: the tutor must be sendable now (To send or New activity since sent,
 * within the caps) and — for a role that does not see every row — assigned to
 * the sender. Logs staff, time and what the message covered.
 */
export async function recordInterestSend(tutorId: string, actor: AdminActor, opts: { seesAll: boolean; from: 'inbox' | 'parent_page' }): Promise<InboxSendResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const nowMs = Date.now()
  const b = await buildInbox(admin, nowMs)
  const row = b.rows.find((r) => r.tutorId === tutorId)
  if (!row) return { ok: false, status: 409, error: 'This tutor is not in the Parent interest list any more.' }
  if (!opts.seesAll && row.assigneeId !== actor.id) return { ok: false, status: 403, error: 'This tutor is assigned to another staff member.' }
  if (row.tab === 'sent') return { ok: false, status: 409, error: 'This tutor was already sent this news. New parent activity will bring them back.' }
  if (row.wait) return { ok: false, status: 409, error: row.wait === 'sent_today' ? 'This tutor was already sent a WhatsApp today.' : row.wait === 'week_cap' ? 'This tutor already had two WhatsApp updates this week.' : 'Today’s limit for unpaid tutors is reached. Try again tomorrow.' }
  if (!row.message) return { ok: false, status: 409, error: 'There is nothing new to send.' }

  const { data, error } = await admin
    .from('whatsapp_update_sends')
    .insert({
      tutor_id: tutorId,
      pk_day: pkDateKey(nowMs),
      channel: 'interest',
      sent_from: opts.from,
      kinds: ['parent_interest', ...row.pendingKinds.map((k) => `interest_${k}`)],
      interest_event_ids: row.pending.eventIds,
      view_ids: row.pending.viewIds,
      parent_ids: row.pending.parentIds,
      activity_at: row.pending.activityAt || new Date(nowMs).toISOString(),
      unpaid: !row.paid,
      staff_id: actor.id,
      staff_name: await actorName(admin, actor),
    })
    .select('id')
    .single()
  // The one-live-send-a-day index: someone else just sent this tutor.
  if (error?.code === '23505') return { ok: false, status: 409, error: 'This tutor was already sent a WhatsApp today.' }
  if (error || !data) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  invalidateMemoTag(INBOX_MEMO_TAG)
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'whatsapp_update.send',
    targetType: 'user',
    targetId: tutorId,
    detail: { channel: 'interest', from: opts.from, send_id: data.id, parents: row.pending.parentIds.length, kinds: row.pendingKinds },
  })
  return { ok: true, id: data.id as string, waHref: waSendHref(row.msisdn, row.message) }
}

// ------------------------------------------------- stored-copy check (PR-12) ---

export type InboxSnapshotCheck = {
  stored: { builtAt: string; pkDay: string; ageSeconds: number; usableNow: boolean } | null
  newestChange: string | null
  /** A fresh build for the stored copy's own moment vs the stored copy. */
  sameMoment: string[]
  /** A fresh build vs the same build after a JSON round trip (what jsonb keeps). */
  roundTrip: string[]
  rows: { fresh: number; stored: number | null }
}

/**
 * READ-ONLY: build the inbox for the stored copy's own moment and compare —
 * nothing is written (no upsert, no memo). Used by scripts/check-inbox-stored.ts.
 */
export async function compareInboxSnapshot(nowMs = Date.now()): Promise<InboxSnapshotCheck> {
  const admin = createAdminClient()
  if (!admin) throw new Error('no admin client')
  const [stored, newestChange] = await Promise.all([
    admin.from('admin_summary').select('payload').eq('key', INBOX_SNAPSHOT_KEY).maybeSingle().then((r) => (r.data?.payload as StoredInbox | null) ?? null),
    newestInboxChange(admin),
  ])
  const at = stored ? Date.parse(stored.builtAt) : nowMs
  const fresh = await loadInterestInboxFresh(at)
  const trip = JSON.parse(JSON.stringify(fresh)) as Inbox
  return {
    stored: stored ? { builtAt: stored.builtAt, pkDay: stored.pkDay, ageSeconds: Math.round((nowMs - at) / 1000), usableNow: storedInboxUsable(stored, nowMs, newestChange) } : null,
    newestChange,
    sameMoment: stored ? inboxSnapshotDiff(fresh, stored.inbox) : ['no stored copy'],
    roundTrip: inboxSnapshotDiff(fresh, trip),
    rows: { fresh: fresh.rows.length, stored: stored ? stored.inbox.rows.length : null },
  }
}
