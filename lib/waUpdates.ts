// lib/waUpdates.ts — People → WhatsApp updates, the I/O half (owner, 18 Nov
// 2026 — PR-06). Rules in lib/tutorTeasersCore (waRowState, pendingWaItems,
// waMessage, mayUndoWaSend). Service role; every page and route checks
// SCREEN_ACCESS.waUpdates first.
//
// Each Pakistan day the queue lists the eligible paid tutors who have something
// worth a WhatsApp message: a parent opened one of their applications (today or
// yesterday), and on Mondays their weekly summary (the in-app summary's own
// numbers — the notification is the record), and (PR-07) an application staff
// sent to the parent today or yesterday. A tutor who opted out, has no
// WhatsApp number, or was already sent two this week is left out.
//
// Send writes whatsapp_update_sends (staff and time) and an audit row, and
// hands back the WhatsApp send address (lib/waLinkCore). Undo stamps the
// row undone. Nothing is deleted. The tutor's number never reaches the page —
// the browser only gets the WhatsApp address at the moment of Send.
//
// PR-10 (owner, 19 Nov 2026): parent-interest messages — PR-08's unpaid rows
// included — moved to the Parent interest inbox (lib/interestInbox). Both log
// here (channel daily | interest), so one WhatsApp a tutor a day and two a week
// hold across both; Undo (undoWaSend) serves both.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { normalisePkMobile } from '@/lib/phone'
import { isHiddenTuition } from '@/lib/hiddenTuitionCore'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { siteLink, waSendHref } from '@/lib/waLinkCore'
import { firstNameOf } from '@/lib/staffOutreachCore'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import type { BadgesPayload } from '@/lib/adminSummaryCore'
import { loadTeaserTutors, type TeaserTutor } from '@/lib/tutorTeasers'
import { interestInboxCounts } from '@/lib/interestInbox'
import { demoDetail, INTEREST_TODO_KEY } from '@/lib/interestInboxCore'
import { featuredToSendCount } from '@/lib/featuredMatches'
import {
  DAY_MS,
  mayUndoWaSend,
  openedWindowStartMs,
  pendingWaItems,
  pkDateKey,
  pkDayStartMs,
  pkWeekStartMs,
  pkWeekday,
  sendsThisWeek,
  sendsToday,
  SUMMARY_WEEKDAY,
  waKinds,
  waMessage,
  waRowState,
  type WaItem,
  type WaRowState,
  type WaSend,
  type WeeklyNumbers,
} from '@/lib/tutorTeasersCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export type WaQueueRow = {
  tutorId: string
  name: string
  city: string | null
  state: WaRowState
  /** What today's message would carry (empty for a row already sent today). */
  items: WaItem[]
  /** The ready message, with the tutor's first name — never their number. */
  message: string
  /** Live sends this week (for "1 of 2 this week"). */
  weekCount: number
  /** Today's live send, for "Sent by … at …" and Undo. */
  sentToday: { id: string; at: string; by: string | null; staffId: string | null } | null
}

export type WaQueue = {
  rows: WaQueueRow[]
  toSend: number
  eligible: number
  optedOut: number
  noNumber: number
}

type Facts = { tutors: TeaserTutor[]; sends: Map<string, WaSend[]>; items: Map<string, WaItem[]>; support: string }

async function loadFacts(admin: Admin, nowMs: number, ids?: string[]): Promise<Facts> {
  const tutors = (await loadTeaserTutors(admin, nowMs, ids)).filter((t) => t.block === null)
  const tutorIds = tutors.map((t) => t.id)
  const since = new Date(pkWeekStartMs(nowMs) - DAY_MS).toISOString()
  const openedFrom = new Date(openedWindowStartMs(nowMs)).toISOString()
  const monday = pkWeekday(nowMs) === SUMMARY_WEEKDAY

  const [sendRows, views, forwards, summaries, support] = await Promise.all([
    pageAllIn(tutorIds, (part, f, t) =>
      admin
        .from('whatsapp_update_sends')
        .select('id, tutor_id, created_at, undone_at, kinds, application_ids, forwarded_application_ids, interest_event_ids, staff_id, staff_name')
        .in('tutor_id', part)
        .gte('created_at', since)
        .order('id')
        .range(f, t),
    ),
    tutorIds.length
      ? pageAll<Record<string, unknown>>((f, t) =>
          admin.from('application_parent_views').select('application_id, first_seen_at').gte('first_seen_at', openedFrom).order('application_id').range(f, t) as never,
        )
      : Promise.resolve([] as Record<string, unknown>[]),
    // PR-07: forwards to the parent that sent the bell alert, not undone.
    pageAllIn(tutorIds, (part, f, t) =>
      admin
        .from('application_forward_alerts')
        .select('application_id, tutor_id, job_id, forwarded_at')
        .in('tutor_id', part)
        .eq('notified', true)
        .is('undone_at', null)
        .gte('forwarded_at', openedFrom)
        .order('application_id')
        .range(f, t),
    ),
    monday
      ? pageAllIn(tutorIds, (part, f, t) =>
          admin
            .from('notifications')
            .select('id, user_id, meta, created_at')
            .in('user_id', part)
            .eq('kind', 'teaser_weekly_summary')
            .gte('created_at', new Date(pkDayStartMs(nowMs)).toISOString())
            .order('id')
            .range(f, t),
        )
      : Promise.resolve([] as Record<string, unknown>[]),
    loadSupportWhatsApp(admin),
  ])

  const sends = sendsByTutor(sendRows)

  // Application opens in the window, by these tutors, on tuitions still shown.
  const seenAt = new Map(views.map((v) => [v.application_id as string, v.first_seen_at as string]))
  const mine = new Set(tutorIds)
  const apps = await pageAllIn([...seenAt.keys()], (part, f, t) =>
    admin.from('applications').select('id, tutor_id, job_id, withdrawn_at').in('id', part).order('id').range(f, t),
  )
  const openedApps = apps.filter((a) => !a.withdrawn_at && mine.has(a.tutor_id as string))
  const jobIds = [...new Set([...openedApps.map((a) => a.job_id as string), ...forwards.map((x) => x.job_id as string)])]
  const jobs = await pageAllIn(jobIds, (part, f, t) => admin.from('jobs').select('id, title, area, city, status').in('id', part).order('id').range(f, t))
  const jobBy = new Map(jobs.map((j) => [j.id as string, j]))

  const items = new Map<string, WaItem[]>()
  const add = (k: string, i: WaItem) => items.set(k, [...(items.get(k) ?? []), i])
  for (const a of openedApps) {
    const j = jobBy.get(a.job_id as string)
    if (!j || isHiddenTuition(j.status as string | null)) continue
    add(a.tutor_id as string, {
      kind: 'application_opened',
      applicationId: a.id as string,
      at: seenAt.get(a.id as string) as string,
      jobTitle: (j.title as string | null) ?? null,
      area: (j.area as string | null) ?? null,
      city: (j.city as string | null) ?? null,
    })
  }
  for (const x of forwards) {
    const j = jobBy.get(x.job_id as string)
    if (!j || isHiddenTuition(j.status as string | null)) continue
    add(x.tutor_id as string, {
      kind: 'application_forwarded',
      applicationId: x.application_id as string,
      at: x.forwarded_at as string,
      jobTitle: (j.title as string | null) ?? null,
      area: (j.area as string | null) ?? null,
      city: (j.city as string | null) ?? null,
    })
  }
  for (const s of summaries) {
    const m = (s.meta ?? {}) as Partial<WeeklyNumbers>
    const numbers: WeeklyNumbers = { views: Number(m.views) || 0, applications: Number(m.applications) || 0, tuitions: Number(m.tuitions) || 0 }
    add(s.user_id as string, { kind: 'weekly_summary', numbers })
  }
  return { tutors, sends, items, support }
}

function sendsByTutor(sendRows: Record<string, unknown>[]): Map<string, WaSend[]> {
  const sends = new Map<string, WaSend[]>()
  for (const s of sendRows) {
    const k = s.tutor_id as string
    sends.set(k, [
      ...(sends.get(k) ?? []),
      {
        id: s.id as string,
        createdAt: s.created_at as string,
        undoneAt: (s.undone_at as string | null) ?? null,
        kinds: (s.kinds as string[] | null) ?? [],
        applicationIds: (s.application_ids as string[] | null) ?? [],
        forwardedIds: (s.forwarded_application_ids as string[] | null) ?? [],
        interestEventIds: (s.interest_event_ids as string[] | null) ?? [],
        staffId: (s.staff_id as string | null) ?? null,
        staffName: (s.staff_name as string | null) ?? null,
      },
    ])
  }
  return sends
}

function linkFor(items: WaItem[]): string {
  return siteLink(items.some((i) => i.kind === 'application_opened' || i.kind === 'application_forwarded') ? '/tutor/dashboard/applications' : '/tutor/dashboard')
}

type BuiltRow = WaQueueRow & { msisdn: string | null }

function buildRow(t: TeaserTutor, f: Facts, nowMs: number): BuiltRow {
  const sends = f.sends.get(t.id) ?? []
  const msisdn = normalisePkMobile(t.rawNumber)
  const pending = pendingWaItems(f.items.get(t.id) ?? [], sends, nowMs)
  const state = waRowState({ eligible: t.block === null, optedIn: t.whatsappUpdates, hasNumber: !!msisdn, pending, sends }, nowMs)
  const today = sendsToday(sends, nowMs).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  return {
    tutorId: t.id,
    name: formatName(t.fullName) || 'Tutor',
    city: t.match.cities[0] ?? null,
    state,
    items: state === 'to_send' ? pending : [],
    message: state === 'to_send' ? waMessage({ firstName: firstNameOf(t.fullName), items: pending, link: linkFor(pending), supportWhatsapp: f.support }) : '',
    weekCount: sendsThisWeek(sends, nowMs).length,
    sentToday: today ? { id: today.id, at: today.createdAt, by: today.staffName, staffId: today.staffId } : null,
    msisdn,
  }
}

/** Today's queue: rows to send first, then today's sends. PR-10: paid tutors'
 *  application and weekly-summary news only — every parent-interest message
 *  (paid and unpaid, PR-08's unpaid rows included) comes from the Parent
 *  interest inbox (lib/interestInbox), which shares this table and its caps. */
export async function loadWaQueue(nowMs = Date.now()): Promise<WaQueue> {
  const admin = createAdminClient()
  const empty: WaQueue = { rows: [], toSend: 0, eligible: 0, optedOut: 0, noNumber: 0 }
  if (!admin) return empty
  const f = await loadFacts(admin, nowMs)
  const built = f.tutors.map((t) => buildRow(t, f, nowMs))
  const rows = built
    .filter((r) => r.state !== 'hidden')
    .map(({ msisdn: _m, ...r }) => r)
    .sort((a, b) => (a.state !== b.state ? (a.state === 'to_send' ? -1 : 1) : a.name.localeCompare(b.name)))
  return {
    rows,
    toSend: rows.filter((r) => r.state === 'to_send').length,
    eligible: f.tutors.length,
    optedOut: f.tutors.filter((t) => !t.whatsappUpdates).length,
    noNumber: built.filter((r) => !r.msisdn).length,
  }
}

/** The sidebar badge: rows still to send today — the daily rows plus the
 *  Featured matched-tuitions items (PR-14). Tolerant — null on failure. */
export async function waQueueCount(nowMs = Date.now()): Promise<number | null> {
  try {
    const [q, featured] = await Promise.all([loadWaQueue(nowMs), featuredToSendCount(nowMs)])
    return q.toSend + (featured ?? 0)
  } catch {
    return null
  }
}

/** Put the fresh count on the stored badges at once (the summary job would
 *  catch up within minutes). Never throws. */
export async function refreshWaBadge(): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  try {
    const [n, inbox] = await Promise.all([waQueueCount(), interestInboxCounts()])
    const { data } = await admin.from('admin_summary').select('key, payload').in('key', ['badges', 'overview:7', 'overview:30'])
    for (const r of data ?? []) {
      const cur = r.payload as Record<string, unknown> | null
      if (!cur) continue
      if (r.key === 'badges') {
        const b = cur as unknown as BadgesPayload
        const next: BadgesPayload = { ...b, ...(n !== null ? { waUpdates: n } : {}), ...(inbox ? { interestInbox: interestTally(inbox) } : {}) }
        await admin.from('admin_summary').update({ payload: next }).eq('key', 'badges')
      } else if (inbox && cur[INTEREST_TODO_KEY]) {
        // PR-10: the Overview "Parent interest to send" row moves at once too.
        const item = cur[INTEREST_TODO_KEY] as Record<string, unknown>
        await admin
          .from('admin_summary')
          .update({ payload: { ...cur, [INTEREST_TODO_KEY]: { ...item, count: inbox.ready, extra: demoDetail(inbox.readyDemo) } } })
          .eq('key', r.key)
      }
    }
  } catch {
    /* the next summary run puts it right */
  }
}

/** The stored badge figure for the inbox: ready rows in total and per assignee. */
export function interestTally(c: { ready: number; readyByAssignee: Record<string, number> }): { total: number; byOwner: Record<string, number> } {
  return { total: c.ready, byOwner: { ...c.readyByAssignee } }
}

async function staffName(admin: Admin, actor: AdminActor): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  return formatName((data?.full_name as string | null) ?? null) || null
}

export type WaSendResult = { ok: true; id: string; waHref: string } | { ok: false; status: number; error: string }

/** Send: the tutor must be in today's queue to send. Logs staff and time. */
export async function recordWaSend(tutorId: string, actor: AdminActor): Promise<WaSendResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const nowMs = Date.now()
  const f = await loadFacts(admin, nowMs, [tutorId])
  const t = f.tutors.find((x) => x.id === tutorId)
  const row = t ? buildRow(t, f, nowMs) : null
  if (!row) return { ok: false, status: 409, error: 'This tutor is not in today’s list any more.' }
  if (row.state === 'sent_today') return { ok: false, status: 409, error: 'This tutor was already sent an update today.' }
  if (row.state !== 'to_send' || !row.msisdn) return { ok: false, status: 409, error: 'This tutor is not in today’s list any more.' }

  const { data, error } = await admin
    .from('whatsapp_update_sends')
    .insert({
      tutor_id: tutorId,
      pk_day: pkDateKey(nowMs),
      kinds: waKinds(row.items),
      application_ids: row.items.flatMap((i) => (i.kind === 'application_opened' ? [i.applicationId] : [])),
      forwarded_application_ids: row.items.flatMap((i) => (i.kind === 'application_forwarded' ? [i.applicationId] : [])),
      interest_event_ids: row.items.flatMap((i) => (i.kind === 'parent_interest' ? i.eventIds : [])),
      staff_id: actor.id,
      staff_name: await staffName(admin, actor),
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'whatsapp_update.send',
    targetType: 'user',
    targetId: tutorId,
    detail: { kinds: waKinds(row.items), send_id: data.id },
  })
  return { ok: true, id: data.id as string, waHref: waSendHref(row.msisdn, row.message) }
}

/** Undo: the sender (or the Owner), the same Pakistan day. Stamps the row. */
export async function undoWaSend(id: string, actor: AdminActor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: s } = await admin.from('whatsapp_update_sends').select('id, tutor_id, created_at, undone_at, staff_id').eq('id', id).maybeSingle()
  if (!s) return { ok: false, status: 404, error: 'That send was not found.' }
  const why = mayUndoWaSend({ createdAt: s.created_at as string, undoneAt: (s.undone_at as string | null) ?? null, staffId: (s.staff_id as string | null) ?? null }, actor, Date.now())
  if (why) return { ok: false, status: 409, error: why }
  const { error } = await admin.from('whatsapp_update_sends').update({ undone_at: new Date().toISOString(), undone_by: actor.id }).eq('id', id).is('undone_at', null)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'whatsapp_update.undo',
    targetType: 'user',
    targetId: s.tutor_id as string,
    detail: { send_id: id },
  })
  return { ok: true }
}
